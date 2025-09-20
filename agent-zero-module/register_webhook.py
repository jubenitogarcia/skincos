import os, httpx, sys

WHATSAPP_BASE_URL = os.getenv("WHATSAPP_BASE_URL", "http://whatsapp-api:3001")
WHATSAPP_WEBHOOK_SECRET = os.getenv("WHATSAPP_WEBHOOK_SECRET", "CHANGE_ME")
AGENT_WEBHOOK_PUBLIC_URL = os.getenv("AGENT_WEBHOOK_PUBLIC_URL")
EVENTS = ["message_received", "message_annotated", "message_status_updated"]

def main():
    if not AGENT_WEBHOOK_PUBLIC_URL:
        print("AGENT_WEBHOOK_PUBLIC_URL não definido", file=sys.stderr)
        return
    payload = {
        "url": AGENT_WEBHOOK_PUBLIC_URL,
        "secret": WHATSAPP_WEBHOOK_SECRET,
        "events": EVENTS,
    }
    try:
        r = httpx.post(f"{WHATSAPP_BASE_URL}/v1/webhooks", json=payload, timeout=15)
        if r.status_code >= 300:
            print("Falha:", r.status_code, r.text)
        else:
            print("Webhook registrado:", r.json())
    except Exception as e:  # noqa
        print(f"Erro ao registrar webhook: {e}")

if __name__ == "__main__":
    main()
