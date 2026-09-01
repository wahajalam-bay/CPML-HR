"""Application entrypoint."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import engine, get_cache
from app.api.routes import router
from app.core.config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
)
log = logging.getLogger("cpml.api")

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    log.info("Starting %s in %s mode", settings.app_name, settings.environment)
    yield
    cache = get_cache(settings)
    await cache.close()
    engine.dispose()
    log.info("Shutdown complete")


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description=(
        "Recruitment analytics for the CPML Command Center. Google Sheets stays "
        "the operational source of truth; this service serves the optimised "
        "Postgres projection of it."
    ),
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
    docs_url="/docs" if not settings.is_production else None,
    redoc_url=None,
    openapi_url=f"{settings.api_prefix}/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
# Analytics payloads are highly repetitive JSON and compress to a fraction of
# their size; the CPU cost is trivial next to the transfer saving.
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.exception_handler(SQLAlchemyError)
async def database_error_handler(request: Request, exc: SQLAlchemyError):
    """Return a usable message without leaking schema details to the client."""
    log.exception("Database error on %s", request.url.path)
    return ORJSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "detail": (
                "The analytics database is not responding. The dashboard will "
                "recover automatically once it is back."
            )
        },
    )


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return ORJSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": str(exc)},
    )


app.include_router(router, prefix=settings.api_prefix)


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {
        "service": settings.app_name,
        "version": "1.0.0",
        "docs": "/docs" if not settings.is_production else "disabled",
        "api": settings.api_prefix,
    }
