import hmac, hashlib, json
from webhook_server import verify_signature, WHATSAPP_WEBHOOK_SECRET

def test_verify_signature():
    body = json.dumps({"a": 1}).encode()
    sig = hmac.new(WHATSAPP_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    assert verify_signature(WHATSAPP_WEBHOOK_SECRET, body, sig) is True
    assert verify_signature(WHATSAPP_WEBHOOK_SECRET, body, "bad") is False
