from __future__ import annotations

import os
from pathlib import Path


ENV_BASE_URL = "EF_BASE_URL"
ENV_LOGIN_EMAIL = "EF_LOGIN_EMAIL"
ENV_LOGIN_PASSWORD = "EF_LOGIN_PASSWORD"
ENV_UNIT_NAME = "EF_UNIT_NAME"
ENV_UNIT_OPTIONS = "EF_UNIT_OPTIONS"
ENV_OUTPUT_DIR = "EF_OUTPUT_DIR"
ENV_DEBUG_DIR = "EF_DEBUG_DIR"
ENV_LOG_DIR = "EF_LOG_DIR"
ENV_DEBUG_ON_ERROR = "EF_DEBUG_ON_ERROR"
ENV_DEBUG_RETENTION_DAYS = "EF_DEBUG_RETENTION_DAYS"
ENV_TIMEOUT_SECONDS = "EF_TIMEOUT_SECONDS"
ENV_PERSIST_SESSION = "EF_PERSIST_SESSION"
ENV_CHROME_USER_DATA_DIR = "EF_CHROME_USER_DATA_DIR"
ENV_HEADLESS = "HEADLESS"
ENV_DRY_RUN = "EF_DRY_RUN"
ENV_RECORDER_PURGE = "EF_RECORDER_PURGE"


def project_dir() -> Path:
    # This file lives in <project>/espacofacial/config.py
    return Path(__file__).resolve().parents[1]


def default_output_dir() -> Path:
    return project_dir() / "report"


def default_debug_dir() -> Path:
    return project_dir() / "debug"


def default_chrome_profile_dir() -> Path:
    return project_dir() / "chrome_profile"


def env_path(name: str, default: Path) -> Path:
    raw = os.getenv(name, "").strip()
    return (Path(raw).expanduser() if raw else default).resolve()
