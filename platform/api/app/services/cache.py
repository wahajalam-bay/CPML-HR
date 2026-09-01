"""Redis-backed response cache.

Cache failure is never allowed to become request failure: if Redis is down the
service degrades to querying Postgres directly, which is slower but correct.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import TypeVar

import orjson
import redis.asyncio as redis

log = logging.getLogger(__name__)

T = TypeVar("T")


class CacheService:
    def __init__(self, url: str, ttl_seconds: int) -> None:
        self._client = redis.from_url(url, decode_responses=False)
        self._ttl = ttl_seconds

    async def ping(self) -> bool:
        try:
            return bool(await self._client.ping())
        except Exception:  # noqa: BLE001
            return False

    async def get_or_set(self, key: str, producer: Callable[[], T]) -> T:
        namespaced = f"cpml:v1:{key}"
        try:
            cached = await self._client.get(namespaced)
            if cached is not None:
                return orjson.loads(cached)
        except Exception as exc:  # noqa: BLE001
            log.warning("Cache read failed for %s, falling through to source: %s", key, exc)

        value = producer()

        try:
            await self._client.setex(
                namespaced,
                self._ttl,
                orjson.dumps(value, option=orjson.OPT_SERIALIZE_NUMPY),
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("Cache write failed for %s: %s", key, exc)

        return value

    async def invalidate_all(self) -> int:
        """Drop every cached response. Called after a successful sync."""
        deleted = 0
        try:
            async for key in self._client.scan_iter(match="cpml:v1:*", count=500):
                await self._client.delete(key)
                deleted += 1
        except Exception as exc:  # noqa: BLE001
            log.warning("Cache invalidation failed: %s", exc)
        return deleted

    async def close(self) -> None:
        await self._client.aclose()
