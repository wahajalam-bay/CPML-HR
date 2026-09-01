"""HTTP surface.

Read endpoints are cached in Redis under a key derived from the filter spec
plus the caller's role, because role changes what a response is allowed to
contain — caching without the role in the key would leak restricted fields to
the next caller.
"""

from __future__ import annotations

import datetime as dt
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.api.deps import get_audit, get_cache, get_repository
from app.core.security import (
    CurrentUser,
    Principal,
    RequireManager,
    redact,
    sees_all_rows,
)
from app.models.recruitment import Outcome, Stage
from app.repositories.analytics import (
    DIMENSIONS,
    AnalyticsRepository,
    FilterSpec,
    Granularity,
)
from app.services.audit import AuditService
from app.services.cache import CacheService

router = APIRouter()


# ---------------------------------------------------------------------------
# Filter parsing
# ---------------------------------------------------------------------------


class FilterQuery(BaseModel):
    """Query-string filter surface, mirroring the front end's filter bar."""

    date_from: dt.date | None = None
    date_to: dt.date | None = None
    recruiter: list[str] = Field(default_factory=list)
    source: list[str] = Field(default_factory=list)
    role: list[str] = Field(default_factory=list)
    business_unit: list[str] = Field(default_factory=list)
    hiring_manager: list[str] = Field(default_factory=list)
    degree: list[str] = Field(default_factory=list)
    industry: list[str] = Field(default_factory=list)
    outcome: list[Outcome] = Field(default_factory=list)
    stage_at_least: Stage | None = None
    stage_exactly: Stage | None = None
    experience_min: float | None = None
    experience_max: float | None = None
    repeats_only: bool | None = None
    search: str | None = None

    def to_spec(self, principal: Principal) -> FilterSpec:
        spec = FilterSpec(
            date_from=self.date_from,
            date_to=self.date_to,
            recruiters=self.recruiter,
            sources=self.source,
            roles=self.role,
            business_units=self.business_unit,
            hiring_managers=self.hiring_manager,
            degrees=self.degree,
            industries=self.industry,
            outcomes=self.outcome,
            stage_at_least=self.stage_at_least,
            stage_exactly=self.stage_exactly,
            experience_min=self.experience_min,
            experience_max=self.experience_max,
            repeats_only=self.repeats_only,
            search=self.search,
        )
        # Row scope is applied AFTER the caller's filters and overwrites them,
        # so a scoped caller cannot widen past their own book by naming another
        # recruiter in the query string. Enforced here rather than in the UI so
        # the API is safe on its own.
        if not sees_all_rows(principal.role):
            if principal.recruiter_name:
                spec.recruiters = [principal.recruiter_name]
            else:
                # Identified as scoped but with no book mapped: match nothing
                # rather than falling through to everything.
                spec.recruiters = ["\x00none"]
        return spec


FilterDep = Annotated[FilterQuery, Depends()]
RepoDep = Annotated[AnalyticsRepository, Depends(get_repository)]
CacheDep = Annotated[CacheService, Depends(get_cache)]
AuditDep = Annotated[AuditService, Depends(get_audit)]


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------


@router.get("/analytics/summary", summary="Headline metrics for a filter scope")
async def summary(
    filters: FilterDep,
    principal: CurrentUser,
    repo: RepoDep,
    cache: CacheDep,
) -> dict[str, Any]:
    spec = filters.to_spec(principal)
    key = f"summary:{principal.role.value}:{spec.cache_key()}"
    return await cache.get_or_set(key, lambda: repo.summary(spec))


@router.get("/analytics/funnel", summary="Stage-by-stage conversion")
async def funnel(
    filters: FilterDep,
    principal: CurrentUser,
    repo: RepoDep,
    cache: CacheDep,
) -> list[dict[str, Any]]:
    spec = filters.to_spec(principal)
    key = f"funnel:{principal.role.value}:{spec.cache_key()}"
    return await cache.get_or_set(key, lambda: repo.funnel(spec))


@router.get("/analytics/by/{dimension}", summary="Metrics grouped by a dimension")
async def by_dimension(
    dimension: str,
    filters: FilterDep,
    principal: CurrentUser,
    repo: RepoDep,
    cache: CacheDep,
    min_applications: Annotated[int, Query(ge=1, le=1000)] = 1,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[dict[str, Any]]:
    if dimension not in DIMENSIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Unknown dimension '{dimension}'. "
                f"Expected one of: {', '.join(sorted(DIMENSIONS))}."
            ),
        )
    spec = filters.to_spec(principal)
    key = f"by:{dimension}:{min_applications}:{limit}:{principal.role.value}:{spec.cache_key()}"
    return await cache.get_or_set(
        key, lambda: repo.by_dimension(spec, dimension, min_applications, limit)
    )


@router.get("/analytics/timeseries", summary="Metrics bucketed over time")
async def timeseries(
    filters: FilterDep,
    principal: CurrentUser,
    repo: RepoDep,
    cache: CacheDep,
    granularity: Granularity = "month",
) -> list[dict[str, Any]]:
    spec = filters.to_spec(principal)
    key = f"ts:{granularity}:{principal.role.value}:{spec.cache_key()}"
    return await cache.get_or_set(key, lambda: repo.timeseries(spec, granularity))


@router.get("/analytics/losses", summary="Recorded loss reasons by stage")
async def losses(
    filters: FilterDep,
    principal: CurrentUser,
    repo: RepoDep,
    cache: CacheDep,
    include_inferred: bool = False,
) -> list[dict[str, Any]]:
    spec = filters.to_spec(principal)
    key = f"loss:{include_inferred}:{principal.role.value}:{spec.cache_key()}"
    return await cache.get_or_set(
        key, lambda: repo.loss_breakdown(spec, include_inferred)
    )


@router.get("/analytics/aging", summary="Idle time of the live pipeline")
async def aging(
    filters: FilterDep,
    principal: CurrentUser,
    repo: RepoDep,
    cache: CacheDep,
) -> list[dict[str, Any]]:
    spec = filters.to_spec(principal)
    key = f"aging:{principal.role.value}:{spec.cache_key()}"
    return await cache.get_or_set(key, lambda: repo.aging(spec))


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------


@router.get("/applications", summary="Application records")
async def applications(
    request: Request,
    filters: FilterDep,
    principal: CurrentUser,
    repo: RepoDep,
    audit: AuditDep,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> dict[str, Any]:
    spec = filters.to_spec(principal)
    total, records = repo.applications(spec, offset, limit)

    await audit.record(
        principal=principal,
        action="read.applications",
        resource="applications",
        scope=spec.cache_key(),
        row_count=len(records),
        request=request,
    )

    items = [
        redact(
            {
                "id": app.id,
                "applied_on": app.applied_on,
                "stage_reached": app.stage_reached.value,
                "outcome": app.outcome.value,
                "full_name": app.candidate.full_name,
                "phone": app.candidate.phone,
                "email": app.candidate.email,
                "cnic": app.candidate.cnic,
                "degree": app.candidate.degree,
                "institute": app.candidate.institute,
                "industry": app.candidate.industry,
                "experience_years": app.candidate.experience_years,
                "last_salary": app.candidate.last_salary,
                "sales_pitch_status": app.sales_pitch_status,
                "offer_status": app.offer_status,
                "actual_start_on": app.actual_start_on,
                "time_to_hire": app.time_to_hire,
                "days_idle": app.days_idle,
                "loss_category": app.loss_category,
                "loss_reason": app.loss_reason,
                "remarks": app.remarks,
            },
            principal.role,
        )
        for app in records
    ]
    return {"total": total, "offset": offset, "limit": limit, "items": items}


@router.get("/dimensions/{dimension}/values", summary="Distinct values for a filter")
async def dimension_values(
    dimension: str,
    principal: CurrentUser,
    repo: RepoDep,
    cache: CacheDep,
) -> list[str]:
    if dimension not in DIMENSIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown dimension '{dimension}'.",
        )
    return await cache.get_or_set(
        f"dimvals:{dimension}", lambda: repo.dimension_values(dimension)
    )


# ---------------------------------------------------------------------------
# Exports
# ---------------------------------------------------------------------------


@router.post("/exports/{report_id}", summary="Queue a report export")
async def queue_export(
    report_id: Literal["executive", "recruiter", "pipeline", "source", "loss", "talent"],
    request: Request,
    filters: FilterDep,
    principal: RequireManager,
    audit: AuditDep,
) -> dict[str, str]:
    """Exports run on the Celery worker.

    A board report over an unfiltered dataset is a multi-second query; holding
    a request thread for it would starve the interactive dashboard, which is
    the thing users actually notice.
    """
    from app.workers.tasks import build_report

    spec = filters.to_spec(principal)
    task = build_report.delay(report_id, spec.cache_key(), principal.email)

    await audit.record(
        principal=principal,
        action="export.queued",
        resource=f"report:{report_id}",
        scope=spec.cache_key(),
        request=request,
    )
    return {"task_id": task.id, "status": "queued", "report": report_id}


@router.get("/exports/{task_id}/status", summary="Poll an export")
async def export_status(task_id: str, principal: RequireManager) -> dict[str, Any]:
    from app.workers.celery_app import celery_app

    result = celery_app.AsyncResult(task_id)
    return {
        "task_id": task_id,
        "state": result.state,
        "ready": result.ready(),
        "result": result.result if result.successful() else None,
        "error": str(result.info) if result.failed() else None,
    }


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------


@router.get("/meta", summary="Dataset metadata")
async def meta(principal: CurrentUser, repo: RepoDep) -> dict[str, Any]:
    from sqlalchemy import func, select

    from app.models.recruitment import Application, SyncRun

    bounds = repo.session.execute(
        select(
            func.min(Application.applied_on),
            func.max(Application.applied_on),
            func.count(Application.id),
        )
    ).one()

    last_sync = repo.session.execute(
        select(SyncRun).order_by(SyncRun.started_at.desc()).limit(1)
    ).scalar_one_or_none()

    return {
        "date_min": bounds[0],
        "date_max": bounds[1],
        "row_count": bounds[2],
        "stages": [s.value for s in Stage],
        "outcomes": [o.value for o in Outcome],
        "dimensions": sorted(DIMENSIONS),
        "role": principal.role.value,
        "last_sync": {
            "status": last_sync.status,
            "finished_at": last_sync.finished_at,
            "rows_written": last_sync.rows_written,
        }
        if last_sync
        else None,
    }


@router.get("/health", summary="Liveness and readiness")
async def health(repo: RepoDep, cache: CacheDep) -> dict[str, Any]:
    from sqlalchemy import text

    checks: dict[str, str] = {}
    try:
        repo.session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:  # noqa: BLE001 — health must report, never raise
        checks["database"] = f"error: {exc}"

    checks["cache"] = "ok" if await cache.ping() else "degraded"

    healthy = all(v == "ok" for v in checks.values())
    return {"status": "healthy" if healthy else "degraded", "checks": checks}
