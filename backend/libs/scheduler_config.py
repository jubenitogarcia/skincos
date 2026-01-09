from __future__ import annotations

import json
import os
from pathlib import Path


def backend_dir() -> Path:
    """
    Retorna o diretório `backend/` do workspace.

    Detecta o root procurando por `pyproject.toml` dentro de `backend/`.
    """
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "pyproject.toml").exists():
            return parent
    return here.parents[1]


def var_dir() -> Path:
    env = os.environ.get("VAR_DIR")
    if env:
        return Path(env)
    return backend_dir() / "var"


def scheduled_posting_var_dir() -> Path:
    return var_dir() / "scheduled_posting"


def default_config_path() -> Path:
    env = os.environ.get("SCHEDULED_POSTING_CONFIG")
    if env:
        return Path(env)
    return scheduled_posting_var_dir() / "config.json"


def scheduled_dir() -> Path:
    env = os.environ.get("SCHEDULED_POSTING_MEDIA_DIR")
    if env:
        return Path(env)
    return scheduled_posting_var_dir() / "Scheduled"


class GitHubCredentials:
    def __init__(self, config_data):
        env_token = os.environ.get("GHB_CREDENTIALS")
        github_actions_token = os.environ.get("GITHUB_TOKEN")
        settings_token = config_data.get("github_token", "")
        self.token = env_token or github_actions_token or settings_token
        self.repo = config_data.get("github_repo", "")
        self.pages_url = config_data.get("github_pages_url", "")

    def is_valid(self):
        return bool(self.token and self.repo and self.pages_url)


class InstagramCredentials:
    def __init__(self, config_data, base_path: Path | None = None):
        base_path = base_path or backend_dir()
        self.accounts = config_data.get("instagram_accounts", [])

        creds_file = base_path / "INSTAGRAM_CREDENTIALS.json"
        if creds_file.exists():
            try:
                with open(creds_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if "instagram_accounts" in data and data["instagram_accounts"]:
                        self.accounts = data["instagram_accounts"]
            except Exception:
                pass

        env_accounts = [
            {
                "name": "Novo Hamburgo",
                "access_token": os.environ.get("INSTAGRAM_ACCESS_TOKEN_NOVO_HAMBURGO"),
                "account_id": os.environ.get("INSTAGRAM_ACCOUNT_ID_NOVO_HAMBURGO"),
            },
            {
                "name": "BarraShoppingSul",
                "access_token": os.environ.get("INSTAGRAM_ACCESS_TOKEN_BARRA_SHOPPING"),
                "account_id": os.environ.get("INSTAGRAM_ACCOUNT_ID_BARRA_SHOPPING"),
            },
        ]
        for env_acc in env_accounts:
            if env_acc["access_token"] and env_acc["account_id"]:
                found = False
                for acc in self.accounts:
                    if acc.get("account_id") == env_acc["account_id"]:
                        acc["access_token"] = env_acc["access_token"]
                        found = True
                        break
                if not found:
                    self.accounts.append(env_acc)

    def is_configured(self):
        return bool(self.accounts)


class GoogleCredentials:
    def __init__(self, config_data, base_path: Path | None = None):
        base_path = base_path or backend_dir()
        self.credentials = {}
        if "google_drive_credentials" in config_data:
            self.credentials = config_data["google_drive_credentials"]
        else:
            creds_file = base_path / config_data.get("google_credentials_file", "GOOGLE_CREDENTIALS.json")
            if creds_file.exists():
                try:
                    with open(creds_file, "r", encoding="utf-8") as f:
                        self.credentials = json.load(f)
                except Exception:
                    self.credentials = {}

    def is_configured(self):
        return bool(self.credentials)


class ConfigManager:
    """
    Centraliza o carregamento do config.json e delega para submódulos de credenciais.
    """

    def __init__(self, config_path: str | os.PathLike | None = None):
        resolved = Path(config_path) if config_path else default_config_path()
        self.data = self._load_config(resolved)
        self.github = GitHubCredentials(self.data)
        self.instagram = InstagramCredentials(self.data)
        self.google = GoogleCredentials(self.data)

    def _load_config(self, config_path: Path):
        config_file = Path(config_path)
        if config_file.exists():
            with open(config_file, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}


__all__ = [
    "backend_dir",
    "var_dir",
    "scheduled_posting_var_dir",
    "default_config_path",
    "scheduled_dir",
    "GitHubCredentials",
    "InstagramCredentials",
    "GoogleCredentials",
    "ConfigManager",
]

