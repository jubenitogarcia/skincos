from __future__ import annotations
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        cid = request.headers.get("X-Correlation-Id") or request.headers.get("X-Request-Id") or str(uuid.uuid4())
        request.state.correlation_id = cid
        response: Response = await call_next(request)
        response.headers["X-Correlation-Id"] = cid
        return response
