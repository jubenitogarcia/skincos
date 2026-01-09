"""
Cliente base para API Umbler.
"""

import requests
from typing import Optional, Dict, Any
import logging
from config import ConfigManager, ConfigConstants

logger = logging.getLogger(__name__)

class UmblerClient:
    """Cliente base para API Umbler"""

    def __init__(self):
        config = ConfigManager.get_config()
        self.umbler_config = config.get('umbler_config', {})
        self.token = self.umbler_config.get('token')
        self.organization_id = self.umbler_config.get('organization_id')
        self.base_url = ConfigConstants.API_ENDPOINTS.UMBLER_BASE

        # Validações
        if not self.token:
            raise ValueError("Token Umbler não configurado")
        if not self.organization_id:
            raise ValueError("Organization ID não configurado")

    def _get_headers(self, content_type: str = "application/json") -> Dict[str, str]:
        """Retorna headers padrão"""
        headers = {
            "Authorization": f"Bearer {self.token}",
        }

        if content_type:
            headers["Content-Type"] = content_type

        return headers

    def _get_multipart_headers(self) -> Dict[str, str]:
        """Retorna headers para multipart/form-data"""
        return {
            "Authorization": f"Bearer {self.token}",
            "accept": "application/json"
            # Não incluir Content-Type - requests define automaticamente
        }

    def post(self, endpoint: str, data: Optional[Dict[str, Any]] = None,
             files: Optional[Dict[str, Any]] = None, **kwargs) -> requests.Response:
        """Faz requisição POST"""
        url = f"{self.base_url}/{endpoint}"

        if files:
            # Upload de arquivos - usar headers multipart
            headers = self._get_multipart_headers()
            return requests.post(url, data=data, files=files, headers=headers, **kwargs)
        else:
            # Requisição JSON normal
            headers = self._get_headers()
            return requests.post(url, json=data, headers=headers, **kwargs)

    def get(self, endpoint: str, params: Optional[Dict[str, Any]] = None, **kwargs) -> requests.Response:
        """Faz requisição GET"""
        url = f"{self.base_url}/{endpoint}"
        headers = self._get_headers()
        return requests.get(url, params=params, headers=headers, **kwargs)

    def validate_connection(self) -> bool:
        """Valida conexão com a API"""
        try:
            # Teste básico sem fazer chamada real
            return bool(self.token and self.organization_id)
        except Exception as e:
            logger.error(f"❌ Validação Umbler: {e}")
            return False
