"""
Serviço de upload de arquivos via Umbler.
"""

import os
import logging
from typing import Optional, Any
from config import ConfigConstants
from .client import UmblerClient

logger = logging.getLogger(__name__)

class FileUploader:
    """Serviço para upload de arquivos via Umbler"""

    def __init__(self):
        self.client = UmblerClient()

    def get_file_info(self, file_path: str) -> dict:
        """Obtém informações detalhadas do arquivo"""
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Arquivo não encontrado: {file_path}")

        file_size = os.path.getsize(file_path)
        file_name = os.path.basename(file_path)

        return {
            'name': file_name,
            'size_bytes': file_size,
            'size_mb': round(file_size / (1024 * 1024), 2),
            'extension': os.path.splitext(file_name)[1].lower()
        }

    def upload_file(self, file_path: str, **kwargs) -> Optional[Any]:
        """Faz upload de arquivo com teste automático de endpoints"""

        def _try_upload_endpoint(endpoint: str) -> Any:
            """Tenta fazer upload em um endpoint específico"""
            logger.info(f"📤 {os.path.basename(file_path)}")

            # Validações iniciais
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"Arquivo não encontrado: {file_path}")

            file_size = os.path.getsize(file_path)
            if file_size > ConfigConstants.SYSTEM.MAX_FILE_SIZE:
                raise ValueError(f"Arquivo muito grande: {file_size} bytes")

            # Obter informações do arquivo
            file_info = self.get_file_info(file_path)
            logger.info(f"📤 {file_info['size_mb']}MB")

            # Preparar arquivo para upload
            with open(file_path, 'rb') as f:
                files = {
                    'file': (os.path.basename(file_path), f, 'image/png')
                }

                # Dados do formulário
                data = {
                    'organizationId': self.client.organization_id,
                    'type': kwargs.get('type', 'image'),
                    'automated': str(kwargs.get('automated', True)).lower()
                }

                # Request com timeout
                logger.info(f"🌐 Upload: {endpoint}")
                response = self.client.post(
                    endpoint=endpoint.lstrip('/'),
                    data=data,
                    files=files,
                    timeout=kwargs.get('timeout', 30)
                )

            logger.info(f"📊 Status: {response.status_code}")

            if response.ok:
                result = response.json()
                logger.debug(f"🔍 Resposta API: {result}")

                # A API retorna 'id' no campo principal
                file_id = result.get('id')
                if not file_id:
                    # Fallback para outros campos possíveis
                    file_id = result.get('fileId') or result.get('_id') or result.get('fileID')

                logger.info(f"✅ Upload! FileID: {file_id} via {endpoint}")
                return result
            else:
                logger.warning(f"⚠️ Falha {endpoint}: {response.status_code}")
                return None

        # Tentar endpoint principal primeiro
        try:
            result = _try_upload_endpoint(ConfigConstants.API_ENDPOINTS.UMBLER_UPLOAD)
            if result:
                return result
        except Exception as e:
            logger.warning(f"⚠️ Erro endpoint principal: {e}")

        # Se o endpoint principal falhar, tentar alternativas
        logger.info("🔄 Testando endpoints alternativos")

        alternatives = ConfigConstants.API_ENDPOINTS.UMBLER_UPLOAD_ALTERNATIVES or []
        for alt_endpoint in alternatives:
            if alt_endpoint == ConfigConstants.API_ENDPOINTS.UMBLER_UPLOAD:
                continue  # Já testado

            try:
                result = _try_upload_endpoint(alt_endpoint)
                if result:
                    logger.info(f"✅ Endpoint funcional: {alt_endpoint}")
                    # Atualizar configuração para próximas execuções
                    ConfigConstants.API_ENDPOINTS.UMBLER_UPLOAD = alt_endpoint
                    return result
            except Exception as e:
                logger.debug(f"❌ Endpoint falhou: {alt_endpoint} - {e}")
                continue

        # Se nenhum endpoint funcionar
        logger.error("❌ Upload indisponível")
        logger.info("💡 Sistema continuará sem anexos")
        raise Exception("Upload indisponível - endpoints falharam")

    def extract_file_id(self, upload_result: dict) -> Optional[str]:
        """Extrai file_id da resposta do upload"""
        if not upload_result:
            return None

        # A API retorna 'id' no campo principal
        file_id = upload_result.get('id')
        if not file_id:
            # Fallback para outros campos possíveis
            file_id = upload_result.get('fileId') or upload_result.get('_id') or upload_result.get('fileID')

        return file_id
