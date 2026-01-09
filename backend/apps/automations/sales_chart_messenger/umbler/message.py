"""
Serviço de envio de mensagens via Umbler.
"""

import logging
from typing import Optional, Any
from config import ConfigManager, ConfigConstants
from .client import UmblerClient

logger = logging.getLogger(__name__)

class MessageSender:
    """Serviço para envio de mensagens via Umbler"""

    def __init__(self):
        self.client = UmblerClient()
        config = ConfigManager.get_config()
        self.umbler_config = config.get('umbler_config', {})

    def send_message(self, chat_id: str, message: str, file_id: Optional[str] = None, **kwargs) -> Optional[Any]:
        """Envia mensagem via Utalk"""

        logger.info(f"📤 Para: {chat_id}")
        logger.info(f"📝 {message[:30]}..." if len(message) > 30 else f"📝 {message}")

        # Payload da mensagem
        payload = {
            "message": message,
            "chatId": chat_id,
            "organizationId": self.client.organization_id,
            "automated": kwargs.get("automated", True),
            "isPrivate": kwargs.get("is_private", False),
        }

        # Adicionar file_id se fornecido
        if file_id:
            payload["fileId"] = file_id
            logger.info(f"📎 Anexo: {file_id}")
        else:
            logger.info("📝 Sem anexo")

        # Remove itens None
        payload = {k: v for k, v in payload.items() if v is not None}

        # Validação de parâmetros obrigatórios
        if not message or not message.strip():
            logger.error("❌ Mensagem vazia")
            raise ValueError("Mensagem não pode estar vazia")

        if not chat_id:
            logger.error("❌ Chat ID não fornecido")
            raise ValueError("Chat ID é obrigatório")

        # Timeout configurável
        timeout = kwargs.get('timeout', 15)

        logger.info(f"🌐 API Umbler")

        # Request com timeout e tratamento de exceções
        try:
            response = self.client.post(
                endpoint=ConfigConstants.API_ENDPOINTS.UMBLER_MESSAGES.lstrip('/'),
                data=payload,
                timeout=timeout
            )

            logger.info(f"🔄 {response.status_code}")

            if response.ok:
                result = response.json()
                logger.info(f"✅ ID: {result.get('id', 'N/A')}")
                return result
            else:
                error_msg = f"Erro {response.status_code}: {response.text}"
                logger.error(f"❌ {error_msg}")
                response.raise_for_status()

        except Exception as e:
            logger.error(f"❌ Erro envio: {str(e)}")
            raise

    def send_test_message(self, message: str, file_id: Optional[str] = None, **kwargs) -> Optional[Any]:
        """Envia mensagem de teste usando chat_id configurado"""
        config = ConfigManager.get_config()
        test_chat_id = config.get('global', {}).get('chat_id_test', 'aBJEGB1SkPjDN5-H')

        logger.info(f"🧪 TESTE: {test_chat_id}")
        return self.send_message(test_chat_id, message, file_id, **kwargs)

    def send_production_message(self, message: str, file_id: Optional[str] = None, **kwargs) -> Optional[Any]:
        """Envia mensagem de produção usando chat_id configurado"""
        config = ConfigManager.get_config()
        prod_chat_id = config.get('global', {}).get('chat_id_production',
                                                   self.umbler_config.get('chat_id'))

        if not prod_chat_id:
            raise ValueError("Chat ID de produção não configurado")

        logger.info(f"🚀 PRODUÇÃO: {prod_chat_id}")
        return self.send_message(prod_chat_id, message, file_id, **kwargs)
