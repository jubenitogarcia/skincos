"""Constantes e configurações centralizadas do sistema."""

from dataclasses import dataclass
from typing import Optional, List
import json
import logging
import os

logger = logging.getLogger(__name__)


@dataclass
class APIEndpoints:
    GOOGLE_SHEETS_BASE: str = "https://sheets.googleapis.com/v4/spreadsheets"
    GOOGLE_DRIVE_BASE: str = "https://www.googleapis.com/drive/v3"


@dataclass
class SystemConstants:
    CACHE_TTL: int = 300  # 5 minutos
    MAX_RETRIES: int = 3
    REQUEST_TIMEOUT: int = 15
    BACKOFF_FACTOR: int = 2
    MAX_FILE_SIZE: int = 25 * 1024 * 1024  # 25MB
    ALLOWED_FILE_TYPES: Optional[List[str]] = None

    def __post_init__(self):
        if self.ALLOWED_FILE_TYPES is None:
            self.ALLOWED_FILE_TYPES = ["image/png", "image/jpeg", "image/jpg"]


class ConfigConstants:
    """Configurações centralizadas do sistema."""

    API_ENDPOINTS = APIEndpoints()
    SYSTEM = SystemConstants()

    # Singleton instance
    _instance = None
    _config = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ConfigConstants, cls).__new__(cls)
        return cls._instance

    @classmethod
    def get_instance(cls):
        """Retorna instância singleton."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def load_config(cls):
        """Carrega configuração do arquivo config.json."""
        if cls._config is None:
            try:
                backend_dir = os.path.dirname(os.path.dirname(__file__))
                default_config = os.path.join(backend_dir, "config.json")
                var_config = os.path.join(backend_dir, "var", "config.json")
                config_file = os.environ.get("SKINCOS_CONFIG") or (
                    default_config if os.path.exists(default_config) else var_config
                )
                with open(config_file, "r", encoding="utf-8") as f:
                    cls._config = json.load(f)
            except Exception as e:
                logger.error(f"Erro ao carregar configuração: {e}")
                cls._config = {}
        return cls._config

    @property
    def SCOPES(self):
        """Retorna os scopes do Google configurados."""
        config = self.load_config()
        return config.get(
            "google_scopes",
            [
                "https://www.googleapis.com/auth/spreadsheets.readonly",
                "https://www.googleapis.com/auth/drive.readonly",
            ],
        )

    @property
    def EXECUTIONS(self):
        """Retorna as configurações de execução."""
        config = self.load_config()
        return config.get("units", {})

    @property
    def CELL_REFERENCES(self):
        """Retorna as referências de células."""
        executions = self.EXECUTIONS
        refs = {}

        # Adiciona células comuns
        config = self.load_config()
        common_cells = config.get("global", {}).get("common_cells", {})

        # Para cada execução, combina células comuns com específicas
        for exec_name, exec_config in executions.items():
            refs[exec_name] = {**common_cells, **exec_config.get("specific_cells", {})}

        return refs

    @property
    def MOTIVATIONAL_PHRASES(self):
        """Retorna as frases motivacionais configuradas."""
        config = self.load_config()
        return config.get(
            "motivational_phrases",
            {
                "morning": {
                    "nenhuma_meta": [
                        "Hoje é um novo dia para alcançar nossos objetivos!"
                    ],
                    "primeira_meta": ["Excelente início! Vamos manter o ritmo!"],
                    "segunda_meta": ["Ótimo progresso! Continuem assim!"],
                    "terceira_meta": ["Incrível desempenho! Vocês são demais!"],
                    "meta_super": ["SUPER META! Vocês são extraordinários!"],
                },
                "evening": {
                    "nenhuma_meta": ["Amanhã é um novo dia, não desistam!"],
                    "primeira_meta": ["Bom trabalho hoje! Primeira meta conquistada!"],
                    "segunda_meta": ["Excelente dia! Duas metas alcançadas!"],
                    "terceira_meta": ["Dia fantástico! Três metas conquistadas!"],
                    "meta_super": ["DIA PERFEITO! SUPER META ALCANÇADA!"],
                },
            },
        )

    @property
    def GLOBAL_CONFIG(self):
        """Retorna configurações globais."""
        config = self.load_config()
        return config.get("global", {})
