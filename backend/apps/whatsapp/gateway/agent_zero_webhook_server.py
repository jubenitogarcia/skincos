"""
FastAPI minimal webhook receiver for Agent-Zero integration tests.

Run:
  pip install fastapi uvicorn "python-multipart" pydantic httpx
  python agent_zero_webhook_server.py

It exposes:
  POST /agent-zero/webhooks/whatsapp (expects HMAC SHA256 in X-Signature)
  GET  /health

Environment:
  PORT (default 4000)
  WHATSAPP_WEBHOOK_SECRET (same used when registering webhook)

Logs each event and returns {"received": true} with 200.
"""
import os
import hmac
import hashlib
from typing import Any, Dict
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
import uvicorn

SECRET = os.getenv("WHATSAPP_WEBHOOK_SECRET", "AGZ_SECRET_123")
PORT = int(os.getenv("PORT", "4000"))

app = FastAPI(title="Agent-Zero Webhook Receiver", version="1.0.0")

def valid_signature(sig: str | None, body: bytes) -> bool:
    if not sig:
        return False
    mac = hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    try:
        return hmac.compare_digest(mac, sig)
    except Exception:
        return False

@app.post("/agent-zero/webhooks/whatsapp")
async def webhook(request: Request):
    raw = await request.body()
    signature = request.headers.get("X-Signature")
    if not valid_signature(signature, raw):
        raise HTTPException(status_code=401, detail="invalid signature")
    try:
        payload: Dict[str, Any] = await request.json()
    except Exception:
        payload = {}
    print("[EVENT]", payload.get("event"), payload.get("eventId"))
    return JSONResponse({"received": True, "event": payload.get("event")})

@app.get("/health")
async def health():
    return {"ok": True}

if __name__ == "__main__":
    print(f"Starting Agent-Zero test webhook server on :{PORT}")
    uvicorn.run("agent_zero_webhook_server:app", host="0.0.0.0", port=PORT, reload=False)
