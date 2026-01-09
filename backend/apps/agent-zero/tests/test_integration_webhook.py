import asyncio, json, hmac, hashlib
import httpx
import threading
import time
import os
from logging_config import setup_logging

# Start webhook + worker using run_local.main if available

async def start_runtime():
    import run_local  # type: ignore
    await run_local.main()

started = False

def launch():
    global started
    if started:
        return
    started = True
    def runner():
        asyncio.run(start_runtime())
    t = threading.Thread(target=runner, daemon=True)
    t.start()
    # give server time to boot
    time.sleep(1.2)

async def send_event():
    secret = os.getenv('WHATSAPP_WEBHOOK_SECRET', 'CHANGE_ME')
    body = {
        "event": "message_received",
        "timestamp": int(time.time()),
        "message": {"id": "test-int", "direction": "inbound", "from": "55119999999", "body": "oi"}
    }
    raw = json.dumps(body).encode()
    sig = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    async with httpx.AsyncClient() as client:
        r = await client.post('http://localhost:4000/agent-zero/webhooks/whatsapp', data=raw, headers={"Content-Type":"application/json","X-Signature":sig})
        return r.status_code, r.json()

async def test_integration():
    setup_logging()
    launch()
    code, data = await send_event()
    assert code == 200
    assert data.get('accepted') is True
