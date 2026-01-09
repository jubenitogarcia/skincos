import os, asyncio, httpx, time, logging, random
from logging_config import setup_logging

setup_logging()
logger = logging.getLogger("worker")

WHATSAPP_BASE_URL = os.getenv("WHATSAPP_BASE_URL", "http://whatsapp-api:3001")
WHATSAPP_API_KEY = os.getenv("WHATSAPP_API_KEY")
DEFAULT_INTENT_REPLY = {
    "saudacao": "Olá! Como posso ajudar?",
    "pedido_status": "Informe o número do pedido para eu consultar.",
    "fallback": "Poderia detalhar melhor sua solicitação?",
}

def classify(body: str):
    if not body:
        return "fallback"
    b = body.lower()
    if "pedido" in b:
        return "pedido_status"
    if any(k in b for k in ["oi", "olá", "ola", "bom dia", "boa tarde"]):
        return "saudacao"
    return "fallback"

async def respond(message):
    intent = classify(message.get("body", ""))
    reply = DEFAULT_INTENT_REPLY[intent]
    number = message.get("contactId") or message.get("from") or message.get("number")
    if not number:
        return
    logger.info("intent=%s number=%s body=%r", intent, number, message.get('body'))
    payload = {
        "number": number,
        "type": "text",
        "message": reply,
        "meta": {"source": "agent-zero", "intent": intent},
    }
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.post(f"{WHATSAPP_BASE_URL}/v1/messages", json=payload)
            r.raise_for_status()
        except Exception as e:  # noqa
            logger.error("send error: %s", e)
            raise

async def loop():
    logger.info("started")
    from az_queue import queue as _queue
    while True:
        ev = await _queue.get()
        logger.debug("event id=%s type=%s ts=%s", ev.get('message', {}).get('id'), ev.get('event'), ev.get('timestamp'))
        if ev.get("event") == "message_received":
            msg = ev.get("message", {})
            if msg.get("direction") == "inbound":
                for attempt in range(3):
                    try:
                        await respond(msg)
                        break
                    except Exception:
                        if attempt == 2:
                            logger.error("failed after retries for message %s", msg.get('id'))
                        else:
                            await asyncio.sleep(0.5 * (2 ** attempt) + random.random()/10)

if __name__ == "__main__":
    asyncio.run(loop())
