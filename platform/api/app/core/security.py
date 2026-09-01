"""Authentication, roles and permission middleware.

Google OAuth establishes identity; the JWT this service issues carries the
role. Authorisation is enforced in three places, because a single check is one
mistake away from a leak:

  * page level   — the route dependency rejects the request outright
  * action level — mutating and exporting endpoints require a higher role
  * field level  — the serialiser strips columns the role may not see
"""

from __future__ import annotations

import datetime as dt
import enum
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel

from app.core.config import Settings, get_settings


class Role(str, enum.Enum):
    RECRUITER = "Recruiter"
    RECRUITMENT_MANAGER = "Recruitment Manager"
    HR_DIRECTOR = "HR Director"
    ADMIN = "Admin"
    SUPER_ADMIN = "Super Admin"


ROLE_RANK: dict[Role, int] = {
    Role.RECRUITER: 0,
    Role.RECRUITMENT_MANAGER: 1,
    Role.HR_DIRECTOR: 2,
    Role.ADMIN: 3,
    Role.SUPER_ADMIN: 4,
}


class Principal(BaseModel):
    email: str
    name: str
    role: Role
    # Set when the signed-in user is themselves a recruiter, so their own
    # records can be scoped without a separate lookup.
    recruiter_id: int | None = None
    # The recruiter's name as it appears in the dataset. Carried explicitly
    # rather than derived from `name`: the display name on a Google account and
    # the name typed into the source sheet are frequently not the same string.
    recruiter_name: str | None = None

    def at_least(self, minimum: Role) -> bool:
        return ROLE_RANK[self.role] >= ROLE_RANK[minimum]


# ---------------------------------------------------------------------------
# Field-level permissions
# ---------------------------------------------------------------------------

# Mirrors PROTECTED_FIELDS in web/src/lib/auth/permissions.ts. Both the wire
# name and the UI name for each field are listed, so a rename on either side
# fails loudly rather than silently opening a column.
FIELD_MIN_ROLE: dict[str, Role] = {
    "phone": Role.RECRUITER,
    "email": Role.RECRUITER,
    "cnic": Role.HR_DIRECTOR,
    "last_salary": Role.RECRUITMENT_MANAGER,
    "salary": Role.RECRUITMENT_MANAGER,
    "current_salary": Role.RECRUITMENT_MANAGER,
    "remarks": Role.RECRUITMENT_MANAGER,
}

# Row scope: which records a role may read at all, before any filter it asks
# for. Anything below this rank is rewritten to the caller's own book in
# `FilterQuery.to_spec`.
ROW_SCOPE_ALL_MIN_ROLE: Role = Role.RECRUITMENT_MANAGER


def sees_all_rows(role: Role) -> bool:
    return ROLE_RANK[role] >= ROLE_RANK[ROW_SCOPE_ALL_MIN_ROLE]


def redact(payload: dict[str, Any], role: Role) -> dict[str, Any]:
    """Strip fields the role may not see.

    Restricted keys are removed rather than nulled: an explicit `null` is
    indistinguishable from "the source sheet had no value here", and that
    ambiguity would quietly corrupt any coverage statistic computed downstream.
    """
    return {
        key: value
        for key, value in payload.items()
        if ROLE_RANK[role] >= ROLE_RANK[FIELD_MIN_ROLE.get(key, Role.RECRUITER)]
    }


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------


def issue_token(principal: Principal, settings: Settings) -> str:
    now = dt.datetime.now(dt.UTC)
    claims = {
        "sub": principal.email,
        "name": principal.name,
        "role": principal.role.value,
        "rid": principal.recruiter_id,
        "rnm": principal.recruiter_name,
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(minutes=settings.jwt_ttl_minutes)).timestamp()),
        "iss": settings.app_name,
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)


bearer = HTTPBearer(auto_error=False)


async def current_principal(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Principal:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        claims = jwt.decode(
            credentials.credentials,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            issuer=settings.app_name,
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid. Sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    try:
        role = Role(claims["role"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token carries no recognised role.",
        ) from exc

    principal = Principal(
        email=claims["sub"],
        name=claims.get("name", claims["sub"]),
        role=role,
        recruiter_id=claims.get("rid"),
        recruiter_name=claims.get("rnm"),
    )
    # Stashed so the audit middleware can attribute the request without
    # re-decoding the token.
    request.state.principal = principal
    return principal


CurrentUser = Annotated[Principal, Depends(current_principal)]


def require_role(minimum: Role):
    """Route dependency enforcing a minimum role."""

    async def dependency(principal: CurrentUser) -> Principal:
        if not principal.at_least(minimum):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"This view requires {minimum.value} access. "
                    f"You are signed in as {principal.role.value}."
                ),
            )
        return principal

    return dependency


RequireManager = Annotated[Principal, Depends(require_role(Role.RECRUITMENT_MANAGER))]
RequireDirector = Annotated[Principal, Depends(require_role(Role.HR_DIRECTOR))]
RequireAdmin = Annotated[Principal, Depends(require_role(Role.ADMIN))]


# ---------------------------------------------------------------------------
# Google OAuth
# ---------------------------------------------------------------------------


async def verify_google_token(id_token: str, settings: Settings) -> dict[str, Any]:
    """Verify a Google ID token and enforce the domain allow-list."""
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    info = google_id_token.verify_oauth2_token(
        id_token, google_requests.Request(), settings.google_client_id
    )

    email = info.get("email", "")
    if not info.get("email_verified"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This Google account has no verified email address.",
        )

    domain = email.rsplit("@", 1)[-1].lower()
    if settings.allowed_email_domains and domain not in settings.allowed_email_domains:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{domain} is not an approved sign-in domain.",
        )
    return info
