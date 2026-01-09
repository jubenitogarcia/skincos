#!/usr/bin/env python3
"""
Atualiza credenciais do Instagram no config do módulo de agendamento.

Por segurança, este script NÃO contém tokens/segredos hardcoded.

Entrada via environment:
  - INSTAGRAM_APP_ID
  - INSTAGRAM_APP_SECRET
  - INSTAGRAM_CLIENT_TOKEN
  - INSTAGRAM_ACCOUNTS_JSON: JSON array de contas, ex:
      [{"account_id":"...","access_token":"...","name":"..."}]

Arquivo alvo:
  - `SCHEDULED_POSTING_CONFIG` (se setado), senão `backend/var/scheduled_posting/config.json`.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List

from libs.scheduler_config import default_config_path


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing env var: {name}")
    return value


def _load_json(path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f) or {}


def _dump_json(path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def main() -> int:
    config_path = default_config_path()
    config = _load_json(config_path)

    app_id = _require_env("INSTAGRAM_APP_ID")
    app_secret = _require_env("INSTAGRAM_APP_SECRET")
    client_token = _require_env("INSTAGRAM_CLIENT_TOKEN")

    accounts_raw = _require_env("INSTAGRAM_ACCOUNTS_JSON")
    try:
        accounts: List[Dict[str, Any]] = json.loads(accounts_raw)
    except json.JSONDecodeError as e:
        raise SystemExit(f"INSTAGRAM_ACCOUNTS_JSON inválido: {e}")

    if not isinstance(accounts, list) or not accounts:
        raise SystemExit("INSTAGRAM_ACCOUNTS_JSON deve ser uma lista não-vazia.")

    for idx, account in enumerate(accounts):
        if not isinstance(account, dict):
            raise SystemExit(f"Conta #{idx} inválida (esperado objeto JSON).")
        for key in ("account_id", "access_token", "name"):
            if not account.get(key):
                raise SystemExit(f"Conta #{idx} sem campo obrigatório: {key}")

    config["instagram"] = {
        "app_id": app_id,
        "app_secret": app_secret,
        "client_token": client_token,
        "accounts": accounts,
    }

    config["instagram_accounts"] = [
        {
            "account_id": account["account_id"],
            "access_token": account["access_token"],
            "app_id": app_id,
            "app_secret": app_secret,
            "name": account["name"],
        }
        for account in accounts
    ]

    _dump_json(config_path, config)

    print("✅ Credenciais do Instagram atualizadas com sucesso!")
    print(f"Config: {config_path}")
    for i, account in enumerate(accounts, 1):
        print(f"{i}. {account['name']} - ID: {account['account_id']}")
    print(f"App ID: {app_id}")
    print(f"App Secret: {app_secret[:6]}... (redacted)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
