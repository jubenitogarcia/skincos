from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support.ui import WebDriverWait

from .auth import Credentials, log, login_and_select_unit
from .diagnostics import capture_artifacts
from .excel import format_workbook


CLIENTS_URL_PATH = "/client/clientes/"
DETAIL_URL_FRAGMENT = "/client-single-new/"

CLIENT_NAME_UID = "2ab534f6-74d4-46ae-beb0-e25ea22d3f3d"
PROCEDURES_CARD_TEXT = "Procedimentos realizados"
PROCEDURES_DIALOG_TITLE = "Procedimentos em revisão e realizados"
PROCEDURES_ROW_UID = "87b49289-6e6b-4651-a5c6-0f2b6df3f596"


@dataclass(frozen=True)
class VisibleClient:
    name: str
    repeat_index: str


@dataclass(frozen=True)
class ProcedureRecord:
    unidade: str
    cliente: str
    cliente_id: str
    pagina_lista: int
    data: str
    horario: str
    procedimento_grupo: str
    procedimento: str
    status: str
    url_cliente: str


@dataclass(frozen=True)
class ClientExportError:
    unidade: str
    cliente: str
    cliente_id: str
    pagina_lista: int
    etapa: str
    erro: str
    url_cliente: str


def _normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def _looks_like_client_name(value: str) -> bool:
    text = _normalize_spaces(value)
    if not text:
        return False
    return bool(re.search(r"[A-Za-zÀ-ÖØ-öø-ÿ]", text))


def _normalize_unit_options(raw: str) -> list[str]:
    items = [_normalize_spaces(item) for item in raw.split(",")]
    return [item for item in items if item]


def resolve_units() -> list[str]:
    env_units = os.getenv("EF_UNITS", "").strip()
    if env_units:
        return _normalize_unit_options(env_units)

    env_options = os.getenv("EF_UNIT_OPTIONS", "").strip()
    if env_options:
        return _normalize_unit_options(env_options)

    return ["BarraShoppingSul", "Novo Hamburgo"]


def _max_pages() -> int | None:
    raw = os.getenv("EF_PROCEDURES_MAX_PAGES", "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def _max_clients_per_unit() -> int | None:
    raw = os.getenv("EF_PROCEDURES_MAX_CLIENTS_PER_UNIT", "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def _slugify(value: str) -> str:
    raw = _normalize_spaces(value).lower()
    raw = re.sub(r"[^a-z0-9]+", "_", raw)
    return raw.strip("_") or "unknown"


def _wait_for_clients_page(driver: WebDriver, *, timeout_seconds: int) -> None:
    def _ready(current: WebDriver) -> bool:
        if CLIENTS_URL_PATH not in (current.current_url or ""):
            return False
        try:
            count = len(_visible_clients(current))
        except Exception:
            return False
        return count > 0

    WebDriverWait(driver, timeout_seconds).until(_ready)


def _visible_clients(driver: WebDriver) -> list[VisibleClient]:
    rows = driver.execute_script(
        """
        const uid = arguments[0];
        const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        return Array.from(document.querySelectorAll(`p[data-ww-uid="${uid}"]`))
          .map((node) => ({
            name: norm(node.innerText || ''),
            repeatIndex: node.getAttribute('data-ww-repeat-index') || '',
          }))
          .filter((item) => item.name);
        """,
        CLIENT_NAME_UID,
    )
    clients = [
        VisibleClient(name=str(item["name"]), repeat_index=str(item["repeatIndex"]))
        for item in rows or []
        if _looks_like_client_name(str(item.get("name", "")))
    ]
    return clients


def _client_signature(clients: list[VisibleClient]) -> tuple[str, ...]:
    return tuple(client.name for client in clients)


def _click_client(driver: WebDriver, *, client: VisibleClient) -> bool:
    clicked = driver.execute_script(
        """
        const uid = arguments[0];
        const repeatIndex = arguments[1];
        const expectedName = arguments[2];
        const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const candidates = Array.from(document.querySelectorAll(`p[data-ww-uid="${uid}"]`));
        for (const node of candidates) {
          const currentRepeat = node.getAttribute('data-ww-repeat-index') || '';
          const currentName = norm(node.innerText || '');
          if (currentRepeat !== repeatIndex || currentName !== expectedName) continue;
          node.click();
          return true;
        }
        return false;
        """,
        CLIENT_NAME_UID,
        client.repeat_index,
        client.name,
    )
    return bool(clicked)


def _wait_for_detail_page(driver: WebDriver, *, expected_name: str, timeout_seconds: int) -> None:
    def _ready(current: WebDriver) -> bool:
        if DETAIL_URL_FRAGMENT not in (current.current_url or ""):
            return False
        try:
            body_text = _normalize_spaces(current.find_element(By.TAG_NAME, "body").text)
        except Exception:
            return False
        return expected_name in body_text

    WebDriverWait(driver, timeout_seconds).until(_ready)


def _open_procedures_modal(driver: WebDriver) -> bool:
    click_strategies = (
        """
        const targetText = arguments[0];
        const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const isVisible = (node) => {
          if (!node) return false;
          const style = window.getComputedStyle(node);
          if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const fireClick = (node) => {
          if (!node || !isVisible(node)) return false;
          node.scrollIntoView({ block: 'center', inline: 'center' });
          for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
            node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
          }
          if (typeof node.click === 'function') node.click();
          return true;
        };
        for (const node of Array.from(document.querySelectorAll('p.ww-text-content'))) {
          if (norm(node.innerText || '') !== targetText) continue;
          if (fireClick(node)) return true;
        }
        return false;
        """,
        """
        const targetText = arguments[0];
        const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const isVisible = (node) => {
          if (!node) return false;
          const style = window.getComputedStyle(node);
          if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const clickableAncestor = (node) => {
          let current = node;
          for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
            if (!isVisible(current)) continue;
            if (
              current.matches('a, button, [role="button"], [data-ww-element="true"], .ww-layout, .ww-element') ||
              current.style.cursor === 'pointer'
            ) {
              return current;
            }
          }
          return node;
        };
        const fireClick = (node) => {
          const target = clickableAncestor(node);
          if (!target || !isVisible(target)) return false;
          target.scrollIntoView({ block: 'center', inline: 'center' });
          for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
            target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
          }
          if (typeof target.click === 'function') target.click();
          return true;
        };
        const candidates = Array.from(document.querySelectorAll('body *'))
          .filter((node) => isVisible(node))
          .map((node) => ({ node, text: norm(node.innerText || '') }))
          .filter((item) => item.text && item.text.includes(targetText))
          .sort((a, b) => a.text.length - b.text.length);
        for (const item of candidates) {
          if (fireClick(item.node)) return true;
        }
        return false;
        """,
    )

    for script in click_strategies:
        clicked = driver.execute_script(script, PROCEDURES_CARD_TEXT)
        if not clicked:
            continue
        try:
            WebDriverWait(driver, 10).until(
                lambda current: PROCEDURES_DIALOG_TITLE in _normalize_spaces(current.find_element(By.TAG_NAME, "body").text)
            )
            return True
        except TimeoutException:
            time.sleep(0.5)

    return False


def _extract_procedure_rows(driver: WebDriver) -> list[dict[str, str]]:
    rows = driver.execute_script(
        """
        const rowUid = arguments[0];
        const dialogTitle = arguments[1];
        const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .ww-dialog'));
        const dialog = dialogs
          .map((node) => ({ node, text: norm(node.innerText || '') }))
          .filter((item) => item.text.includes(dialogTitle))
          .sort((a, b) => b.text.length - a.text.length)[0];
        if (!dialog) return [];

        return Array.from(dialog.node.querySelectorAll(`div[data-ww-uid="${rowUid}"]`))
          .map((row) => {
            const cols = Array.from(row.children).filter((child) => child && child.nodeType === Node.ELEMENT_NODE);
            const dateText = norm(cols[0]?.innerText || '');
            const procedureText = norm(cols[1]?.innerText || '');
            const statusText = norm(cols[2]?.innerText || '');
            const procedureParts = Array.from(cols[1]?.querySelectorAll('p.ww-text-content') || [])
              .map((node) => norm(node.innerText || ''))
              .filter(Boolean);
            return {
              repeatIndex: row.getAttribute('data-ww-repeat-index') || '',
              dateText,
              procedureText,
              statusText,
              procedureParts,
            };
          })
          .filter((item) => item.dateText && item.procedureText);
        """,
        PROCEDURES_ROW_UID,
        PROCEDURES_DIALOG_TITLE,
    )
    return list(rows or [])


def _close_procedures_modal(driver: WebDriver) -> bool:
    closed = driver.execute_script(
        """
        const dialogTitle = arguments[0];
        const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .ww-dialog'));
        const dialog = dialogs
          .map((node) => ({ node, text: norm(node.innerText || '') }))
          .filter((item) => item.text.includes(dialogTitle))
          .sort((a, b) => b.text.length - a.text.length)[0];
        if (!dialog) return true;

        const closeButton =
          dialog.node.querySelector('button .icon-x')?.closest('button') ||
          dialog.node.querySelector('button');
        if (!closeButton) return false;
        closeButton.click();
        return true;
        """,
        PROCEDURES_DIALOG_TITLE,
    )
    if not closed:
        return False

    try:
        WebDriverWait(driver, 10).until(
            lambda current: PROCEDURES_DIALOG_TITLE not in _normalize_spaces(current.find_element(By.TAG_NAME, "body").text)
        )
    except TimeoutException:
        return False
    return True


def _go_back_to_clients(driver: WebDriver, *, timeout_seconds: int) -> None:
    clicked = driver.execute_script(
        """
        const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        const target = buttons.find((node) => norm(node.innerText || '') === 'Voltar');
        if (!target) return false;
        target.click();
        return true;
        """
    )
    if not clicked:
        raise RuntimeError("could not find detail back button")
    _wait_for_clients_page(driver, timeout_seconds=timeout_seconds)


def _click_next_page(driver: WebDriver, *, previous_signature: tuple[str, ...], timeout_seconds: int) -> bool:
    clicked = driver.execute_script(
        """
        const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        const target = buttons.find((node) => norm(node.innerText || '') === 'Avançar');
        if (!target) return false;
        if (target.disabled || target.getAttribute('aria-disabled') === 'true') return false;
        target.click();
        return true;
        """
    )
    if not clicked:
        return False

    def _page_changed(current: WebDriver) -> bool:
        try:
            signature = _client_signature(_visible_clients(current))
        except Exception:
            return False
        return bool(signature) and signature != previous_signature

    WebDriverWait(driver, timeout_seconds).until(_page_changed)
    return True


def _parse_modal_datetime(value: str) -> tuple[str, str]:
    raw = _normalize_spaces(value)
    if not raw:
        return "", ""

    match = re.search(r"(\d{2}/\d{2}/\d{2,4})\s+(\d{2}:\d{2})", raw)
    if not match:
        return raw, ""

    date_part = match.group(1)
    time_part = match.group(2)
    for fmt_in, fmt_out in (("%d/%m/%y", "%d/%m/%Y"), ("%d/%m/%Y", "%d/%m/%Y")):
        try:
            parsed = datetime.strptime(date_part, fmt_in)
            return parsed.strftime(fmt_out), time_part
        except ValueError:
            continue
    return date_part, time_part


def _procedure_parts(raw_parts: list[str], fallback_text: str) -> tuple[str, str]:
    parts = [_normalize_spaces(item) for item in raw_parts if _normalize_spaces(item)]
    if len(parts) >= 2:
        return parts[0], " - ".join(parts[1:])
    if len(parts) == 1:
        return "", parts[0]
    return "", _normalize_spaces(fallback_text)


def _client_id_from_url(url: str) -> str:
    raw = (url or "").rstrip("/")
    return raw.rsplit("/", 1)[-1] if raw else ""


def _record_client_error(
    summary: dict[str, Any],
    unit_summary: dict[str, Any],
    *,
    unidade: str,
    cliente: str,
    cliente_id: str,
    pagina_lista: int,
    etapa: str,
    erro: str,
    url_cliente: str,
) -> None:
    error = ClientExportError(
        unidade=unidade,
        cliente=cliente,
        cliente_id=cliente_id,
        pagina_lista=pagina_lista,
        etapa=etapa,
        erro=erro,
        url_cliente=url_cliente,
    )
    unit_summary["client_errors"] += 1
    summary["totals"]["client_errors"] += 1
    summary.setdefault("client_errors", []).append(error.__dict__)


def _flush_checkpoint(output_dir: Path, records: list[ProcedureRecord], summary: dict[str, Any]) -> dict[str, str]:
    outputs = write_outputs(output_dir, records, summary)
    summary["outputs"] = outputs
    return outputs


def _records_to_dataframe(records: list[ProcedureRecord]) -> pd.DataFrame:
    rows = [
        {
            "Unidade": record.unidade,
            "Cliente": record.cliente,
            "Cliente ID": record.cliente_id,
            "Página Lista": record.pagina_lista,
            "Data": record.data,
            "Horário": record.horario,
            "Procedimento Grupo": record.procedimento_grupo,
            "Procedimento": record.procedimento,
            "Status": record.status,
            "URL Cliente": record.url_cliente,
        }
        for record in records
    ]
    df = pd.DataFrame(rows)
    if df.empty:
        return df

    df["_sort_data"] = pd.to_datetime(df["Data"], format="%d/%m/%Y", errors="coerce")
    df["_sort_hora"] = pd.to_datetime(df["Horário"], format="%H:%M", errors="coerce")
    df = df.sort_values(
        by=["Unidade", "Cliente", "_sort_data", "_sort_hora", "Procedimento", "Status"],
        kind="stable",
    ).drop(columns=["_sort_data", "_sort_hora"])
    return df.reset_index(drop=True)


def write_outputs(output_dir: Path, records: list[ProcedureRecord], summary: dict[str, Any]) -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / "procedimentos_clientes_espacofacial.csv"
    xlsx_path = output_dir / "procedimentos_clientes_espacofacial.xlsx"
    summary_path = output_dir / "procedimentos_clientes_espacofacial_resumo.json"

    df = _records_to_dataframe(records)
    if df.empty:
        df = pd.DataFrame(
            columns=[
                "Unidade",
                "Cliente",
                "Cliente ID",
                "Página Lista",
                "Data",
                "Horário",
                "Procedimento Grupo",
                "Procedimento",
                "Status",
                "URL Cliente",
            ]
        )

    df.to_csv(csv_path, index=False, encoding="utf-8")
    with pd.ExcelWriter(xlsx_path, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Procedimentos")
    format_workbook(xlsx_path)
    outputs = {
        "csv": str(csv_path),
        "xlsx": str(xlsx_path),
        "summary": str(summary_path),
    }
    summary_payload = dict(summary)
    summary_payload["outputs"] = outputs
    summary_path.write_text(json.dumps(summary_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return outputs


def run_client_procedures_export(
    driver: WebDriver,
    *,
    base_url: str,
    creds: Credentials,
    unit_names: list[str],
    output_dir: Path,
    debug_dir: Path,
    timeout_seconds: int = 20,
) -> tuple[list[ProcedureRecord], dict[str, Any]]:
    all_records: list[ProcedureRecord] = []
    summary: dict[str, Any] = {
        "units": {},
        "totals": {
            "units_processed": 0,
            "pages_processed": 0,
            "clients_processed": 0,
            "clients_with_procedures": 0,
            "clients_without_procedures": 0,
            "procedures_exported": 0,
            "client_errors": 0,
        },
        "client_errors": [],
    }

    page_limit = _max_pages()
    client_limit = _max_clients_per_unit()

    for unit_name in unit_names:
        log(f"Procedures: starting unit {unit_name}")
        if not login_and_select_unit(
            driver,
            base_url=base_url,
            creds=creds,
            unit_name=unit_name,
            timeout_seconds=timeout_seconds,
        ):
            raise RuntimeError(f"could not login/select unit {unit_name}")

        driver.get(f"{base_url.rstrip('/')}{CLIENTS_URL_PATH}")
        _wait_for_clients_page(driver, timeout_seconds=timeout_seconds)
        time.sleep(1)

        unit_summary = {
            "pages_processed": 0,
            "clients_processed": 0,
            "clients_with_procedures": 0,
            "clients_without_procedures": 0,
            "procedures_exported": 0,
            "client_errors": 0,
        }
        summary["units"][unit_name] = unit_summary

        page_number = 1
        while True:
            if page_limit is not None and page_number > page_limit:
                log(f"Procedures: page limit reached for {unit_name} ({page_limit})")
                break

            visible_clients = _visible_clients(driver)
            if not visible_clients:
                raise RuntimeError(f"no visible clients found on page {page_number} for unit {unit_name}")

            log(f"Procedures: unit {unit_name} page {page_number} clients {len(visible_clients)}")
            page_signature = _client_signature(visible_clients)
            unit_summary["pages_processed"] += 1
            summary["totals"]["pages_processed"] += 1

            for client in visible_clients:
                if client_limit is not None and unit_summary["clients_processed"] >= client_limit:
                    log(f"Procedures: client limit reached for {unit_name} ({client_limit})")
                    break

                client_url = ""
                client_id = ""
                current_stage = "abrir_cliente"
                try:
                    if not _click_client(driver, client=client):
                        raise RuntimeError(f"could not open client {client.name!r} on page {page_number}")

                    _wait_for_detail_page(driver, expected_name=client.name, timeout_seconds=timeout_seconds)
                    time.sleep(0.5)

                    client_url = driver.current_url
                    client_id = _client_id_from_url(client_url)
                    unit_summary["clients_processed"] += 1
                    summary["totals"]["clients_processed"] += 1

                    log(f"Procedures: reading client {client.name} ({client_id})")
                    current_stage = "abrir_modal_procedimentos"
                    if not _open_procedures_modal(driver):
                        raise RuntimeError(f"could not open procedures modal for client {client.name!r}")

                    current_stage = "extrair_procedimentos"
                    procedure_rows = _extract_procedure_rows(driver)

                    current_stage = "fechar_modal_procedimentos"
                    if not _close_procedures_modal(driver):
                        raise RuntimeError(f"could not close procedures modal for client {client.name!r}")

                    if procedure_rows:
                        unit_summary["clients_with_procedures"] += 1
                        summary["totals"]["clients_with_procedures"] += 1
                    else:
                        unit_summary["clients_without_procedures"] += 1
                        summary["totals"]["clients_without_procedures"] += 1

                    for row in procedure_rows:
                        data, horario = _parse_modal_datetime(str(row.get("dateText", "")))
                        grupo, procedimento = _procedure_parts(
                            list(row.get("procedureParts") or []),
                            str(row.get("procedureText", "")),
                        )
                        record = ProcedureRecord(
                            unidade=unit_name,
                            cliente=client.name,
                            cliente_id=client_id,
                            pagina_lista=page_number,
                            data=data,
                            horario=horario,
                            procedimento_grupo=grupo,
                            procedimento=procedimento,
                            status=_normalize_spaces(str(row.get("statusText", ""))),
                            url_cliente=client_url,
                        )
                        all_records.append(record)
                        unit_summary["procedures_exported"] += 1
                        summary["totals"]["procedures_exported"] += 1
                except Exception as exc:
                    error_message = str(exc)
                    log(
                        "ERROR: Procedures: failed client "
                        f"{client.name} ({client_id or 'sem_id'}) on unit {unit_name}, page {page_number}, "
                        f"stage {current_stage}: {error_message}"
                    )
                    _record_client_error(
                        summary,
                        unit_summary,
                        unidade=unit_name,
                        cliente=client.name,
                        cliente_id=client_id,
                        pagina_lista=page_number,
                        etapa=current_stage,
                        erro=error_message,
                        url_cliente=client_url,
                    )
                    capture_artifacts(
                        driver,
                        output_dir=debug_dir,
                        label=(
                            f"procedures_client_error_{_slugify(unit_name)}_{page_number:03d}_"
                            f"{_slugify(client.name)}"
                        ),
                    )
                finally:
                    if DETAIL_URL_FRAGMENT in (driver.current_url or ""):
                        try:
                            _go_back_to_clients(driver, timeout_seconds=timeout_seconds)
                            time.sleep(0.5)
                        except Exception as exc:
                            raise RuntimeError(
                                f"could not recover clients list after client {client.name!r}: {exc}"
                            ) from exc

            _flush_checkpoint(output_dir, all_records, summary)

            if client_limit is not None and unit_summary["clients_processed"] >= client_limit:
                break

            if not _click_next_page(driver, previous_signature=page_signature, timeout_seconds=timeout_seconds):
                break
            page_number += 1
            time.sleep(1)

        summary["totals"]["units_processed"] += 1
        _flush_checkpoint(output_dir, all_records, summary)

    outputs = write_outputs(output_dir, all_records, summary)
    summary["outputs"] = outputs
    return all_records, summary


def run_with_runtime(
    *,
    base_url: str,
    creds: Credentials,
    output_dir: Path,
    debug_dir: Path,
    headless: bool,
    user_data_dir: Path | None,
    timeout_seconds: int,
) -> tuple[list[ProcedureRecord], dict[str, Any]]:
    from .core import create_driver

    unit_names = resolve_units()
    driver = create_driver(headless=headless, user_data_dir=user_data_dir)
    try:
        return run_client_procedures_export(
            driver,
            base_url=base_url,
            creds=creds,
            unit_names=unit_names,
            output_dir=output_dir,
            debug_dir=debug_dir,
            timeout_seconds=timeout_seconds,
        )
    except Exception:
        capture_artifacts(driver, output_dir=debug_dir, label="error_procedures_export")
        raise
    finally:
        try:
            driver.quit()
        except Exception:
            pass
