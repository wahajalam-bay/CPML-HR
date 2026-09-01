"""Request-scoped dependencies."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, get_settings
from app.repositories.analytics import AnalyticsRepository
from app.services.audit import AuditService
from app.services.cache import CacheService

_settings = get_settings()

engine = create_engine(
    _settings.database_url,
    pool_size=_settings.db_pool_size,
    max_overflow=_settings.db_max_overflow,
    pool_pre_ping=True,
    echo=_settings.db_echo,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


SessionDep = Annotated[Session, Depends(get_session)]


def get_repository(session: SessionDep) -> AnalyticsRepository:
    return AnalyticsRepository(session)


_cache: CacheService | None = None


def get_cache(settings: Annotated[Settings, Depends(get_settings)]) -> CacheService:
    global _cache
    if _cache is None:
        _cache = CacheService(settings.redis_url, settings.cache_ttl_seconds)
    return _cache


def get_audit(session: SessionDep) -> AuditService:
    return AuditService(session)
