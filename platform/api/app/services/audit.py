"""Audit logging.

Reads of candidate-level data and every export are recorded. Writing the audit
row must never fail the request it describes — a lost audit line is a problem,
but a 500 on a dashboard because the audit table was locked is a worse one, so
failures are logged loudly and swallowed.
"""

from __future__ import annotations

import logging

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.security import Principal
from app.models.recruitment import AuditLog

log = logging.getLogger(__name__)


class AuditService:
    def __init__(self, session: Session) -> None:
        self.session = session

    async def record(
        self,
        *,
        principal: Principal,
        action: str,
        resource: str,
        scope: str | None = None,
        row_count: int | None = None,
        request: Request | None = None,
    ) -> None:
        try:
            entry = AuditLog(
                actor_email=principal.email,
                actor_role=principal.role.value,
                action=action,
                resource=resource,
                scope=scope,
                row_count=row_count,
                ip_address=_client_ip(request) if request else None,
            )
            self.session.add(entry)
            self.session.commit()
        except Exception as exc:  # noqa: BLE001
            self.session.rollback()
            log.error(
                "Audit write failed for %s by %s: %s", action, principal.email, exc
            )


def _client_ip(request: Request) -> str | None:
    # Behind a load balancer the socket address is the balancer's, so the
    # first hop in X-Forwarded-For is the real client.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None
