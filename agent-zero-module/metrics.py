from __future__ import annotations
from typing import Optional
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from fastapi import APIRouter, Response
from config import get_settings

settings = get_settings()
router: Optional[APIRouter] = None

if settings.metrics_enabled:
    router = APIRouter()
    requests_total = Counter('requests_total', 'Total HTTP requests', ['path', 'method', 'status'])
    events_received_total = Counter('events_received_total', 'Inbound events received', ['event_type'])
    events_duplicate_total = Counter('events_duplicate_total', 'Duplicate events', ['event_type'])
    events_processed_total = Counter('events_processed_total', 'Events processed', ['status'])
    events_intent_total = Counter('events_intent_total', 'Events classified by intent', ['intent'])
    processing_latency = Histogram('event_processing_latency_seconds', 'Latency processing events')

    @router.get('/metrics')
    async def metrics():  # type: ignore
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
else:  # pragma: no cover
    requests_total = None  # type: ignore
    events_received_total = None  # type: ignore
    events_duplicate_total = None  # type: ignore
    events_processed_total = None  # type: ignore
    events_intent_total = None  # type: ignore
    processing_latency = None  # type: ignore
