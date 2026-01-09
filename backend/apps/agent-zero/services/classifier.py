from __future__ import annotations
import re
from typing import Dict

_PATTERNS = [
    (re.compile(r"\b(status|pedido|tracking)\b", re.I), "order_status"),
    (re.compile(r"\b(oi|ol[aá])\b", re.I), "greeting"),
    (re.compile(r"\b(cancel(ar)?|remover)\b", re.I), "cancel_order"),
    # Identidade do bot
    (re.compile(r"\b(seu nome|qual (é|eh) o seu nome|quem (é|eh) você|quem é voce|quem eh voce|quem é vc|quem eh vc)\b", re.I), "bot_identity"),
]

class Classifier:
    def classify(self, text: str) -> Dict:
        lowered = text.strip().lower()
        for rx, intent in _PATTERNS:
            if rx.search(lowered):
                return {"intent": intent, "confidence": 0.85}
        return {"intent": "unknown", "confidence": 0.40}

classifier = Classifier()
