#!/usr/bin/env python3
"""Compatibility entrypoint for appointment scraping.

This file is kept for backward compatibility. The actual implementation lives in
the unified module under `espacofacial/`.
"""

import os
import sys
import csv
import json
import time
import email.utils
import urllib.request
import urllib.error
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable

from selenium.webdriver.common.by import By

from espacofacial.auth import (
    Credentials,
    configure_file_logging,
    log,
    log_exception,
    login_and_select_unit,
)
from espacofacial.appointments import (
    build_event_signature,
    navigate_to_reception,
    save,
    save_index,
    scrape_complete,
    scrape_index,
)
from espacofacial.core import create_driver, load_config
from espacofacial.diagnostics import capture_artifacts


INDEX_PREFIX = "agendamentos_espacofacial_index"
DELTA_PREFIX = "agendamentos_espacofacial_delta"
FULL_PREFIX = "agendamentos_espacofacial_completo"


def _signature_mode_is_dt(mode: str) -> bool:
    return mode in {"dt", "date_time", "date-time"}


def _env_truthy(name: str) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return False
    return raw.strip().lower() in {"1", "true", "yes", "y", "sim", "s"}


def _parse_ddmmyyyy(value: str) -> date | None:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%d/%m/%Y").date()
    except Exception:
        return None


def _filter_remaining_month(rows: list[dict[str, str]], *, today: date) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for row in rows:
        d = _parse_ddmmyyyy(row.get("Data", ""))
        if d is None:
            continue
        if d.year != today.year or d.month != today.month:
            continue
        if d < today:
            continue
        out.append(row)
    return out


def _filter_date_window(rows: list[dict[str, str]], *, start_date: date, end_date: date) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for row in rows:
        d = _parse_ddmmyyyy(row.get("Data", ""))
        if d is None:
            continue
        if d < start_date or d > end_date:
            continue
        out.append(row)
    return out


def _resolve_date_filter(today: date) -> tuple[Callable[[list[dict[str, str]]], list[dict[str, str]]] | None, str | None]:
    future_days_raw = os.getenv("EF_INDEX_FUTURE_DAYS", "").strip()
    if future_days_raw:
        try:
            future_days = int(future_days_raw)
        except ValueError:
            future_days = 0
        if future_days > 0:
            end_date = today + timedelta(days=future_days - 1)
            return (
                lambda rows: _filter_date_window(rows, start_date=today, end_date=end_date),
                f"rolling {future_days} days",
            )

    if _env_truthy("EF_INDEX_REMAINING_MONTH"):
        return (
            lambda rows: _filter_remaining_month(rows, today=today),
            "remaining month",
        )

    return None, None


def _count_signatures(rows: list[dict[str, str]]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for row in rows:
        signature = (row.get("Assinatura") or "").strip()
        if signature:
            counts[signature] += 1
    return counts


def _signature_from_row(row: dict[str, str], *, signature_mode: str) -> str:
    date_text = (row.get("Data") or "").strip()
    time_text = (row.get("Horário") or "").strip()
    title_text = (row.get("Título") or "").strip()
    return build_event_signature(date_text, time_text, title_text, mode=signature_mode)


def _group_rows_by_signature(
    rows: list[dict[str, str]], *, signature_mode: str
) -> dict[str, list[dict[str, str]]]:
    grouped: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        sig = _signature_from_row(row, signature_mode=signature_mode)
        if not sig:
            continue
        grouped.setdefault(sig, []).append(row)
    return grouped


def _pull_rows(grouped: dict[str, list[dict[str, str]]], sig: str, count: int) -> list[dict[str, str]]:
    rows = grouped.get(sig, [])
    out: list[dict[str, str]] = []
    idx = 0
    while len(out) < count:
        if idx < len(rows):
            out.append(rows[idx])
        else:
            out.append({})
        idx += 1
    return out


def _write_changes_report(
    *,
    output_dir: Path,
    signature_mode: str,
    added: Counter[str],
    removed: Counter[str],
    rows_delta: list[dict[str, str]],
    old_full_rows: list[dict[str, str]],
) -> tuple[Path, Path]:
    report_rows: list[dict[str, str]] = []

    delta_group = _group_rows_by_signature(rows_delta, signature_mode=signature_mode)
    old_group = _group_rows_by_signature(old_full_rows, signature_mode=signature_mode)

    for sig, count in added.items():
        for r in _pull_rows(delta_group, sig, count):
            report_rows.append(
                {
                    "Mudança": "ADICIONADO",
                    "Data": r.get("Data", ""),
                    "Horário": r.get("Horário", ""),
                    "Duração Min": r.get("Duração Min", ""),
                    "Cliente": r.get("Cliente", ""),
                    "Tipo de Agendamento": r.get("Tipo de Agendamento", ""),
                    "Profissional": r.get("Profissional", ""),
                }
            )

    for sig, count in removed.items():
        for r in _pull_rows(old_group, sig, count):
            report_rows.append(
                {
                    "Mudança": "REMOVIDO",
                    "Data": r.get("Data", ""),
                    "Horário": r.get("Horário", ""),
                    "Duração Min": r.get("Duração Min", ""),
                    "Cliente": r.get("Cliente", ""),
                    "Tipo de Agendamento": r.get("Tipo de Agendamento", ""),
                    "Profissional": r.get("Profissional", ""),
                }
            )

    csv_path = output_dir / "agendamentos_espacofacial_mudancas.csv"
    json_path = output_dir / "agendamentos_espacofacial_mudancas.json"

    with csv_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=["Mudança", "Data", "Horário", "Duração Min", "Cliente", "Tipo de Agendamento", "Profissional"],
        )
        writer.writeheader()
        writer.writerows(report_rows)

    summary = {
        "added": int(sum(added.values())),
        "removed": int(sum(removed.values())),
    }
    with json_path.open("w", encoding="utf-8") as fh:
        json.dump({"summary": summary, "rows": report_rows}, fh, ensure_ascii=False, indent=2)

    return csv_path, json_path


def _post_agenda_sync(
    *,
    unit_name: str,
    changes_json_path: Path,
    endpoint: str,
    token: str,
) -> bool:
    if not changes_json_path.exists():
        return False
    payload = {
        "unit": unit_name,
        "runId": datetime.now().strftime("%Y%m%d_%H%M%S"),
    }
    try:
        data = json.loads(changes_json_path.read_text(encoding="utf-8"))
        rows = data.get("rows") if isinstance(data, dict) else None
        if not isinstance(rows, list):
            rows = []
        added: list[dict[str, str]] = []
        removed: list[dict[str, str]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            change = (row.get("Mudança") or row.get("Mudanca") or "").strip().upper()
            item = {
                "data": row.get("Data", ""),
                "horario": row.get("Horário", "") or row.get("Horario", ""),
                "duration_min": row.get("Duração Min", "") or row.get("Duracao Min", ""),
                "cliente": row.get("Cliente", ""),
                "tipo": row.get("Tipo de Agendamento", ""),
                "profissional": row.get("Profissional", ""),
            }
            if change == "ADICIONADO":
                added.append(item)
            elif change == "REMOVIDO":
                removed.append(item)
    except Exception:
        return False

    payload["added"] = added
    payload["removed"] = removed
    return _post_agenda_sync_payload(payload=payload, endpoint=endpoint, token=token)


def _post_agenda_sync_payload(*, payload: dict[str, object], endpoint: str, token: str) -> bool:
    if not endpoint:
        return False

    def _retry_after_seconds(err: urllib.error.HTTPError) -> int | None:
        header = ""
        try:
            header = (err.headers.get("Retry-After") or "").strip()
        except Exception:
            header = ""
        if not header:
            return None
        if header.isdigit():
            return max(int(header), 0)
        try:
            dt = email.utils.parsedate_to_datetime(header)
            if dt is None:
                return None
            return max(int((dt - datetime.now(dt.tzinfo)).total_seconds()), 0)
        except Exception:
            return None

    def _is_retryable_status(status: int) -> bool:
        return status == 429 or status >= 500

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    timeout = int(os.getenv("EF_AGENDA_SYNC_TIMEOUT", "45"))
    attempts = int(os.getenv("EF_AGENDA_SYNC_ATTEMPTS", "3"))
    delay = float(os.getenv("EF_AGENDA_SYNC_RETRY_DELAY", "2"))
    max_delay = float(os.getenv("EF_AGENDA_SYNC_MAX_RETRY_DELAY", "30"))
    last_error = None

    for attempt in range(1, max(attempts, 1) + 1):
        headers = {
            "content-type": "application/json",
            "user-agent": "agenda-sync/1.0",
        }
        if token:
            headers["authorization"] = f"Bearer {token}"
        req = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return 200 <= resp.status < 300
        except urllib.error.HTTPError as e:
            response_excerpt = ""
            try:
                response_excerpt = e.read(256).decode("utf-8", errors="replace").strip()
            except Exception:
                response_excerpt = ""
            last_error = f"HTTP {e.code}"
            if response_excerpt:
                last_error = f"{last_error} body={response_excerpt}"
            if not _is_retryable_status(e.code):
                if e.code in {401, 403}:
                    log(
                        f"ERROR: agenda sync HTTP {e.code} (unauthorized/forbidden). "
                        "Validate EF_AGENDA_SYNC_TOKEN."
                    )
                else:
                    log(f"ERROR: agenda sync HTTP {e.code} (non-retryable client error)")
                return False
            retry_after = _retry_after_seconds(e)
            if retry_after is not None:
                delay = min(max(delay, float(retry_after)), max_delay)
        except Exception as e:
            last_error = str(e)

        if attempt < attempts:
            log(f"WARNING: agenda sync attempt {attempt} failed ({last_error}); retrying in {delay:.0f}s")
            time.sleep(delay)
            delay = min(max(delay * 2, delay), max_delay)

    log(f"ERROR: agenda sync failed: {last_error}")
    return False


def _post_agenda_full_sync(
    *,
    unit_name: str,
    rows: list[dict[str, str]],
    endpoint: str,
    token: str,
) -> bool:
    added: list[dict[str, str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        added.append(
            {
                "data": row.get("Data", ""),
                "horario": row.get("Horário", "") or row.get("Horario", ""),
                "duration_min": row.get("Duração Min", "") or row.get("Duracao Min", ""),
                "cliente": row.get("Cliente", ""),
                "tipo": row.get("Tipo de Agendamento", ""),
                "profissional": row.get("Profissional", ""),
                "telefone": row.get("Telefone", ""),
                "cpf": row.get("CPF", ""),
                "servico": row.get("Serviço a realizar", "") or row.get("Servico a realizar", ""),
                "observacoes": row.get("Observações", "") or row.get("Observacoes", ""),
                "status": row.get("Status", ""),
                "source": "scraper_full",
            }
        )

    payload: dict[str, object] = {
        "unit": unit_name,
        "runId": datetime.now().strftime("%Y%m%d_%H%M%S"),
        "schema_version": 1,
        "added": added,
        "removed": [],
    }
    return _post_agenda_sync_payload(payload=payload, endpoint=endpoint, token=token)


def _load_index_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    rows: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            rows.append(row)
    return rows


def _load_index_signatures(rows: list[dict[str, str]], *, signature_mode: str) -> Counter[str]:
    counts: Counter[str] = Counter()
    for row in rows:
        date_text = (row.get("Data") or "").strip()
        time_text = (row.get("Horário") or "").strip()
        title_text = (row.get("Título") or "").strip()
        signature = build_event_signature(date_text, time_text, title_text, mode=signature_mode)
        if signature:
            counts[signature] += 1
    return counts


def _looks_like_login_page(driver) -> bool:
    try:
        url = (driver.current_url or "").lower()
        if "/login" in url or "/forgot_password" in url:
            return True
    except Exception:
        pass

    try:
        email_inputs = driver.find_elements(By.XPATH, '//input[@type="email"]')
        password_inputs = driver.find_elements(By.XPATH, '//input[@type="password"]')
        login_buttons = driver.find_elements(By.XPATH, '//button[contains(., "Acessar conta")]')

        has_email = any(el.is_displayed() for el in email_inputs)
        has_password = any(el.is_displayed() for el in password_inputs)
        has_login_button = any(el.is_displayed() for el in login_buttons)
        return (has_email and has_password) or (has_email and has_login_button)
    except Exception:
        return False


def _recover_reception_session(driver, *, cfg, creds: Credentials) -> bool:
    if _looks_like_login_page(driver):
        log("Session appears unauthenticated; retrying login...")
        if not login_and_select_unit(
            driver,
            base_url=cfg.base_url,
            creds=creds,
            unit_name=cfg.unit_name,
            timeout_seconds=cfg.timeout_seconds,
        ):
            return False

    if navigate_to_reception(driver, cfg.reception_url, timeout_seconds=cfg.timeout_seconds):
        return True

    log("WARNING: Could not restore reception directly; retrying full re-login flow...")
    if not login_and_select_unit(
        driver,
        base_url=cfg.base_url,
        creds=creds,
        unit_name=cfg.unit_name,
        timeout_seconds=cfg.timeout_seconds,
    ):
        return False
    return navigate_to_reception(driver, cfg.reception_url, timeout_seconds=cfg.timeout_seconds)


def _run_with_scrape_retries(op_name: str, op, *, driver, cfg, creds: Credentials):
    attempts = max(int(os.getenv("EF_AGENDA_SCRAPE_ATTEMPTS", "3")), 1)
    delay = max(float(os.getenv("EF_AGENDA_SCRAPE_RETRY_DELAY", "2")), 0.0)
    last_error = None

    for attempt in range(1, attempts + 1):
        try:
            return op()
        except Exception as e:
            last_error = e
            if attempt >= attempts:
                break
            err = f"{type(e).__name__}: {e}".strip()
            log(
                f"WARNING: {op_name} attempt {attempt}/{attempts} failed ({err}); "
                "recovering session before retry..."
            )
            if not _recover_reception_session(driver, cfg=cfg, creds=creds):
                log("WARNING: session recovery failed; retrying operation anyway.")
            if delay > 0:
                log(f"Retrying {op_name} in {delay:.0f}s...")
                time.sleep(delay)
                delay = max(delay * 2, delay)

    if last_error is not None:
        raise last_error
    raise RuntimeError(f"{op_name} failed without a captured exception")


def main(mode: str = "full") -> bool:
    cfg = load_config()
    mode_norm = (mode or "full").strip().lower()
    if mode_norm in {"complete", "full", "agenda", "agendamentos", "appointments"}:
        mode_norm = "full"
    elif mode_norm in {"agenda_index", "index_agenda"}:
        mode_norm = "index"
    elif mode_norm in {"agenda_delta", "delta_agenda"}:
        mode_norm = "delta"
    if mode_norm not in {"full", "index", "delta"}:
        log(f"NOTE: Mode '{mode_norm}' not recognized. Falling back to full extraction.")
        mode_norm = "full"

    configure_file_logging(cfg.output_dir, prefix=f"appointments_{mode_norm}")

    log("Starting Espaço Facial Appointment Scraper")
    log(f"Target: {cfg.base_url}")
    log(f"Headless: {'yes' if cfg.headless else 'no'}")
    log(f"Output dir: {cfg.output_dir}")
    if mode_norm == "full":
        log("Mode: complete")
    else:
        log(f"Mode: {mode_norm}")

    if not cfg.email or not cfg.password:
        log("ERROR: Missing credentials. Set EF_LOGIN_EMAIL and EF_LOGIN_PASSWORD and try again.")
        return False

    driver = None
    try:
        driver = create_driver(headless=cfg.headless, user_data_dir=cfg.chrome_user_data_dir)
        creds = Credentials(cfg.email, cfg.password)
        if not login_and_select_unit(
            driver,
            base_url=cfg.base_url,
            creds=creds,
            unit_name=cfg.unit_name,
            timeout_seconds=cfg.timeout_seconds,
        ):
            return False
        if not navigate_to_reception(driver, cfg.reception_url, timeout_seconds=cfg.timeout_seconds):
            return False

        signature_mode = os.getenv("EF_INDEX_SIGNATURE_MODE", "dt").strip().lower()
        include_title = not _signature_mode_is_dt(signature_mode)
        dry_run = os.getenv("EF_DRY_RUN", "").strip().lower() in {"1", "true", "yes", "y", "sim"}
        today = datetime.now().date()
        date_filter, date_filter_label = _resolve_date_filter(today)

        if mode_norm == "index":
            rows_index = _run_with_scrape_retries(
                "scrape_index",
                lambda: scrape_index(driver, signature_mode=signature_mode),
                driver=driver,
                cfg=cfg,
                creds=creds,
            )
            if date_filter is not None:
                before = len(rows_index)
                rows_index = date_filter(rows_index)
                log(f"Index filter ({date_filter_label}): {before} -> {len(rows_index)}")
            if dry_run:
                log("DRY-RUN: skipping export files")
                log(f"DRY-RUN: extracted rows = {len(rows_index)}")
                return True
            csv_path, xlsx_path = save_index(
                rows_index,
                output_dir=cfg.output_dir,
                prefix=INDEX_PREFIX,
                include_title=include_title,
            )
            log(f"✓ Saved CSV: {csv_path}")
            log(f"✓ Saved Excel: {xlsx_path}")
            return True

        if mode_norm == "delta":
            index_csv = cfg.output_dir / f"{INDEX_PREFIX}.csv"

            rows_index = _run_with_scrape_retries(
                "scrape_index",
                lambda: scrape_index(driver, signature_mode=signature_mode),
                driver=driver,
                cfg=cfg,
                creds=creds,
            )
            if date_filter is not None:
                before = len(rows_index)
                rows_index = date_filter(rows_index)
                log(f"Index filter ({date_filter_label}): {before} -> {len(rows_index)}")
            new_counts = _count_signatures(rows_index)
            old_rows = _load_index_rows(index_csv)
            if date_filter is not None:
                old_rows = date_filter(old_rows)
            old_counts = _load_index_signatures(old_rows, signature_mode=signature_mode)

            added = new_counts - old_counts
            removed = old_counts - new_counts
            added_total = sum(added.values())
            removed_total = sum(removed.values())
            log(f"Index diff: added={added_total}, removed={removed_total}")

            if dry_run:
                log("DRY-RUN: skipping export files")
                log(f"DRY-RUN: extracted rows = {len(rows_index)}")
                return True

            save_index(
                rows_index,
                output_dir=cfg.output_dir,
                prefix=INDEX_PREFIX,
                include_title=include_title,
            )

            if added_total == 0 and removed_total == 0:
                log("No changes detected; skipping full export.")
                return True

            rows_delta: list[dict[str, str]] = []
            if added_total > 0:
                rows_delta = _run_with_scrape_retries(
                    "scrape_complete(delta)",
                    lambda: scrape_complete(
                        driver,
                        target_signatures=Counter(added),
                        signature_mode=signature_mode,
                    ),
                    driver=driver,
                    cfg=cfg,
                    creds=creds,
                )
                if not rows_delta:
                    log("ERROR: No matching appointments extracted for delta export.")
                    return False

                csv_path, xlsx_path = save(rows_delta, output_dir=cfg.output_dir, prefix=DELTA_PREFIX)
                log(f"✓ Saved CSV: {csv_path}")
                log(f"✓ Saved Excel: {xlsx_path}")
            else:
                log("Only removals detected; skipping delta export.")

            old_full_csv = cfg.output_dir / f"{FULL_PREFIX}.csv"
            old_full_rows: list[dict[str, str]] = []
            if old_full_csv.exists():
                old_full_rows = _load_index_rows(old_full_csv)

            changes_csv, changes_json = _write_changes_report(
                output_dir=cfg.output_dir,
                signature_mode=signature_mode,
                added=added,
                removed=removed,
                rows_delta=rows_delta,
                old_full_rows=old_full_rows,
            )
            log(f"✓ Saved changes CSV: {changes_csv}")
            log(f"✓ Saved changes JSON: {changes_json}")
            endpoint = os.getenv("EF_AGENDA_SYNC_URL", "").strip()
            token = os.getenv("EF_AGENDA_SYNC_TOKEN", "").strip()
            if endpoint:
                if _post_agenda_sync(
                    unit_name=cfg.unit_name,
                    changes_json_path=changes_json,
                    endpoint=endpoint,
                    token=token,
                ):
                    log("✓ Agenda sync posted")
                else:
                    log("WARNING: agenda sync failed")
            return True

        rows = _run_with_scrape_retries(
            "scrape_complete(full)",
            lambda: scrape_complete(driver),
            driver=driver,
            cfg=cfg,
            creds=creds,
        )
        if not rows:
            log("ERROR: No appointments extracted")
            return False

        if date_filter is not None:
            before = len(rows)
            rows = date_filter(rows)
            log(f"Full filter ({date_filter_label}): {before} -> {len(rows)}")
        if not rows:
            log("ERROR: No appointments extracted after date filter")
            return False

        if dry_run:
            log("DRY-RUN: skipping export files")
            log(f"DRY-RUN: extracted rows = {len(rows)}")
            return True

        csv_path, xlsx_path = save(rows, output_dir=cfg.output_dir, prefix=FULL_PREFIX)
        log(f"✓ Saved CSV: {csv_path}")
        log(f"✓ Saved Excel: {xlsx_path}")
        endpoint = os.getenv("EF_AGENDA_SYNC_URL", "").strip()
        token = os.getenv("EF_AGENDA_SYNC_TOKEN", "").strip()
        if endpoint and _env_truthy("EF_AGENDA_SYNC_FULL"):
            if _post_agenda_full_sync(
                unit_name=cfg.unit_name,
                rows=rows,
                endpoint=endpoint,
                token=token,
            ):
                log("✓ Agenda full sync posted")
            else:
                log("WARNING: agenda full sync failed")
        return True
    except Exception as e:
        log_exception("ERROR: Unexpected failure", e)
        if cfg.debug_on_error and driver is not None:
            artifacts = capture_artifacts(driver, output_dir=cfg.debug_dir, label=f"error_{mode}")
            if artifacts.html_path:
                log(f"Saved debug HTML: {artifacts.html_path}")
            if artifacts.screenshot_path:
                log(f"Saved debug screenshot: {artifacts.screenshot_path}")
        return False
    finally:
        try:
            if driver is not None:
                driver.quit()
        except Exception:
            pass


if __name__ == "__main__":
    success = main(mode=os.getenv("EF_MODE", "full"))
    sys.exit(0 if success else 1)
