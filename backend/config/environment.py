"""
Sistema de detecção de ambiente e gerenciamento de credenciais.
"""

import os
import json
import logging

logger = logging.getLogger(__name__)


class EnvironmentDetector:
    """Sistema para detectar e adaptar execução baseado no ambiente"""

    @staticmethod
    def is_github_actions() -> bool:
        """Detecta se está rodando no GitHub Actions"""
        return os.environ.get("GITHUB_ACTIONS") == "true"

    @staticmethod
    def is_local_development() -> bool:
        """Detecta se está em ambiente de desenvolvimento local"""
        return not EnvironmentDetector.is_github_actions()

    @staticmethod
    def get_execution_mode() -> str:
        """Retorna o modo de execução atual"""
        if EnvironmentDetector.is_github_actions():
            return "github_actions"
        return "local_development"


class CredentialManager:
    """Gerenciador de credenciais baseado no ambiente"""

    @staticmethod
    def get_google_credentials(base_config: dict) -> dict:
        """Obtém credenciais do Google baseado no ambiente"""
        if EnvironmentDetector.is_github_actions():
            return CredentialManager._load_google_from_github_actions(base_config)
        return CredentialManager._load_google_from_local(base_config)

    @staticmethod
    def get_umbler_credentials(base_config: dict) -> dict:
        """Obtém credenciais do Umbler baseado no ambiente"""
        if EnvironmentDetector.is_github_actions():
            return CredentialManager._load_umbler_from_github_actions(base_config)
        return CredentialManager._load_umbler_from_local(base_config)

    @staticmethod
    def _load_google_from_github_actions(base_config: dict) -> dict:
        """Carrega credenciais do Google dos secrets do GitHub"""
        logger.info("🔄 GitHub Actions: Google check")

        # Verificar se o secret está disponível
        service_account_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY")
        if service_account_json:
            try:
                service_account = json.loads(service_account_json)
                base_config["google_service_account"] = service_account
                logger.info("✅ GitHub Actions: Google OK")
            except json.JSONDecodeError:
                logger.warning("⚠️ GitHub Actions: Decode falha")
        else:
            logger.info("ℹ️ GitHub Actions: Google secret não encontrado")

        return base_config

    @staticmethod
    def _load_google_from_local(base_config: dict) -> dict:
        """Carrega credenciais do Google do arquivo local"""
        logger.info("🔄 Local: Usando credenciais Google")
        # Em ambiente local, as credenciais já estão no config.json
        if "google_service_account" in base_config:
            logger.info("✅ Local: Google OK")
        else:
            logger.error("❌ Local: Google não encontrado")
        return base_config

    @staticmethod
    def _load_umbler_from_github_actions(base_config: dict) -> dict:
        """Carrega credenciais do Umbler dos secrets do GitHub"""
        logger.info("🔄 GitHub Actions: Verificando Umbler")

        # Mapear secrets para campos do umbler_config
        secret_mapping = {
            "UMBLER_TOKEN": "token",
            "UMBLER_ORGANIZATION_ID": "organization_id",
            "UMBLER_CHANNEL_ID": "channel_id",
            "UMBLER_CHAT_ID": "chat_id",
        }

        umbler_config = base_config.get("umbler_config", {})
        secrets_found = False

        for secret_name, config_field in secret_mapping.items():
            secret_value = os.environ.get(secret_name)
            if secret_value:
                umbler_config[config_field] = secret_value
                secrets_found = True
                logger.info(f"✅ GitHub Actions: {secret_name}")

        if secrets_found:
            base_config["umbler_config"] = umbler_config
            logger.info("✅ GitHub Actions: Umbler atualizado")
        else:
            logger.info("ℹ️ GitHub Actions: Umbler secrets não encontrados")

        return base_config

    @staticmethod
    def _load_umbler_from_local(base_config: dict) -> dict:
        """Carrega credenciais do Umbler do arquivo local"""
        logger.info("🔄 Local: Usando configurações Umbler")
        if "umbler_config" in base_config:
            logger.info("✅ Local: Umbler OK")
        else:
            logger.error("❌ Local: Umbler não encontrado")
        return base_config
