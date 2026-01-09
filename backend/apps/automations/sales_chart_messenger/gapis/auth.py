"""
Serviço de autenticação do Google com lazy loading.
"""

import logging
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

def get_google_apis():
    """Retorna os módulos das Google APIs com lazy loading"""
    try:
        from google.oauth2 import service_account  # type: ignore
        from google.oauth2.credentials import Credentials  # type: ignore
        from google.auth.transport.requests import Request  # type: ignore
        from googleapiclient.discovery import build  # type: ignore
        from googleapiclient.http import MediaIoBaseDownload  # type: ignore

        return {
            'service_account': service_account,
            'Credentials': Credentials,
            'Request': Request,
            'build': build,
            'MediaIoBaseDownload': MediaIoBaseDownload
        }
    except ImportError as e:
        logger.error(f"❌ Google APIs indisponíveis: {e}")
        return None

class GoogleAuthService:
    """Serviço de autenticação do Google"""
    _credentials = None

    @classmethod
    def get_credentials(cls, config: Dict[str, Any], scopes: list):
        """Obtém credenciais autenticadas"""
        if cls._credentials is not None:
            return cls._credentials

        google_apis = get_google_apis()
        if not google_apis:
            raise ImportError("Google APIs não disponíveis")

        service_account = google_apis['service_account']

        if 'google_service_account' not in config:
            raise ValueError("Google Service Account não configurado")

        service_account_info = config['google_service_account']

        logger.info(f"🔍 Service account info keys: {list(service_account_info.keys())}")

        # Validar campos obrigatórios
        required_fields = ['type', 'project_id', 'private_key', 'client_email']
        missing_fields = [field for field in required_fields if field not in service_account_info]

        if missing_fields:
            logger.error(f"❌ Campos obrigatórios ausentes: {missing_fields}")
            raise ValueError(f"Campos obrigatórios ausentes no service account: {missing_fields}")

        # Log do tipo e project_id para debug (sem expor dados sensíveis)
        logger.info(f"🔍 Type: {service_account_info.get('type')}")
        logger.info(f"🔍 Project ID: {service_account_info.get('project_id')}")
        logger.info(f"🔍 Client email: {service_account_info.get('client_email')}")

        # Não fazer validação das chaves, confiar que o formato é adequado
        # já que o commit 8809e8cc496ec264dea4722eae604126be527dea funcionava sem processamento
        logger.info("✅ Usando chave privada exatamente como fornecida no arquivo JSON")

        # Diagnóstico limitado da private_key sem mostrar conteúdo
        private_key = service_account_info.get('private_key', '')
        if private_key:
            logger.info(f"🔍 Private key length: {len(private_key)} chars")

            # Verificar se começa e termina com os marcadores corretos do PEM
            starts_correctly = private_key.startswith('-----BEGIN PRIVATE KEY-----')
            ends_correctly = '-----END PRIVATE KEY-----' in private_key

            logger.info(f"🔍 Private key starts correctly: {starts_correctly}")
            logger.info(f"🔍 Private key ends correctly: {ends_correctly}")
            # Corrigido para evitar problema de sintaxe em f-string com GitHub Actions
            has_escape_n = "\\n" in private_key
            logger.info(f"🔍 Contains literal escape sequence: {has_escape_n}")

            # Apenas log caso haja problema óbvio
            if not starts_correctly or not ends_correctly:
                logger.warning("⚠️ Private key format appears to be incorrect")

                # Se tiver caracteres de escape que precisam ser convertidos
                if '\\n' in private_key:
                    logger.info("🔧 Attempting to fix private key format...")
                    # Substituir caracteres de escape por quebras de linha reais
                    service_account_info['private_key'] = private_key.replace('\\n', '\n')
                    logger.info("✅ Private key escape sequences replaced")

        try:
            cls._credentials = service_account.Credentials.from_service_account_info(
                service_account_info,
                scopes=scopes
            )
        except Exception as e:
            logger.error(f"❌ Erro ao criar credenciais: {str(e)}")

            # Tentar diagnosticar e corrigir problemas comuns
            if "Invalid JWT Signature" in str(e):
                logger.error("🔍 Diagnóstico JWT: Possível problema na chave privada")

                # Verificar formato da chave e tentar corrigir
                private_key = service_account_info.get('private_key', '')
                if private_key:
                    logger.info("🔧 Tentando corrigir chave privada para resolver Invalid JWT Signature...")

                    # Problemas comuns:
                    # 1. Caracteres de escape não processados
                    if '\\n' in private_key:
                        logger.info("🔧 Convertendo escape sequences '\\n' para quebras de linha reais")
                        private_key = private_key.replace('\\n', '\n')

                    # 2. Falta de quebra de linha no final
                    if not private_key.endswith('\n'):
                        logger.info("🔧 Adicionando quebra de linha no final da chave")
                        private_key += '\n'

                    # Tentar novamente com a chave corrigida
                    service_account_info['private_key'] = private_key
                    logger.info("🔄 Tentando autenticação novamente com chave corrigida")

                    try:
                        cls._credentials = service_account.Credentials.from_service_account_info(
                            service_account_info,
                            scopes=scopes
                        )
                        logger.info("✅ Autenticação bem-sucedida após correção da chave privada!")
                        return cls._credentials
                    except Exception as retry_error:
                        logger.error(f"❌ Falha na segunda tentativa: {retry_error}")

                logger.error("⚠️ Verificar se o relógio do sistema está sincronizado")

            # Se não conseguiu corrigir, propagar o erro original
            raise

        logger.info("✅ Autenticação Google OK")
        return cls._credentials

    @classmethod
    def get_access_token(cls, config: Dict[str, Any], scopes: list) -> Optional[str]:
        """Obtém token de acesso OAuth2"""
        try:
            google_apis = get_google_apis()
            if not google_apis:
                return None

            creds = cls.get_credentials(config, scopes)
            Request = google_apis['Request']

            # Refresh para obter access token
            creds.refresh(Request())
            return creds.token

        except Exception as e:
            logger.warning(f"⚠️ Token: {str(e)}")
            return None
