import os, hmac, hashlib, json, logging, time
from collections import deque
from typing import Any
from fastapi import FastAPI, Request, HTTPException, Header
from fastapi.responses import JSONResponse, PlainTextResponse
import uvicorn

from az_queue import queue, dedupe  # fallback in-memory
from config import get_settings
from middleware.log_correlation import CorrelationIdMiddleware
from multi_tenant import resolve_tenant
from queues.redis_queue import build_queue as build_redis_queue
from storage.processed_events_store import build_store as build_dedupe_store
from metrics import router as metrics_router, events_received_total, events_duplicate_total, requests_total
from debug_state import get_replies

WHATSAPP_WEBHOOK_SECRET = os.getenv("WHATSAPP_WEBHOOK_SECRET", "CHANGE_ME")
APP_PORT = int(os.getenv("AGENT_ZERO_PORT", "4000"))
BASE_PREFIX = '' if os.getenv("WEBHOOK_EMBEDDED") == '1' else '/agent-zero'

from logging_config import setup_logging
setup_logging()

settings = get_settings()
app = FastAPI(title="Agent-Zero Webhook Listener")
app.add_middleware(CorrelationIdMiddleware)
if metrics_router:
    app.include_router(metrics_router)
def _load_api_key() -> str:
    if os.getenv("DISABLE_WEBHOOK_API_KEY") == "1":
        return ""
    return os.getenv("WEBHOOK_API_KEY") or os.getenv("API_KEY") or ""

_configured_api_key = _load_api_key()
if _configured_api_key:
    logging.getLogger("webhook").info("Webhook API key protection ENABLED")
else:
    logging.getLogger("webhook").info("Webhook API key protection DISABLED")
logger = logging.getLogger("webhook")
# Debug ring buffer always on (max 100)
_last_events = deque(maxlen=100)
_last_errors = deque(maxlen=100)

def verify_signature(secret: str, body: bytes, signature: str | None):
    if not signature:
        return False
    mac = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    try:
        return hmac.compare_digest(mac, signature)
    except Exception:
        return False

_redis_queue = None
_dedupe_store = None
try:
    if settings.queue_backend == 'redis':
        _redis_queue = build_redis_queue(settings)
        _dedupe_store = build_dedupe_store(settings)
        logging.getLogger('webhook').info('Redis backend habilitado')
except Exception as e:  # pragma: no cover
    logging.getLogger('webhook').error('Falha init Redis backend: %s', e)

@app.post(f"{BASE_PREFIX}/webhooks/whatsapp")
async def whatsapp_webhook(
    req: Request,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    x_event_id: str | None = Header(default=None, alias="X-Event-Id"),
    x_event_type: str | None = Header(default=None, alias="X-Event-Type"),
):
    raw = await req.body()
    sig = req.headers.get("X-Signature")
    if not verify_signature(WHATSAPP_WEBHOOK_SECRET, raw, sig):
        _last_errors.append({
            "ts": int(time.time()),
            "type": "invalid_signature",
            "reason": "signature_mismatch",
            "path": "/agent-zero/webhooks/whatsapp"
        })
        raise HTTPException(status_code=401, detail="invalid signature")
    # Recarrega dinamicamente para permitir toggle sem reiniciar container amplo
    global _configured_api_key
    _configured_api_key = _load_api_key()
    api_key_required = _configured_api_key
    if api_key_required and x_api_key != api_key_required:
        _last_errors.append({
            "ts": int(time.time()),
            "type": "invalid_api_key",
            "reason": "api_key_mismatch",
            "path": "/agent-zero/webhooks/whatsapp"
        })
        raise HTTPException(status_code=401, detail="invalid api key")
    try:
        event = json.loads(raw.decode())
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json")
    # timestamp skew validation
    ts = event.get('timestamp')
    if ts and isinstance(ts, int):
        if abs(time.time() - ts) > 300:
            _last_errors.append({
                "ts": int(time.time()),
                "type": "timestamp_out_of_range",
                "event_id": x_event_id,
                "path": "/agent-zero/webhooks/whatsapp"
            })
            return {"accepted": False, "reason": "timestamp_out_of_range"}
    tenant = resolve_tenant(req.headers.get('host'), req.headers)
    event_type = x_event_type or event.get('event') or 'unknown'
    event_id = x_event_id or event.get("id") or f"{event.get('event')}::{event.get('message',{}).get('id')}::{event.get('timestamp')}"
    if requests_total:
        requests_total.labels(path='/agent-zero/webhooks/whatsapp', method='POST', status='pending').inc()
    if _dedupe_store and event_id:
        if not _dedupe_store.mark_if_new(tenant, event_id):
            if events_duplicate_total:
                events_duplicate_total.labels(event_type=event_type).inc()
            _last_errors.append({
                "ts": int(time.time()),
                "type": "duplicate_event",
                "event_id": event_id,
                "tenant": tenant
            })
            return {"accepted": False, "duplicate": True}
    else:
        from az_queue import dedupe as _dedupe
        if not _dedupe(event_id):
            logger.debug("duplicate event %s", event_id)
            _last_errors.append({
                "ts": int(time.time()),
                "type": "duplicate_event",
                "event_id": event_id,
                "tenant": tenant
            })
            return {"accepted": False, "duplicate": True}
    # Guard contra loop: se mensagem marcada como fromMe True não enfileira
    try:
        if event.get('message', {}).get('fromMe') is True:
            logger.debug("Ignoring webhook event fromMe id=%s", event.get('message', {}).get('id'))
            return {"accepted": False, "ignored": True, "reason": "fromMe"}
        body_txt = (event.get('message', {}).get('body') or '').strip()
        if body_txt and body_txt == settings.intent_default_reply:
            logger.debug("Ignoring echo of default reply id=%s", event.get('message', {}).get('id'))
            return {"accepted": False, "ignored": True, "reason": "echo_default"}
    except Exception:
        pass
    enriched = {"payload": event, "attempt": 0, "tenant": tenant, "event_type": event_type}
    if _redis_queue:
        _redis_queue.put(enriched)
    else:
        from az_queue import queue as _queue
        await _queue.put(enriched)
    if events_received_total:
        events_received_total.labels(event_type=event_type).inc()
    logger.info("accepted event %s tenant=%s", event_id, tenant)
    _last_events.append({
            "ts": int(time.time()),
            "event_id": event_id,
            "event_type": event_type,
            "tenant": tenant,
            "message_id": event.get('message',{}).get('id')
        })
    if requests_total:
        requests_total.labels(path='/agent-zero/webhooks/whatsapp', method='POST', status='200').inc()
    return {"accepted": True, "tenant": tenant}

@app.get(f"{BASE_PREFIX}/debug/events")
async def debug_events(raw: bool = False):  # type: ignore
    data = list(_last_events)
    if raw:
        return PlainTextResponse(json.dumps(data, ensure_ascii=False))
    return JSONResponse(content=data)

@app.get(f"{BASE_PREFIX}/debug/errors")
async def debug_errors(raw: bool = False):  # type: ignore
    data = list(_last_errors)
    if raw:
        return PlainTextResponse(json.dumps(data, ensure_ascii=False))
    return JSONResponse(content=data)

@app.get(f"{BASE_PREFIX}/debug/stats")
async def debug_stats(raw: bool = False):  # type: ignore
    # Build snapshot of key metrics and queue state
    stats: dict[str, Any] = {
        "queue_backend": settings.queue_backend,
        "events_buffer_size": len(_last_events),
        "errors_buffer_size": len(_last_errors),
        "dedupe_backend": "redis" if _dedupe_store else "memory"
    }
    # Queue size (redis only for now)
    if _redis_queue:
        try:
            stats["queue_size"] = _redis_queue.size()
        except Exception:
            stats["queue_size"] = None
    # Redis counters
    if _redis_queue:
        try:
            stats["processed_success"] = int(_redis_queue.client.get('stats:processed_success') or 0)
            stats["processed_failed"] = int(_redis_queue.client.get('stats:processed_failed') or 0)
        except Exception:
            pass
    # Prometheus counters snapshot
    try:
        from metrics import events_received_total, events_processed_total, events_duplicate_total, events_intent_total
        def collect_counter(counter):
            data = {}
            if not counter:
                return data
            for fam in counter.collect():
                for s in fam.samples:
                    # sample.name, labels dict, value
                    lbl_key = ",".join(f"{k}={v}" for k,v in sorted(s.labels.items())) or "_"
                    data[lbl_key] = s.value
            return data
        stats["metrics"] = {
            "events_received_total": collect_counter(events_received_total),
            "events_duplicate_total": collect_counter(events_duplicate_total),
            "events_processed_total": collect_counter(events_processed_total),
            "events_intent_total": collect_counter(events_intent_total),
        }
    except Exception:
        pass
    if raw:
        # deliver as plain text JSON to bypass potential proxy content injection
        return PlainTextResponse(json.dumps(stats, ensure_ascii=False))
    return JSONResponse(content=stats)

@app.get(f"{BASE_PREFIX}/debug/ping")
async def debug_ping():  # type: ignore
    return {"pong": True, "ts": int(time.time())}

@app.post(f"{BASE_PREFIX}/debug/inject")
async def debug_inject(payload: dict):  # type: ignore
    """Injeta uma mensagem simulada (para testes curl) sem passar pelo gateway."""
    msg_id = payload.get('id') or f"inject_{int(time.time()*1000)}"
    event = {
        "event": "message_received",
        "timestamp": int(time.time()),
        "message": {
            "id": msg_id,
            "from": payload.get('from') or 'test_user@c.us',
            "body": payload.get('body') or '',
            "fromMe": False
        }
    }
    if _redis_queue:
        _redis_queue.put({"payload": event, "attempt": 0, "tenant": 'default', "event_type": 'message_received'})
    else:
        from az_queue import queue as _queue
        await _queue.put(event)
    return {"accepted": True, "injected": True, "id": msg_id}

@app.get("/")
async def root():  # type: ignore
    return {"status": "ok", "service": "agent-zero-webhook"}

@app.get(f"{BASE_PREFIX}/debug/security")
async def debug_security():  # type: ignore
    key = _configured_api_key
    return {
        "api_key_enabled": bool(key),
        "api_key_length": len(key) if key else 0,
        "hmac_secret_set": WHATSAPP_WEBHOOK_SECRET != 'CHANGE_ME'
    }

@app.get(f"{BASE_PREFIX}/debug/replies")
def debug_replies():
    return JSONResponse(get_replies())

@app.get("/health")
async def health():
    return {"status": "ok"}

def main():
    uvicorn.run(app, host="0.0.0.0", port=APP_PORT)

if __name__ == "__main__":
    main()
