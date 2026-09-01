"""Celery application and schedule."""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "cpml",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Karachi",
    enable_utc=True,
    # A sync that outlives its window is stuck, not slow — fail it rather than
    # let two syncs overlap on the same tables.
    task_time_limit=30 * 60,
    task_soft_time_limit=25 * 60,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    result_expires=24 * 3600,
)

celery_app.conf.beat_schedule = {
    "sync-google-sheet": {
        "task": "app.workers.tasks.sync_from_sheets",
        "schedule": crontab(minute=0, hour="*/2"),
    },
    "refresh-materialized-views": {
        "task": "app.workers.tasks.refresh_materialized_views",
        # Fifteen minutes after the sync, so views rebuild on settled data.
        "schedule": crontab(minute=15, hour="*/2"),
    },
    "prune-audit-log": {
        "task": "app.workers.tasks.prune_audit_log",
        "schedule": crontab(minute=30, hour=3, day_of_week=0),
    },
}
