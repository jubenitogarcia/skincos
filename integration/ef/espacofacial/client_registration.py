from __future__ import annotations

import json
import os
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support.ui import WebDriverWait

from .auth import Credentials, log, login_and_select_unit
from .diagnostics import capture_artifacts
from .excel import format_workbook
from .procedures import (
    CLIENT_NAME_UID,
    CLIENTS_URL_PATH,
    DETAIL_URL_FRAGMENT,
    VisibleClient,
    _click_next_page,
    _client_id_from_url,
    _client_signature,
    _go_back_to_clients,
    _visible_clients,
    resolve_units,
)

REGISTRATION_TAB_TEXT = "Cadastro"


@dataclass(frozen=True)
class ClientRegistrationRecord:
    unidade: str
    cliente: str
    cliente_id: str
    pagina_lista: int
    telefone: str
    telefones: str
    email: str
    emails: str
    data_nascimento: str
    sexo: str
    cpf: str
    profissao: str
    origem: str
    cep: str
    logradouro: str
    numero: str
    complemento: str
    bairro: str
    cidade: str
    estado: str
    endereco_completo: str
    url_cliente: str
    extraido_em: str


@dataclass(frozen=True)
class ClientRegistrationError:
    unidade: str
    cliente: str
    cliente_id: str
    pagina_lista: int
    etapa: str
    erro: str
    url_cliente: str


def _normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def _slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", _normalize_spaces(value).lower()).strip("_") or "unknown"


def _positive_int_env(name: str) -> int | None:
    raw = os.getenv(name, "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def _max_pages() -> int | None:
    return _positive_int_env("EF_CLIENT_REGISTRATION_MAX_PAGES")


def _max_clients_per_unit() -> int | None:
    return _positive_int_env("EF_CLIENT_REGISTRATION_MAX_CLIENTS_PER_UNIT")


def _wait_for_clients_page(driver: WebDriver, *, timeout_seconds: int) -> None:
    def _ready(current: WebDriver) -> bool:
        if CLIENTS_URL_PATH not in (current.current_url or ""):
            return False
        try:
            return bool(_visible_clients(current))
        except Exception:
            return False

    WebDriverWait(driver, timeout_seconds).until(_ready)


def _click_client_for_registration(driver: WebDriver, *, client: VisibleClient) -> bool:
    """Use pointer events on the list row rather than a bare paragraph click.

    The current app only hydrates the client detail reliably when the row gets
    a normal pointer sequence. The older procedures extractor's bare
    ``node.click()`` can navigate to an empty detail route.
    """

    return bool(driver.execute_script(
        r"""
        const uid = arguments[0];
        const repeatIndex = arguments[1];
        const expectedName = arguments[2];
        const norm = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const visible = (node) => {
          if (!node) return false;
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const clickableAncestor = (node) => {
          let current = node;
          for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
            if (!visible(current)) continue;
            if (current.matches('a, button, [role="button"], [data-ww-element="true"], .ww-layout, .ww-element')) {
              return current;
            }
          }
          return node;
        };
        const matching = Array.from(document.querySelectorAll(`p[data-ww-uid="${uid}"]`))
          .filter((node) => visible(node) && norm(node.innerText) === expectedName);
        // The current UI no longer consistently renders data-ww-repeat-index.
        // Retain it when available, then fall back to the exact visible name.
        const candidate = matching.find(
          (node) => node.getAttribute('data-ww-repeat-index') === repeatIndex
        ) || matching[0];
        if (!candidate) return false;
        const target = clickableAncestor(candidate);
        target.scrollIntoView({ block: 'center', inline: 'center' });
        for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
          target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
        target.click();
        return true;
        """,
        CLIENT_NAME_UID,
        client.repeat_index,
        client.name,
    ))


def _wait_for_registration_detail(driver: WebDriver, *, expected_name: str, timeout_seconds: int) -> None:
    def _ready(current: WebDriver) -> bool:
        if DETAIL_URL_FRAGMENT not in (current.current_url or ""):
            return False
        try:
            body = _normalize_spaces(current.find_element(By.TAG_NAME, "body").text)
        except Exception:
            return False
        return expected_name in body and REGISTRATION_TAB_TEXT in body

    WebDriverWait(driver, timeout_seconds).until(_ready)


def _return_to_clients(driver: WebDriver, *, base_url: str, timeout_seconds: int) -> None:
    # The client detail is reached from the SPA list. Browser history preserves
    # that list state and is substantially faster than waiting for a custom
    # back control to hydrate on every record.
    try:
        driver.back()
        _wait_for_clients_page(driver, timeout_seconds=min(timeout_seconds, 8))
        return
    except Exception:
        pass

    clicked = bool(driver.execute_script(
        r"""
        const targetText = 'Voltar';
        const norm = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const visible = (node) => {
          if (!node) return false;
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const clickableAncestor = (node) => {
          let current = node;
          for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
            if (!visible(current)) continue;
            if (current.matches('a, button, [role="button"], [data-ww-element="true"], .ww-layout, .ww-element')) {
              return current;
            }
          }
          return node;
        };
        const candidates = Array.from(document.querySelectorAll('button, [role="button"], p, span, div'))
          .filter((node) => visible(node) && norm(node.innerText) === targetText)
          .sort((left, right) => (left.innerText || '').length - (right.innerText || '').length);
        if (!candidates.length) return false;
        const target = clickableAncestor(candidates[0]);
        target.scrollIntoView({ block: 'center', inline: 'center' });
        for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
          target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
        target.click();
        return true;
        """
    ))
    if clicked:
        try:
            _wait_for_clients_page(driver, timeout_seconds=timeout_seconds)
            return
        except Exception:
            pass

    try:
        _go_back_to_clients(driver, timeout_seconds=timeout_seconds)
        return
    except Exception:
        # The application can leave an unhydrated detail route after a network
        # hiccup. A direct route recovery is safe and keeps the next client
        # independent from this one.
        driver.get(f"{base_url.rstrip('/')}{CLIENTS_URL_PATH}")
        _wait_for_clients_page(driver, timeout_seconds=timeout_seconds)


def _open_registration_tab(driver: WebDriver, *, timeout_seconds: int) -> None:
    clicked = driver.execute_script(
        r"""
        const targetText = arguments[0];
        const norm = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const visible = (node) => {
          if (!node) return false;
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const button = Array.from(document.querySelectorAll('button, [role="button"]'))
          .find((node) => visible(node) && norm(node.innerText) === targetText);
        if (!button) return false;
        button.scrollIntoView({ block: 'center', inline: 'center' });
        button.click();
        return true;
        """,
        REGISTRATION_TAB_TEXT,
    )
    if not clicked:
        raise RuntimeError("could not find the Cadastro tab")

    def _loaded(current: WebDriver) -> bool:
        try:
            return any(
                element.is_displayed()
                for element in current.find_elements(By.CSS_SELECTOR, 'input[placeholder="Digite o nome"]')
            )
        except Exception:
            return False

    WebDriverWait(driver, timeout_seconds).until(_loaded)


def _extract_registration_fields(driver: WebDriver) -> dict[str, str]:
    """Read the visible Cadastro form without mutating it.

    The legacy app uses custom form controls without stable input names. The
    extractor intentionally relies on visible labels and placeholders observed
    in the live application, and returns blanks when an optional field is not
    present instead of guessing.
    """

    values = driver.execute_script(
        r"""
        const norm = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const visible = (node) => {
          if (!node) return false;
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const inputs = Array.from(document.querySelectorAll('input, textarea'))
          .filter(visible);
        const byPlaceholder = (placeholder) => inputs
          .filter((input) => input.getAttribute('placeholder') === placeholder)
          .map((input) => norm(input.value))
          .filter(Boolean);
        const labelNode = (label) => Array.from(document.querySelectorAll('p, h1, h2, h3, label, span'))
          .filter(visible)
          .find((node) => norm(node.innerText) === label);
        const valueAfterLabel = (label) => {
          const source = labelNode(label);
          if (!source) return '';
          const following = inputs.filter((input) => Boolean(source.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING));
          return norm(following[0]?.value || '');
        };
        const textAfterLabel = (label) => {
          const source = labelNode(label);
          if (!source) return '';
          let node = source;
          for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
            let sibling = node.nextElementSibling;
            while (sibling) {
              if (visible(sibling)) {
                const text = norm(sibling.innerText || '');
                if (text && text !== label && text !== 'Selecione') return text;
              }
              sibling = sibling.nextElementSibling;
            }
          }
          return '';
        };
        const phones = byPlaceholder('(00) 0 0000-0000');
        const emails = byPlaceholder('Digite o email');
        return {
          nome: byPlaceholder('Digite o nome')[0] || '',
          nascimento: valueAfterLabel('Data de nascimento'),
          sexo: textAfterLabel('Sexo'),
          cpf: byPlaceholder('000.000.000-00')[0] || '',
          profissao: byPlaceholder('Nome da profissão')[0] || '',
          origem: valueAfterLabel('Como conheceu a EF?') || textAfterLabel('Como conheceu a EF?'),
          telefone: phones[0] || '',
          telefones: phones,
          email: emails[0] || '',
          emails,
          cep: byPlaceholder('00000-000')[0] || '',
          logradouro: byPlaceholder('Digite a rua')[0] || '',
          complemento: byPlaceholder('Escreva o complemento')[0] || '',
          numero: inputs.find((input) => input.type === 'number')?.value || '',
          cidade: byPlaceholder('Insira a cidade')[0] || '',
          bairro: byPlaceholder('Digite o bairro')[0] || '',
          estado: valueAfterLabel('Estado') || textAfterLabel('Estado'),
        };
        """
    )
    if not isinstance(values, dict):
        raise RuntimeError("Cadastro form returned an invalid field payload")
    return {
        key: _normalize_spaces(" | ".join(value) if isinstance(value, list) else str(value or ""))
        for key, value in values.items()
    }


def _format_address(values: dict[str, str]) -> str:
    street = values.get("logradouro", "")
    number = values.get("numero", "")
    complement = values.get("complemento", "")
    neighborhood = values.get("bairro", "")
    city = values.get("cidade", "")
    state = values.get("estado", "")
    cep = values.get("cep", "")
    first = " ".join(part for part in (street, number) if part)
    return ", ".join(part for part in (first, complement, neighborhood, city, state, cep) if part)


def _record_from_csv_row(row: dict[str, str]) -> ClientRegistrationRecord:
    raw_page = _normalize_spaces(str(row.get("Página Lista", "")))
    try:
        page_number = int(raw_page)
    except ValueError:
        page_number = 0
    return ClientRegistrationRecord(
        unidade=_normalize_spaces(str(row.get("Unidade", ""))),
        cliente=_normalize_spaces(str(row.get("Cliente", ""))),
        cliente_id=_normalize_spaces(str(row.get("Cliente ID", ""))),
        pagina_lista=page_number,
        telefone=_normalize_spaces(str(row.get("Telefone", ""))),
        telefones=_normalize_spaces(str(row.get("Telefones", ""))),
        email=_normalize_spaces(str(row.get("Email", ""))),
        emails=_normalize_spaces(str(row.get("Emails", ""))),
        data_nascimento=_normalize_spaces(str(row.get("Nascimento", ""))),
        sexo=_normalize_spaces(str(row.get("Sexo", ""))),
        cpf=_normalize_spaces(str(row.get("CPF", ""))),
        profissao=_normalize_spaces(str(row.get("Profissão", ""))),
        origem=_normalize_spaces(str(row.get("Como conheceu", ""))),
        cep=_normalize_spaces(str(row.get("CEP", ""))),
        logradouro=_normalize_spaces(str(row.get("Logradouro", ""))),
        numero=_normalize_spaces(str(row.get("Número", ""))),
        complemento=_normalize_spaces(str(row.get("Complemento", ""))),
        bairro=_normalize_spaces(str(row.get("Bairro", ""))),
        cidade=_normalize_spaces(str(row.get("Cidade", ""))),
        estado=_normalize_spaces(str(row.get("Estado", ""))),
        endereco_completo=_normalize_spaces(str(row.get("Endereço completo", ""))),
        url_cliente=_normalize_spaces(str(row.get("URL Cliente", ""))),
        extraido_em=_normalize_spaces(str(row.get("Extraído em", ""))),
    )


def _load_checkpoint(output_dir: Path) -> dict[tuple[str, str], ClientRegistrationRecord]:
    csv_path = output_dir / "cadastro_clientes_espacofacial.csv"
    if not csv_path.exists():
        return {}
    frame = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    records: dict[tuple[str, str], ClientRegistrationRecord] = {}
    for row in frame.to_dict("records"):
        record = _record_from_csv_row(row)
        if not record.unidade or not record.cliente:
            continue
        key = (record.unidade, record.cliente_id or record.cliente)
        records[key] = record
    return records


def _normalized_client_name(value: str) -> str:
    return _normalize_spaces(value).casefold()


def _unique_existing_by_name(
    records: dict[tuple[str, str], ClientRegistrationRecord],
) -> dict[tuple[str, str], ClientRegistrationRecord]:
    grouped: dict[tuple[str, str], list[ClientRegistrationRecord]] = {}
    for record in records.values():
        key = (record.unidade, _normalized_client_name(record.cliente))
        grouped.setdefault(key, []).append(record)
    return {key: values[0] for key, values in grouped.items() if len(values) == 1}


def _record_from_fields(
    *,
    unit_name: str,
    client: VisibleClient,
    client_id: str,
    page_number: int,
    client_url: str,
    fields: dict[str, str],
) -> ClientRegistrationRecord:
    return ClientRegistrationRecord(
        unidade=unit_name,
        cliente=fields.get("nome") or client.name,
        cliente_id=client_id,
        pagina_lista=page_number,
        telefone=fields.get("telefone", ""),
        telefones=fields.get("telefones", ""),
        email=fields.get("email", ""),
        emails=fields.get("emails", ""),
        data_nascimento=fields.get("nascimento", ""),
        sexo=fields.get("sexo", ""),
        cpf=fields.get("cpf", ""),
        profissao=fields.get("profissao", ""),
        origem=fields.get("origem", ""),
        cep=fields.get("cep", ""),
        logradouro=fields.get("logradouro", ""),
        numero=fields.get("numero", ""),
        complemento=fields.get("complemento", ""),
        bairro=fields.get("bairro", ""),
        cidade=fields.get("cidade", ""),
        estado=fields.get("estado", ""),
        endereco_completo=_format_address(fields),
        url_cliente=client_url,
        extraido_em=datetime.now().isoformat(timespec="seconds"),
    )


def _records_to_dataframe(records: list[ClientRegistrationRecord]) -> pd.DataFrame:
    columns = [
        "Unidade", "Cliente", "Cliente ID", "Página Lista", "Telefone", "Telefones", "Email", "Emails",
        "Nascimento", "Sexo", "CPF", "Profissão", "Como conheceu", "CEP", "Logradouro", "Número",
        "Complemento", "Bairro", "Cidade", "Estado", "Endereço completo", "URL Cliente", "Extraído em",
    ]
    rows = [
        {
            "Unidade": item.unidade,
            "Cliente": item.cliente,
            "Cliente ID": item.cliente_id,
            "Página Lista": item.pagina_lista,
            "Telefone": item.telefone,
            "Telefones": item.telefones,
            "Email": item.email,
            "Emails": item.emails,
            "Nascimento": item.data_nascimento,
            "Sexo": item.sexo,
            "CPF": item.cpf,
            "Profissão": item.profissao,
            "Como conheceu": item.origem,
            "CEP": item.cep,
            "Logradouro": item.logradouro,
            "Número": item.numero,
            "Complemento": item.complemento,
            "Bairro": item.bairro,
            "Cidade": item.cidade,
            "Estado": item.estado,
            "Endereço completo": item.endereco_completo,
            "URL Cliente": item.url_cliente,
            "Extraído em": item.extraido_em,
        }
        for item in records
    ]
    return pd.DataFrame(rows, columns=columns).sort_values(
        by=["Unidade", "Cliente", "Cliente ID"], kind="stable"
    ).reset_index(drop=True)


def write_outputs(
    output_dir: Path,
    records: list[ClientRegistrationRecord],
    summary: dict[str, Any],
) -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / "cadastro_clientes_espacofacial.csv"
    xlsx_path = output_dir / "cadastro_clientes_espacofacial.xlsx"
    summary_path = output_dir / "cadastro_clientes_espacofacial_resumo.json"
    frame = _records_to_dataframe(records)
    frame.to_csv(csv_path, index=False, encoding="utf-8")
    with pd.ExcelWriter(xlsx_path, engine="openpyxl") as writer:
        frame.to_excel(writer, index=False, sheet_name="Cadastros")
    format_workbook(xlsx_path)
    outputs = {"csv": str(csv_path), "xlsx": str(xlsx_path), "summary": str(summary_path)}
    summary_payload = dict(summary)
    summary_payload["outputs"] = outputs
    summary_path.write_text(json.dumps(summary_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return outputs


def _flush_checkpoint(
    output_dir: Path,
    records_by_key: dict[tuple[str, str], ClientRegistrationRecord],
    summary: dict[str, Any],
) -> dict[str, str]:
    outputs = write_outputs(output_dir, list(records_by_key.values()), summary)
    summary["outputs"] = outputs
    return outputs


def _record_error(
    summary: dict[str, Any],
    unit_summary: dict[str, int],
    *,
    unidade: str,
    cliente: str,
    cliente_id: str,
    pagina_lista: int,
    etapa: str,
    erro: str,
    url_cliente: str,
) -> None:
    unit_summary["client_errors"] += 1
    summary["totals"]["client_errors"] += 1
    summary.setdefault("client_errors", []).append(asdict(ClientRegistrationError(
        unidade=unidade,
        cliente=cliente,
        cliente_id=cliente_id,
        pagina_lista=pagina_lista,
        etapa=etapa,
        erro=erro,
        url_cliente=url_cliente,
    )))


def run_client_registration_export(
    driver: WebDriver,
    *,
    base_url: str,
    creds: Credentials,
    unit_names: list[str],
    output_dir: Path,
    debug_dir: Path,
    timeout_seconds: int = 20,
) -> tuple[list[ClientRegistrationRecord], dict[str, Any]]:
    records_by_key = _load_checkpoint(output_dir)
    existing_by_name = _unique_existing_by_name(records_by_key)
    resumed_per_unit: dict[str, int] = {}
    for record in records_by_key.values():
        resumed_per_unit[record.unidade] = resumed_per_unit.get(record.unidade, 0) + 1
    if records_by_key:
        log(f"Client registration: resuming {len(records_by_key)} checkpoint records")
    summary: dict[str, Any] = {
        "units": {},
        "totals": {
            "units_processed": 0,
            "pages_processed": 0,
            "clients_attempted": 0,
            "clients_processed": 0,
            "records_exported": 0,
            "resumed_records": len(records_by_key),
            "client_errors": 0,
        },
        "client_errors": [],
    }
    page_limit = _max_pages()
    client_limit = _max_clients_per_unit()

    for unit_name in unit_names:
        log(f"Client registration: starting unit {unit_name}")
        if not login_and_select_unit(driver, base_url=base_url, creds=creds, unit_name=unit_name, timeout_seconds=timeout_seconds):
            raise RuntimeError(f"could not login/select unit {unit_name}")
        driver.get(f"{base_url.rstrip('/')}{CLIENTS_URL_PATH}")
        _wait_for_clients_page(driver, timeout_seconds=timeout_seconds)
        unit_summary = {
            "pages_processed": 0,
            "clients_attempted": 0,
            "clients_processed": 0,
            "records_exported": 0,
            "client_errors": 0,
            "resumed_records": resumed_per_unit.get(unit_name, 0),
        }
        summary["units"][unit_name] = unit_summary

        page_number = 1
        while True:
            if page_limit is not None and page_number > page_limit:
                log(f"Client registration: page limit reached for {unit_name} ({page_limit})")
                break
            clients = _visible_clients(driver)
            if not clients:
                raise RuntimeError(f"no visible clients on page {page_number} for {unit_name}")
            page_signature = _client_signature(clients)
            unit_summary["pages_processed"] += 1
            summary["totals"]["pages_processed"] += 1

            for client in clients:
                existing_key = (unit_name, _normalized_client_name(client.name))
                if existing_key in existing_by_name:
                    unit_summary["clients_skipped_checkpoint"] = unit_summary.get("clients_skipped_checkpoint", 0) + 1
                    continue
                if client_limit is not None and unit_summary["clients_attempted"] >= client_limit:
                    break
                unit_summary["clients_attempted"] += 1
                summary["totals"]["clients_attempted"] += 1
                client_id = ""
                client_url = ""
                stage = "abrir_cliente"
                try:
                    if not _click_client_for_registration(driver, client=client):
                        raise RuntimeError(f"could not open client {client.name!r}")
                    _wait_for_registration_detail(
                        driver,
                        expected_name=client.name,
                        timeout_seconds=timeout_seconds,
                    )
                    client_url = driver.current_url
                    client_id = _client_id_from_url(client_url)
                    stage = "abrir_cadastro"
                    _open_registration_tab(driver, timeout_seconds=timeout_seconds)
                    stage = "extrair_cadastro"
                    fields = _extract_registration_fields(driver)
                    record = _record_from_fields(
                        unit_name=unit_name,
                        client=client,
                        client_id=client_id,
                        page_number=page_number,
                        client_url=client_url,
                        fields=fields,
                    )
                    records_by_key[(unit_name, client_id or client.name)] = record
                    unit_summary["clients_processed"] += 1
                    unit_summary["records_exported"] += 1
                    summary["totals"]["clients_processed"] += 1
                    summary["totals"]["records_exported"] += 1
                    log(f"Client registration: exported {record.cliente} ({client_id or 'sem_id'})")
                except Exception as exc:
                    _record_error(
                        summary, unit_summary, unidade=unit_name, cliente=client.name, cliente_id=client_id,
                        pagina_lista=page_number, etapa=stage, erro=str(exc), url_cliente=client_url,
                    )
                    log(f"ERROR: Client registration: {unit_name} {client.name} stage {stage}: {exc}")
                    capture_artifacts(
                        driver,
                        output_dir=debug_dir,
                        label=f"registration_client_error_{_slugify(unit_name)}_{page_number:03d}_{_slugify(client.name)}",
                    )
                finally:
                    if DETAIL_URL_FRAGMENT in (driver.current_url or ""):
                        try:
                            _return_to_clients(
                                driver,
                                base_url=base_url,
                                timeout_seconds=timeout_seconds,
                            )
                        except Exception as exc:
                            raise RuntimeError(f"could not return to clients after {client.name!r}: {exc}") from exc

            _flush_checkpoint(output_dir, records_by_key, summary)
            if client_limit is not None and unit_summary["clients_attempted"] >= client_limit:
                break
            if not _click_next_page(driver, previous_signature=page_signature, timeout_seconds=timeout_seconds):
                break
            page_number += 1
            time.sleep(0.5)

        summary["totals"]["units_processed"] += 1
        _flush_checkpoint(output_dir, records_by_key, summary)

    outputs = _flush_checkpoint(output_dir, records_by_key, summary)
    summary["outputs"] = outputs
    return list(records_by_key.values()), summary


def run_with_runtime(
    *,
    base_url: str,
    creds: Credentials,
    output_dir: Path,
    debug_dir: Path,
    headless: bool,
    user_data_dir: Path | None,
    timeout_seconds: int,
) -> tuple[list[ClientRegistrationRecord], dict[str, Any]]:
    from .core import create_driver

    max_session_retries = _positive_int_env("EF_CLIENT_REGISTRATION_MAX_SESSION_RETRIES") or 8
    session_attempt = 0
    while True:
        driver = create_driver(headless=headless, user_data_dir=user_data_dir)
        try:
            return run_client_registration_export(
                driver,
                base_url=base_url,
                creds=creds,
                unit_names=resolve_units(),
                output_dir=output_dir,
                debug_dir=debug_dir,
                timeout_seconds=timeout_seconds,
            )
        except Exception as exc:
            message = str(exc).lower()
            if "tab crashed" not in message or session_attempt >= max_session_retries:
                capture_artifacts(driver, output_dir=debug_dir, label="error_client_registration_export")
                raise
            session_attempt += 1
            log(
                "WARNING: Client registration: Chrome tab crashed; "
                f"restarting session ({session_attempt}/{max_session_retries}) from checkpoint"
            )
            time.sleep(2)
        finally:
            try:
                driver.quit()
            except Exception:
                pass
