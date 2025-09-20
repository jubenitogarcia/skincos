from __future__ import annotations
import json
from typing import Any, Optional

try:
    import redis  # type: ignore
except ImportError:  # pragma: no cover
    redis = None  # type: ignore

class RedisQueue:
    def __init__(self, client, name: str) -> None:
        self.client = client
        self.name = name

    def put(self, item: dict) -> None:
        self.client.lpush(self.name, json.dumps(item, ensure_ascii=False))

    def pop(self, timeout: int = 5) -> Optional[dict]:
        res = self.client.brpop(self.name, timeout=timeout)
        if not res:
            return None
        _, raw = res
        try:
            return json.loads(raw)
        except Exception:
            return {"_raw": raw.decode("utf-8", "ignore"), "_error": "json_decode_failed"}

    def size(self) -> int:
        return int(self.client.llen(self.name))


def build_queue(settings) -> Any:
    if settings.queue_backend != "redis":
        return None
    if redis is None:
        raise RuntimeError("redis package not installed")
    client = redis.from_url(settings.redis_url, decode_responses=True)
    return RedisQueue(client, "queue:inbound:default")
