"""Gerenciador centralizado de configurações com singleton pattern e validação."""

import json
import os
from typing import Any, Dict, Optional
import logging

logger = logging.getLogger(__name__)


class ConfigManager:
    """Gerenciamento centralizado de configurações com singleton pattern e validação."""

    _instance: Optional["ConfigManager"] = None
    _config: Optional[Dict[str, Any]] = None
    _schema: Optional[Dict[str, Dict[str, Any]]] = None

    # Ordem de resolução:
    # 1) `SKINCOS_CONFIG` (override explícito)
    # 2) `backend/config.json` (compatibilidade)
    # 3) `backend/var/config.json` (preferível para uso local, sem poluir o repo)
    _BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
    _DEFAULT_CONFIG_FILE = os.path.join(_BACKEND_DIR, "config.json")
    _VAR_CONFIG_FILE = os.path.join(_BACKEND_DIR, "var", "config.json")
    CONFIG_FILE = os.environ.get("SKINCOS_CONFIG") or (
        _DEFAULT_CONFIG_FILE
        if os.path.exists(_DEFAULT_CONFIG_FILE)
        else _VAR_CONFIG_FILE
    )

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ConfigManager, cls).__new__(cls)
        return cls._instance

    def __init__(self):
        if ConfigManager._config is None:
            self._schema = self._define_schema()
            ConfigManager._config = self._load_config()
            self._validate_config()

    @classmethod
    def get_instance(cls):
        """Retorna a instância singleton do ConfigManager."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def get_config(cls) -> Dict[str, Any]:
        """Retorna a configuração carregada."""
        instance = cls.get_instance()
        if instance._config is not None:
            return instance._config.copy()
        return {}

    @classmethod
    def reload_config(cls):
        """Recarrega a configuração do arquivo."""
        cls._instance = None
        cls._config = None
        return cls.get_instance()

    def _define_schema(self) -> Dict[str, Dict[str, Any]]:
        """Define o schema de validação da configuração."""
        return {
            "spreadsheet_id": {"type": str, "required": True},
            "google_service_account": {"type": dict, "required": True},
            "whatsapp_config": {"type": dict, "required": True},
            "units": {"type": dict, "required": True},
            "global": {"type": dict, "required": False},
            "motivational_phrases": {"type": dict, "required": False},
            "goal_tracking": {"type": dict, "required": False},
        }

    def _validate_config(self):
        """Valida a configuração carregada contra o schema."""
        if not self._schema or not ConfigManager._config:
            logger.error("Schema não inicializado")
            return

        validation_errors = []

        for field, rules in self._schema.items():
            if rules.get("required", False) and field not in ConfigManager._config:
                validation_errors.append(f"Campo obrigatório ausente: {field}")
            elif field in ConfigManager._config:
                expected_type = rules.get("type")
                if expected_type and not isinstance(
                    ConfigManager._config[field], expected_type
                ):
                    expected_name = expected_type.__name__
                    received_name = type(ConfigManager._config[field]).__name__
                    validation_errors.append(
                        f"Tipo incorreto para {field}: esperado {expected_name}, "
                        f"recebido {received_name}"
                    )

        # Validações específicas
        self._validate_whatsapp_config(validation_errors)

        if validation_errors:
            error_msg = "Erros de validação na configuração:\n" + "\n".join(
                f"  - {e}" for e in validation_errors
            )
            logger.error(error_msg)
            raise ValueError(error_msg)

    def _validate_whatsapp_config(self, validation_errors: list):
        """Valida configuração específica do WhatsApp."""
        if not ConfigManager._config:
            validation_errors.append("Configuração não inicializada")
            return

        whatsapp = ConfigManager._config.get("whatsapp_config", {})
        required_fields = ["api_url", "api_key"]

        for field in required_fields:
            if field not in whatsapp:
                validation_errors.append(
                    f"Campo obrigatório ausente em whatsapp_config: {field}"
                )

    def _load_config(self) -> Dict[str, Any]:
        """Carrega a configuração do arquivo config.json."""
        try:
            with open(self.CONFIG_FILE, "r", encoding="utf-8") as f:
                config = json.load(f)
            logger.info(f"✅ Config: {self.CONFIG_FILE}")
            return config
        except FileNotFoundError:
            logger.error(f"❌ Config: {self.CONFIG_FILE}")
            raise
        except json.JSONDecodeError as e:
            logger.error(f"❌ JSON inválido: {e}")
            raise
        except Exception as e:
            logger.error(f"❌ Erro config: {e}")
            raise
