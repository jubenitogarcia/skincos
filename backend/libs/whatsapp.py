"""
WhatsApp integration helpers (flattened).

Exports:
- WhatsAppClient: HTTP client with endpoint fallback and health checks.
- MessageSender: convenience service to send messages/media using the client.

Kept compatible with previous `libs.whatsapp_integration.*` imports via re-export
in `backend/libs/whatsapp_integration.py`.
"""

import hashlib
import logging
import os
import time
from typing import Any, Dict, List, Optional

try:
    import requests
except ModuleNotFoundError as exc:  # pragma: no cover
    if getattr(exc, "name", None) == "requests":
        raise ModuleNotFoundError(
            "Dependência ausente: `requests`.\n"
            "Instale as dependências do backend "
            "(ex.: `python3 -m pip install -r backend/requirements.txt`)."
        ) from exc
    raise

from config import ConfigManager
from libs import outbox

logger = logging.getLogger(__name__)


class WhatsAppClient:
    """Cliente base para API WhatsApp com suporte a múltiplos endpoints."""

    def __init__(self):
        config = ConfigManager.get_config()
        self.whatsapp_config = config.get("whatsapp_config", {})
        self.primary_api_url = self.whatsapp_config.get("api_url")
        self.api_key = self.whatsapp_config.get("api_key")
        self.instance_id = self.whatsapp_config.get("instance_id")

        if not self.primary_api_url:
            raise ValueError("API URL do WhatsApp não configurada")
        if not self.api_key:
            raise ValueError("API Key do WhatsApp não configurada")

        self._endpoints = self._get_available_endpoints()
        self._current_endpoint_index = 0

    def _get_available_endpoints(self) -> List[str]:
        endpoints: List[str] = []
        if self.primary_api_url:
            endpoints.append(self.primary_api_url)
        alternative_endpoints = [
            "http://localhost:3001",
            "https://wa.skincos.com.br",
        ]
        for endpoint in alternative_endpoints:
            if endpoint != self.primary_api_url and endpoint not in endpoints:
                endpoints.append(endpoint)
        logger.info(f"🔗 Endpoints disponíveis: {len(endpoints)} - {endpoints}")
        return endpoints

    def _get_headers(self, content_type: str = "application/json") -> Dict[str, str]:
        headers = {
            "Content-Type": content_type,
            "User-Agent": "SKINCOS-WhatsApp-Client/2.0",
        }
        if self.api_key and self.api_key != "test-api-key":
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _test_endpoint_health(self, api_url: str) -> bool:
        try:
            logger.info(f"🔍 Testando endpoint: {api_url}")
            status_endpoints = ["/status", "/health", "/info"]
            for status_path in status_endpoints:
                try:
                    response = requests.get(
                        f"{api_url}{status_path}",
                        headers=self._get_headers(),
                        timeout=5,
                    )
                    if response.status_code == 200:
                        data = response.json()
                        is_ready = (
                            data.get("ready", False)
                            or data.get("status") == "online"
                            or data.get("status") == "READY"
                            or "success" in data
                        )
                        if is_ready:
                            logger.info(f"✅ Endpoint saudável: {api_url}{status_path}")
                            return True
                        logger.warning(
                            "⚠️ Endpoint responde mas não está ready: "
                            f"{api_url}{status_path}"
                        )
                        continue
                except requests.exceptions.RequestException:
                    continue
            logger.warning(f"❌ Endpoint não saudável: {api_url}")
            return False
        except Exception as e:  # pragma: no cover - best effort
            logger.warning(f"❌ Erro testando endpoint {api_url}: {e}")
            return False

    def _get_working_endpoint(self) -> Optional[str]:
        for i, endpoint in enumerate(self._endpoints):
            if self._test_endpoint_health(endpoint):
                self._current_endpoint_index = i
                return endpoint
        logger.error("❌ Nenhum endpoint WhatsApp disponível")
        return None

    def _make_request(self, method: str, path: str, **kwargs) -> requests.Response:
        last_exception = None
        current_endpoint = self._endpoints[self._current_endpoint_index]
        for attempt in range(len(self._endpoints)):
            try:
                if attempt > 0:
                    working_endpoint = self._get_working_endpoint()
                    if not working_endpoint:
                        break
                    current_endpoint = working_endpoint

                url = f"{current_endpoint}{path}"
                logger.info(f"🌐 Tentativa {attempt + 1}: {method} {url}")
                response = requests.request(
                    method=method,
                    url=url,
                    headers=self._get_headers(),
                    timeout=30,
                    **kwargs,
                )
                if response.status_code in [502, 503, 504]:
                    logger.warning(
                        "⚠️ Gateway error "
                        f"{response.status_code}, tentando próximo endpoint..."
                    )
                    self._current_endpoint_index = (
                        self._current_endpoint_index + 1
                    ) % len(self._endpoints)
                    continue
                logger.info(
                    f"📊 Resposta: {response.status_code} de {current_endpoint}"
                )
                return response
            except requests.exceptions.RequestException as e:
                logger.warning(f"⚠️ Erro conexão {current_endpoint}: {e}")
                last_exception = e
                self._current_endpoint_index = (self._current_endpoint_index + 1) % len(
                    self._endpoints
                )
                time.sleep(1)
                continue
        error_msg = (
            f"Todos os endpoints WhatsApp falharam. Último erro: {last_exception}"
        )
        logger.error(f"❌ {error_msg}")
        raise requests.exceptions.ConnectionError(error_msg)

    def send_message(
        self, phone_number: str, message: str, **kwargs
    ) -> requests.Response:
        endpoint_path = "/send"
        payload_formats = [
            ("number", {"number": phone_number, "message": message}),
            ("phone", {"phone": phone_number, "message": message}),
        ]
        last_exception = None
        for _format_label, payload in payload_formats:
            final_payload = payload.copy()
            if kwargs:
                final_payload.update(kwargs)
            try:
                response = self._make_request("POST", endpoint_path, json=final_payload)
                if response.status_code != 400:
                    return response
            except requests.exceptions.RequestException as e:
                last_exception = e
                continue
        error_msg = f"Não foi possível enviar a mensagem. Último erro: {last_exception}"
        logger.error(f"❌ {error_msg}")
        raise requests.exceptions.RequestException(error_msg)

    def send_media(
        self, phone_number: str, media_url: str, caption: Optional[str] = None, **kwargs
    ) -> requests.Response:
        if not media_url:
            raise ValueError("URL da mídia é obrigatória")
        payload = {"number": phone_number, "mediaUrl": media_url}
        if caption:
            payload["caption"] = caption
        payload.update(kwargs)
        return self._make_request("POST", "/send-media", json=payload)


class MessageSender:
    """Serviço para envio de mensagens via WhatsApp."""

    def __init__(self):
        self.client = WhatsAppClient()
        config = ConfigManager.get_config()
        self.whatsapp_config = config.get("whatsapp_config", {})

    @staticmethod
    def _mask_phone(phone_number: str) -> str:
        cleaned = "".join(filter(str.isdigit, phone_number or ""))
        if len(cleaned) <= 4:
            return "***"
        return f"***{cleaned[-4:]}"

    @staticmethod
    def _fingerprint_message(message: str) -> str:
        if not message:
            return "empty"
        return hashlib.sha256(message.encode("utf-8")).hexdigest()[:8]

    def send_message(
        self, phone_number: str, message: str, media_url: Optional[str] = None, **kwargs
    ) -> Optional[Any]:
        idempotency_key = kwargs.pop("idempotency_key", None)
        audit_context = kwargs.pop("audit_context", None)
        stream = kwargs.pop("audit_stream", "whatsapp_sends")
        force = bool(kwargs.pop("force", False)) or str(
            os.environ.get("SKINCOS_FORCE_SEND", "")
        ).lower() in (
            "1",
            "true",
            "yes",
            "y",
            "on",
        )

        safe_phone = self._mask_phone(phone_number)
        msg_len = len(message or "")
        msg_fp = self._fingerprint_message(message or "")
        logger.info(f"📤 Envio WhatsApp para {safe_phone} (len={msg_len}, fp={msg_fp})")
        if not message or not message.strip():
            raise ValueError("Mensagem não pode estar vazia")
        if not phone_number:
            raise ValueError("Número de telefone é obrigatório")
        phone_number = self._format_phone_number(phone_number)

        if (
            idempotency_key
            and not force
            and outbox.idempotency_key_sent(stream, str(idempotency_key))
        ):
            last = outbox.last_event_for_key(stream, str(idempotency_key))
            outbox.append_event(
                stream,
                {
                    "status": "skipped",
                    "reason": "idempotency_key_already_sent",
                    "idempotency_key": str(idempotency_key),
                    "phone": phone_number,
                    "message_len": len(message),
                    "message_preview": message[:120],
                    "media_url": media_url,
                    "context": audit_context,
                    "previous": last,
                },
            )
            logger.warning(f"⏭️ Skip: já enviado (idempotency_key={idempotency_key})")
            return {
                "status": "skipped",
                "idempotency_key": str(idempotency_key),
                "skipped": True,
            }

        outbox.append_event(
            stream,
            {
                "status": "attempt",
                "idempotency_key": str(idempotency_key) if idempotency_key else None,
                "phone": phone_number,
                "message_len": len(message),
                "message_preview": message[:120],
                "media_url": media_url,
                "context": audit_context,
                "force": force,
            },
        )

        try:
            if media_url:
                logger.info("📎 Mídia anexada")
                response = self.client.send_media(
                    phone_number=phone_number,
                    media_url=media_url,
                    caption=message,
                    **kwargs,
                )
            else:
                logger.info("📝 Sem mídia")
                response = self.client.send_message(
                    phone_number=phone_number, message=message, **kwargs
                )
            logger.info(f"🔄 {response.status_code}")
            if response.ok:
                if response.content:
                    try:
                        result = response.json()
                    except Exception:
                        result = {
                            "raw": (response.text or "")[:2000],
                            "json_parse_error": True,
                        }
                else:
                    result = {}
                outbox.append_event(
                    stream,
                    {
                        "status": "sent",
                        "idempotency_key": (
                            str(idempotency_key) if idempotency_key else None
                        ),
                        "phone": phone_number,
                        "http_status": response.status_code,
                        "result": (
                            result if isinstance(result, dict) else {"result": result}
                        ),
                        "context": audit_context,
                    },
                )
                logger.info("✅ Enviado com sucesso")
                return result
            error_msg = f"Erro {response.status_code}: {response.text}"
            outbox.append_event(
                stream,
                {
                    "status": "error",
                    "idempotency_key": (
                        str(idempotency_key) if idempotency_key else None
                    ),
                    "phone": phone_number,
                    "http_status": response.status_code,
                    "error": error_msg,
                    "context": audit_context,
                },
            )
            logger.error(f"❌ {error_msg}")
            response.raise_for_status()
        except Exception as e:
            outbox.append_event(
                stream,
                {
                    "status": "exception",
                    "idempotency_key": (
                        str(idempotency_key) if idempotency_key else None
                    ),
                    "phone": phone_number,
                    "error": str(e),
                    "context": audit_context,
                },
            )
            logger.error(f"❌ Erro envio: {str(e)}")
            raise

        return None

    def _format_phone_number(self, phone_number: str) -> str:
        cleaned = "".join(filter(str.isdigit, phone_number))
        if phone_number.startswith("+55"):
            return cleaned
        if cleaned.startswith("55") and len(cleaned) >= 13:
            return cleaned
        if len(cleaned) >= 10:
            return f"55{cleaned}"
        return cleaned

    def send_test_message(
        self, message: str, media_url: Optional[str] = None, **kwargs
    ) -> Optional[Any]:
        config = ConfigManager.get_config()
        test_phone = config.get("global", {}).get("test_phone_number")
        if not test_phone:
            raise ValueError("Número de teste não configurado")
        logger.info(f"🧪 TESTE: {test_phone}")
        return self.send_message(test_phone, message, media_url, **kwargs)

    def send_production_message(
        self, message: str, media_url: Optional[str] = None, **kwargs
    ) -> Optional[Any]:
        config = ConfigManager.get_config()
        prod_phone = config.get("global", {}).get("production_phone_number")
        if not prod_phone:
            raise ValueError("Número de produção não configurado")
        logger.info(f"🚀 PRODUÇÃO: {prod_phone}")
        return self.send_message(prod_phone, message, media_url, **kwargs)


__all__ = ["WhatsAppClient", "MessageSender"]
