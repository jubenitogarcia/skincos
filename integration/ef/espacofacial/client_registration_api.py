from __future__ import annotations

import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests
from selenium.webdriver.remote.webdriver import WebDriver

from .auth import Credentials, log, login_and_select_unit
from .client_registration import ClientRegistrationRecord, _flush_checkpoint, _load_checkpoint, _normalize_spaces
from .core import create_driver
from .procedures import CLIENTS_URL_PATH, resolve_units


API_BASE = "https://xfnu-gcrq-uvrs.b2.xano.io/api:DcyGkb5q"


def _positive_int_env(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


def _optional_positive_int_env(name: str) -> int | None:
    raw = os.getenv(name, "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def _clean(value: object) -> str:
    return _normalize_spaces(str(value or ""))


def _join_values(*values: object) -> str:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        item = _clean(value)
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return " | ".join(result)


def _address_text(address: dict[str, Any]) -> str:
    main = _join_values(address.get("street"), address.get("number"))
    tail = _join_values(
        address.get("complement"),
        address.get("neighbourhood"),
        address.get("city"),
        address.get("state"),
        address.get("cep"),
    )
    return ", ".join(item for item in (main, tail) if item)


def _contains_unit_id(value: object, expected_unit_id: str) -> bool:
    if isinstance(value, str):
        return _clean(value) == expected_unit_id
    if isinstance(value, dict):
        return any(_contains_unit_id(item, expected_unit_id) for item in value.values())
    if isinstance(value, list):
        return any(_contains_unit_id(item, expected_unit_id) for item in value)
    return False


def _record_from_api(*, unit_name: str, page_number: int, payload: dict[str, Any]) -> ClientRegistrationRecord:
    user = payload.get("_users") or {}
    address = payload.get("_addresses") or {}
    client_id = _clean(payload.get("id"))
    return ClientRegistrationRecord(
        unidade=unit_name,
        cliente=_clean(user.get("name")),
        cliente_id=client_id,
        pagina_lista=page_number,
        telefone=_clean(user.get("phone")),
        telefones=_join_values(user.get("phone"), user.get("phone2"), user.get("phone3")),
        email=_clean(user.get("email")),
        emails=_join_values(user.get("email"), user.get("email2"), user.get("email3")),
        data_nascimento=_clean(user.get("bornDate")),
        sexo=_clean(user.get("gender")),
        cpf=_clean(payload.get("cpf")),
        profissao=_clean(payload.get("occupation")),
        origem=_join_values(payload.get("howYouKnow"), user.get("origin")),
        cep=_clean(address.get("cep")),
        logradouro=_clean(address.get("street")),
        numero=_clean(address.get("number")),
        complemento=_clean(address.get("complement")),
        bairro=_clean(address.get("neighbourhood")),
        cidade=_clean(address.get("city")),
        estado=_clean(address.get("state")),
        endereco_completo=_address_text(address),
        url_cliente=f"https://app.espacofacial.com.br/client-single-new/{client_id}" if client_id else "",
        extraido_em=datetime.now().astimezone().isoformat(timespec="seconds"),
    )


def _unit_id_from_loaded_list(driver: WebDriver, *, timeout_seconds: int) -> str:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        entries = driver.execute_script(
            "return performance.getEntriesByType('resource').map(function(entry) { return entry.name; });"
        ) or []
        for entry in reversed(entries):
            if "/api:DcyGkb5q/clients?page=" not in entry:
                continue
            value = (parse_qs(urlparse(entry).query).get("units_id") or [""])[0]
            if value:
                return _clean(value)
        time.sleep(0.25)
    raise RuntimeError("could not determine selected unit id from the client-list request")


def _auth_context(
    driver: WebDriver,
    *,
    base_url: str,
    creds: Credentials,
    unit_name: str,
    timeout_seconds: int,
) -> tuple[str, str]:
    if not login_and_select_unit(
        driver,
        base_url=base_url,
        creds=creds,
        unit_name=unit_name,
        timeout_seconds=timeout_seconds,
    ):
        raise RuntimeError(f"could not login/select verified unit {unit_name}")
    driver.get(f"{base_url.rstrip('/')}{CLIENTS_URL_PATH}")
    token = _clean(driver.execute_script("return window.localStorage.getItem('AuthToken') || '';"))
    if not token:
        raise RuntimeError("authenticated browser did not expose AuthToken")
    return token, _unit_id_from_loaded_list(driver, timeout_seconds=timeout_seconds)


def _request_json(url: str, *, headers: dict[str, str], attempts: int = 3) -> dict[str, Any]:
    error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            data = response.json()
            if isinstance(data, dict):
                return data
            raise RuntimeError("unexpected non-object API response")
        except Exception as exc:  # pragma: no cover - network-dependent
            error = exc
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"GET failed after {attempts} attempts: {error}")


def _list_page(*, headers: dict[str, str], unit_id: str, page: int) -> dict[str, Any]:
    url = f"{API_BASE}/clients?page={page}&units_id={unit_id}&itemsPerPage=20&filter_namePhoneOrCPF="
    return _request_json(url, headers=headers)


def _detail(*, headers: dict[str, str], client_id: str) -> dict[str, Any]:
    url = f"{API_BASE}/clients/{client_id}?clients_id={client_id}"
    return _request_json(url, headers=headers)


def run_client_registration_api_export(
    driver: WebDriver,
    *,
    base_url: str,
    creds: Credentials,
    unit_names: list[str],
    output_dir: Path,
    timeout_seconds: int,
) -> tuple[list[ClientRegistrationRecord], dict[str, Any]]:
    records_by_key = _load_checkpoint(output_dir)
    summary: dict[str, Any] = {"units": {}, "totals": {"units_processed": 0, "pages_processed": 0, "records_exported": 0, "client_errors": 0}, "client_errors": []}
    workers = _positive_int_env("EF_CLIENT_REGISTRATION_API_WORKERS", 4)
    client_limit = _optional_positive_int_env("EF_CLIENT_REGISTRATION_MAX_CLIENTS_PER_UNIT")
    for unit_name in unit_names:
        log(f"Client registration API: starting verified unit {unit_name}")
        token, unit_id = _auth_context(driver, base_url=base_url, creds=creds, unit_name=unit_name, timeout_seconds=timeout_seconds)
        headers = {"Authorization": f"Bearer {token}"}
        first = _list_page(headers=headers, unit_id=unit_id, page=1)
        pages_total = int(first.get("pageTotal") or 1)
        items_total = int(first.get("itemsTotal") or 0)
        unit_summary: dict[str, Any] = {"unit_id": unit_id, "pages_expected": pages_total, "items_expected": items_total, "pages_processed": 0, "records_exported": 0, "client_errors": 0}
        summary["units"][unit_name] = unit_summary

        for page in range(1, pages_total + 1):
            existing_count = sum(1 for key in records_by_key if key[0] == unit_name)
            if client_limit is not None and existing_count >= client_limit:
                break
            listing = first if page == 1 else _list_page(headers=headers, unit_id=unit_id, page=page)
            items = listing.get("items") or []
            unit_summary["pages_processed"] += 1
            summary["totals"]["pages_processed"] += 1
            ids = [_clean(item.get("id")) for item in items if _clean(item.get("id"))]
            pending = [client_id for client_id in ids if (unit_name, client_id) not in records_by_key]
            if client_limit is not None:
                pending = pending[: max(0, client_limit - existing_count)]

            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = {executor.submit(_detail, headers=headers, client_id=client_id): client_id for client_id in pending}
                for future in as_completed(futures):
                    client_id = futures[future]
                    try:
                        payload = future.result()
                        if not _contains_unit_id(payload.get("units_id"), unit_id):
                            raise RuntimeError("detail does not reference the verified list unit")
                        record = _record_from_api(unit_name=unit_name, page_number=page, payload=payload)
                        if not record.cliente or not record.cliente_id:
                            raise RuntimeError("detail lacks client id or name")
                        records_by_key[(unit_name, record.cliente_id)] = record
                        unit_summary["records_exported"] += 1
                        summary["totals"]["records_exported"] += 1
                    except Exception as exc:  # pragma: no cover - network-dependent
                        unit_summary["client_errors"] += 1
                        summary["totals"]["client_errors"] += 1
                        summary["client_errors"].append({"unidade": unit_name, "cliente_id": client_id, "pagina_lista": page, "erro": str(exc)})
                        log(f"ERROR: Client registration API: {unit_name} {client_id} page {page}: {exc}")
            _flush_checkpoint(output_dir, records_by_key, summary)
            log(f"Client registration API: {unit_name} page {page}/{pages_total} checkpointed")
        summary["totals"]["units_processed"] += 1

    outputs = _flush_checkpoint(output_dir, records_by_key, summary)
    summary["outputs"] = outputs
    return list(records_by_key.values()), summary


def run_with_runtime(*, base_url: str, creds: Credentials, output_dir: Path, headless: bool, user_data_dir: Path | None, timeout_seconds: int) -> tuple[list[ClientRegistrationRecord], dict[str, Any]]:
    driver = create_driver(headless=headless, user_data_dir=user_data_dir)
    try:
        return run_client_registration_api_export(driver, base_url=base_url, creds=creds, unit_names=resolve_units(), output_dir=output_dir, timeout_seconds=timeout_seconds)
    finally:
        driver.quit()
