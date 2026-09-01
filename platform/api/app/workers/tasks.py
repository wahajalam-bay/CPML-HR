"""Background tasks: Sheets ingestion, view refresh, exports, retention."""

from __future__ import annotations

import datetime as dt
import logging

from sqlalchemy import text

from app.api.deps import SessionLocal
from app.models.recruitment import AuditLog, SyncRun
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)

# Rebuilt after each sync. These carry the aggregates that would otherwise be
# recomputed on every dashboard load.
MATERIALIZED_VIEWS = (
    "mv_daily_funnel",
    "mv_recruiter_performance",
    "mv_source_performance",
    "mv_stage_durations",
)


@celery_app.task(bind=True, max_retries=3, name="app.workers.tasks.sync_from_sheets")
def sync_from_sheets(self, full: bool = False) -> dict[str, int | str]:
    """Pull the operational sheet and upsert it into Postgres.

    Google Sheets remains the source of truth — recruiters work in it all day.
    This service never writes back; it maintains a read-optimised projection
    and rebuilds derived state from it.
    """
    session = SessionLocal()
    run = SyncRun(status="running")
    session.add(run)
    session.commit()

    try:
        from app.services.sheets import SheetsIngestor

        ingestor = SheetsIngestor(session)
        result = ingestor.run(full_refresh=full)

        run.rows_read = result.rows_read
        run.rows_written = result.rows_written
        run.rows_rejected = result.rows_rejected
        run.status = "succeeded"
        run.finished_at = dt.datetime.now(dt.UTC)
        session.commit()

        refresh_materialized_views.delay()
        _drop_cache()

        log.info(
            "Sheet sync complete: read %s, wrote %s, rejected %s",
            result.rows_read,
            result.rows_written,
            result.rows_rejected,
        )
        return {
            "status": "succeeded",
            "rows_read": result.rows_read,
            "rows_written": result.rows_written,
            "rows_rejected": result.rows_rejected,
        }

    except Exception as exc:
        session.rollback()
        run.status = "failed"
        run.error = str(exc)[:4000]
        run.finished_at = dt.datetime.now(dt.UTC)
        session.commit()
        log.exception("Sheet sync failed")
        # Sheets rate limits and transient network faults are the common
        # failure here, so back off rather than give up.
        raise self.retry(exc=exc, countdown=60 * (2**self.request.retries)) from exc
    finally:
        session.close()


@celery_app.task(name="app.workers.tasks.refresh_materialized_views")
def refresh_materialized_views() -> dict[str, list[str]]:
    session = SessionLocal()
    refreshed: list[str] = []
    failed: list[str] = []
    try:
        for view in MATERIALIZED_VIEWS:
            try:
                # CONCURRENTLY keeps the dashboard readable during the rebuild.
                session.execute(text(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {view}"))
                session.commit()
                refreshed.append(view)
            except Exception as exc:  # noqa: BLE001
                session.rollback()
                failed.append(view)
                log.error("Could not refresh %s: %s", view, exc)
        _drop_cache()
        return {"refreshed": refreshed, "failed": failed}
    finally:
        session.close()


@celery_app.task(name="app.workers.tasks.build_report")
def build_report(report_id: str, scope: str, requested_by: str) -> dict[str, str]:
    """Render a report off the request path.

    A board report over the full dataset is a multi-second query; running it
    inline would hold a request worker and slow the interactive dashboard,
    which is the latency users actually feel.
    """
    session = SessionLocal()
    try:
        from app.services.reporting import ReportBuilder

        builder = ReportBuilder(session)
        artifact = builder.build(report_id, scope)
        log.info("Built report %s for %s (%s)", report_id, requested_by, artifact.uri)
        return {
            "report": report_id,
            "uri": artifact.uri,
            "content_type": artifact.content_type,
            "generated_at": artifact.generated_at.isoformat(),
        }
    finally:
        session.close()


@celery_app.task(name="app.workers.tasks.prune_audit_log")
def prune_audit_log(retain_days: int = 400) -> dict[str, int]:
    """Trim audit history past the retention window.

    Slightly over a year, so a full annual review always has the prior
    period available to compare against.
    """
    session = SessionLocal()
    try:
        cutoff = dt.datetime.now(dt.UTC) - dt.timedelta(days=retain_days)
        deleted = (
            session.query(AuditLog).filter(AuditLog.occurred_at < cutoff).delete()
        )
        session.commit()
        log.info("Pruned %s audit rows older than %s days", deleted, retain_days)
        return {"deleted": deleted}
    finally:
        session.close()


def _drop_cache() -> None:
    """Invalidate cached responses from a synchronous worker context."""
    import asyncio

    from app.api.deps import get_cache
    from app.core.config import get_settings

    try:
        asyncio.run(get_cache(get_settings()).invalidate_all())
    except Exception as exc:  # noqa: BLE001
        log.warning("Cache invalidation after sync failed: %s", exc)
