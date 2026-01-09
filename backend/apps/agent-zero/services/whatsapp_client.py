from __future__ import annotations
import httpx
import logging
from typing import Optional
from config import get_settings

logger = logging.getLogger("whatsapp_client")

class WhatsappClient:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.base = self.settings.whatsapp_base_url.rstrip("/") if self.settings.whatsapp_base_url else ""
        self.api_key = self.settings.whatsapp_api_key
        self._client = httpx.AsyncClient(timeout=15)

    async def send_message(self, to: str, body: str) -> bool:
        if not self.base:
            logger.warning("WHATSAPP_BASE_URL não configurado; simulando envio.")
            return True
        # Gateway espera: number (ou to), message, type='text'
        payload = {"to": to, "number": to, "message": body, "type": "text"}
        headers: dict[str, str] = {}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        try:
            r = await self._client.post(f"{self.base}/v1/messages", json=payload, headers=headers)
            if r.status_code // 100 == 2:
                return True
            logger.warning("Falha envio mensagem status=%s body=%s", r.status_code, r.text[:200])
        except Exception as e:
            logger.error("Erro envio mensagem: %s", e)
        return False

    async def annotate(self, message_id: str, data: dict) -> None:
        if not self.base:
            return
        headers = {}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        try:
            await self._client.post(f"{self.base}/v1/messages/{message_id}/annotations", json=data, headers=headers)
        except Exception as e:
            logger.debug("Falha anotação: %s", e)

client = WhatsappClient()
