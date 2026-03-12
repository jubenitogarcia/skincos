from __future__ import annotations

import re
import unicodedata
import time
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from collections import Counter

import pandas as pd

from .dataframe_tools import (
    append_total_row,
    replace_zero_with_dash,
    sort_by_date_time,
    trim_empty_rows_cols,
)
from .excel import format_workbook
from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from .auth import log, log_exception, log_file_only


def _ensure_monthly_view(driver: WebDriver) -> None:
    """Best-effort: switch FullCalendar to Month/Mês view if the control exists."""

    month_button_xpaths = [
        '//button[contains(normalize-space(.), "Mês")]',
        '//button[contains(normalize-space(.), "Month")]',
        '//button[@aria-label="Month view"]',
    ]

    for xpath in month_button_xpaths:
        try:
            buttons = driver.find_elements(By.XPATH, xpath)
            if not buttons:
                continue
            button = buttons[0]
            cls = (button.get_attribute("class") or "").lower()
            aria_pressed = (button.get_attribute("aria-pressed") or "").lower()
            if "active" in cls or aria_pressed == "true":
                return
            log("Switching to monthly view...")
            driver.execute_script("arguments[0].click();", button)
            time.sleep(2)
            return
        except Exception:
            continue


@dataclass(frozen=True)
class Appointment:
    cliente: str
    profissional: str
    tipo: str
    horario: str
    telefone: str = ""
    observacoes: str = ""


def _find_events(driver: WebDriver) -> tuple[str, list]:
    """Return (xpath_used, elements) using the most specific selector that matches."""

    xpaths = [
        # Most stable in FullCalendar month grid.
        '//div[contains(@class, "fc-daygrid-event-harness")]//a[contains(@class, "fc-event")]',
        # Generic anchors.
        '//a[contains(@class, "fc-event") and .//*[contains(@class, "fc-event-title")]]',
        # Generic divs.
        '//div[contains(@class, "fc-event") and .//*[contains(@class, "fc-event-title")]]',
    ]
    for xp in xpaths:
        try:
            els = driver.find_elements(By.XPATH, xp)
            if els:
                return xp, els
        except Exception:
            continue
    return xpaths[-1], []


def _extract_event_date(driver: WebDriver, event) -> str:
    """Try to infer the event date from FullCalendar DOM (returns DD/MM/YYYY or '')."""

    try:
        iso = driver.execute_script(
            r"""
            const el = arguments[0];
            if (!el) return '';
            const cell = el.closest('[data-date]');
            if (cell && cell.getAttribute) return cell.getAttribute('data-date') || '';
            // Some views store date on an ancestor td.
            let cur = el;
            for (let i=0; i<8 && cur; i++) {
              if (cur.getAttribute && cur.getAttribute('data-date')) return cur.getAttribute('data-date');
              cur = cur.parentElement;
            }
            return '';
            """,
            event,
        )
        iso = (iso or "").strip()
        if not iso:
            return ""
        dt = datetime.strptime(iso, "%Y-%m-%d")
        return dt.strftime("%d/%m/%Y")
    except Exception:
        return ""


def _is_truthy_env(name: str) -> bool:
    return (os.getenv(name, "").strip().lower()) in {"1", "true", "yes", "on", "y", "sim", "s"}


def _calendar_visible_date_bounds(driver: WebDriver) -> tuple[str, str, bool]:
    try:
        bounds = driver.execute_script(
            """
            const root =
              document.querySelector('.fc-view-harness .fc-view') ||
              document.querySelector('.fc-view-harness') ||
              document;
            const nodes = Array.from(
              root.querySelectorAll(
                '.fc-col-header-cell[data-date], .fc-timegrid-col[data-date], .fc-daygrid-day[data-date]'
              )
            );
            const visibleNodes = nodes.filter((el) => {
              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              if (el.offsetParent !== null) return true;
              return style.position === 'fixed';
            });
            const source = visibleNodes.length ? visibleNodes : nodes;
            const dates = source
              .map((el) => (el.getAttribute('data-date') || '').trim())
              .filter((v) => /^\\d{4}-\\d{2}-\\d{2}$/.test(v))
              .sort();
            if (!dates.length) return { min: '', max: '', has: false };
            return { min: dates[0], max: dates[dates.length - 1], has: true };
            """
        ) or {"min": "", "max": "", "has": False}
        return (
            str(bounds.get("min") or "").strip(),
            str(bounds.get("max") or "").strip(),
            bool(bounds.get("has")),
        )
    except Exception:
        return "", "", False


def _click_calendar_nav(driver: WebDriver, direction: str) -> bool:
    selector = ".fc-next-button" if direction == "next" else ".fc-prev-button"
    try:
        clicked = driver.execute_script(
            """
            const selector = arguments[0];
            const button = document.querySelector(selector);
            if (!button) return false;
            button.click();
            return true;
            """,
            selector,
        )
        return bool(clicked)
    except Exception:
        return False


def _wait_for_calendar_bounds_change(driver: WebDriver, *, before_min: str, before_max: str, timeout_seconds: float = 5.0) -> None:
    deadline = time.time() + max(timeout_seconds, 0.5)
    while time.time() < deadline:
        cur_min, cur_max, has_dates = _calendar_visible_date_bounds(driver)
        if has_dates and (cur_min != before_min or cur_max != before_max):
            break
        time.sleep(0.2)


def _start_of_week(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _last_day_of_month(day: date) -> date:
    pivot = day.replace(day=28) + timedelta(days=4)
    return pivot.replace(day=1) - timedelta(days=1)


def _resolve_collection_window(today: date) -> tuple[date, date] | None:
    week_window_raw = os.getenv("EF_INDEX_WEEK_WINDOW_WEEKS", "").strip()
    if week_window_raw:
        try:
            week_window = int(week_window_raw)
        except ValueError:
            week_window = 0
        if week_window > 0:
            start_date = _start_of_week(today)
            end_date = start_date + timedelta(days=week_window * 7 - 1)
            return start_date, end_date

    future_days_raw = os.getenv("EF_INDEX_FUTURE_DAYS", "").strip()
    if future_days_raw:
        try:
            future_days = int(future_days_raw)
        except ValueError:
            future_days = 0
        if future_days > 0:
            start_date = today
            end_date = today + timedelta(days=future_days - 1)
            return start_date, end_date

    if _is_truthy_env("EF_INDEX_REMAINING_MONTH"):
        return today, _last_day_of_month(today)

    return None


def _collect_across_calendar_window(driver: WebDriver, collect_current_view) -> list[dict[str, str]]:
    today = datetime.now().date()
    window = _resolve_collection_window(today)
    if window is None:
        return collect_current_view()

    start_date, end_date = window
    start_iso = start_date.strftime("%Y-%m-%d")
    end_iso = end_date.strftime("%Y-%m-%d")
    max_pages = max(int(os.getenv("EF_CALENDAR_MAX_PAGES", "12")), 1)
    log(f"Calendar collection window: {start_iso} -> {end_iso} (max_pages={max_pages})")

    # Align calendar near the start date of the requested window.
    for _ in range(max_pages):
        min_date, max_date, has_dates = _calendar_visible_date_bounds(driver)
        if not has_dates:
            log("Calendar bounds unavailable during alignment; collecting current view only.")
            break
        if min_date <= start_iso <= max_date:
            break
        direction = "next" if start_iso > max_date else "prev"
        if not _click_calendar_nav(driver, direction):
            log(f"Calendar nav '{direction}' unavailable during alignment.")
            break
        _wait_for_calendar_bounds_change(driver, before_min=min_date, before_max=max_date)

    rows: list[dict[str, str]] = []
    visited_bounds: set[tuple[str, str]] = set()
    for _ in range(max_pages):
        min_date, max_date, has_dates = _calendar_visible_date_bounds(driver)
        if has_dates:
            bounds = (min_date, max_date)
            if bounds in visited_bounds:
                log(f"Calendar bounds repeated ({min_date}..{max_date}); stopping pagination.")
                break
            visited_bounds.add(bounds)
            log(f"Collecting calendar page with bounds {min_date}..{max_date}")
        else:
            log("Collecting calendar page without visible bounds")

        rows.extend(collect_current_view())

        if has_dates and max_date >= end_iso:
            log(f"Reached window end at {max_date}; stopping pagination.")
            break
        if not _click_calendar_nav(driver, "next"):
            log("Calendar nav 'next' unavailable; stopping pagination.")
            break
        _wait_for_calendar_bounds_change(driver, before_min=min_date, before_max=max_date)

    return rows


def navigate_to_reception(driver: WebDriver, reception_url: str, *, timeout_seconds: int = 20) -> bool:
    log("Navigating to reception...")
    driver.get(reception_url)
    time.sleep(3)

    try:
        WebDriverWait(driver, timeout_seconds).until(
            EC.presence_of_element_located((By.XPATH, '//*[contains(@class, "fc-")]'))
        )
        _ensure_monthly_view(driver)
        log("✓ Reception loaded")
        return True
    except Exception as e:
        log(f"ERROR: Could not load reception: {e}")
        return False


def _extract_event_info(title_text: str, time_text: str) -> dict[str, str]:
    parts = [p.strip() for p in title_text.split(" - ")]
    appointment_type_keys = {
        "avaliacao",
        "compra antecipada",
        "procedimento",
        "revisao",
        "retorno",
        "consulta",
    }

    def _normalize_key(value: str) -> str:
        raw = (value or "").strip().lower()
        if not raw:
            return ""
        no_accents = "".join(ch for ch in unicodedata.normalize("NFD", raw) if unicodedata.category(ch) != "Mn")
        return re.sub(r"\s+", " ", no_accents).strip()

    def _is_appointment_type(value: str) -> bool:
        return _normalize_key(value) in appointment_type_keys

    cliente = parts[0] if len(parts) > 0 else ""
    tipo = ""
    profissional = ""

    if len(parts) == 2:
        second = parts[1]
        if _is_appointment_type(second):
            tipo = second
        else:
            profissional = second
    elif len(parts) >= 3:
        second = parts[1]
        third = parts[2]
        second_is_type = _is_appointment_type(second)
        third_is_type = _is_appointment_type(third)
        if second_is_type and not third_is_type:
            tipo = second
            profissional = third
        elif third_is_type and not second_is_type:
            tipo = third
            profissional = second
        else:
            tipo = second
            profissional = third

    return {
        "Cliente": cliente,
        "Tipo de Agendamento": tipo,
        "Profissional": profissional,
        "Horário": time_text.strip(),
    }


def parse_duration_minutes_from_time_text(time_text: str) -> int | None:
    text = (time_text or "").strip()
    if not text:
        return None

    matches = re.findall(r"\b(\d{1,2}:\d{2})\b", text)
    if len(matches) < 2:
        return None

    try:
        start = datetime.strptime(matches[0], "%H:%M")
        end = datetime.strptime(matches[1], "%H:%M")
    except ValueError:
        return None

    delta_minutes = int((end - start).total_seconds() // 60)
    if delta_minutes <= 0 or delta_minutes > 24 * 60:
        return None
    return delta_minutes


def _safe_outer_html(element) -> str:
    try:
        html = element.get_attribute("outerHTML") or ""
    except Exception:
        return ""
    html = re.sub(r"\s+", " ", html).strip()
    if len(html) > 2000:
        return html[:2000] + "..."
    return html


def scrape_basic(driver: WebDriver) -> list[dict[str, str]]:
    """Basic scrape without modal clicks (recommended)."""
    log("Scraping appointments (basic)...")

    event_xpath = '//div[contains(@class, "fc-event") and .//*[contains(@class, "fc-event-title")]]'
    WebDriverWait(driver, 20).until(EC.presence_of_all_elements_located((By.XPATH, event_xpath)))
    events = driver.find_elements(By.XPATH, event_xpath)
    log(f"Found {len(events)} events")

    rows: list[dict[str, str]] = []
    missing_time_count = 0
    error_count = 0
    for i, event in enumerate(events, start=1):
        try:
            title_elem = event.find_element(By.XPATH, './/*[contains(@class, "fc-event-title")]')
            time_text = ""
            try:
                time_elem = event.find_element(By.XPATH, './/*[contains(@class, "fc-event-time")]')
                time_text = (time_elem.text or "").strip()
            except NoSuchElementException:
                missing_time_count += 1
                # Some events use a different layout (no explicit time element).
                # Keep the row and log details for debugging.
                log_file_only(
                    "WARNING event %s: missing fc-event-time. title=%r event_text=%r outerHTML=%s"
                    % (i, (title_elem.text or "").strip(), (event.text or "").strip(), _safe_outer_html(event))
                )

            rows.append(_extract_event_info((title_elem.text or "").strip(), time_text))
        except Exception as e:
            error_count += 1
            log_exception(f"ERROR event {i}", e)
            continue

    if missing_time_count:
        log(f"NOTE: {missing_time_count} events had no visible time; saved with empty 'Horário'.")
    if error_count:
        log(f"NOTE: {error_count} events failed to parse; see log file for details.")

    return rows


def _extract_phone(text: str) -> str:
    match = re.search(r"\(?([0-9]{2})\)?[\s-]*([0-9]{4,5})[-\s]*([0-9]{4})", text)
    if not match:
        return ""
    return f"({match.group(1)}) {match.group(2)}-{match.group(3)}"


def _extract_status(text: str) -> str:
    candidates = ["Confirmado", "Atendido", "Faltou", "Desmarcado", "A confirmar"]
    low = (text or "").lower()
    for c in candidates:
        if c.lower() in low:
            return c
    return ""


def _normalize_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def _normalize_signature_text(value: str) -> str:
    text = _normalize_spaces(value)
    text = "".join(
        ch
        for ch in unicodedata.normalize("NFD", text)
        if unicodedata.category(ch) != "Mn"
    )
    return text.lower()


def build_event_signature(
    date_text: str,
    time_text: str,
    title_text: str,
    *,
    mode: str = "dt_title",
) -> str:
    time_raw = (time_text or "").strip()
    match = re.search(r"\b(\d{1,2}:\d{2})\b", time_raw)
    if match:
        time_text = match.group(1)
    date_norm = _normalize_signature_text(date_text)
    time_norm = _normalize_signature_text(time_text)
    title_norm = _normalize_signature_text(title_text)
    if not date_norm and not time_norm and not title_norm:
        return ""
    if mode in {"dt", "date_time", "date-time"}:
        return f"{date_norm}||{time_norm}"
    return f"{date_norm}||{time_norm}||{title_norm}"


def _find_value_by_label_in_text(text: str, *, labels: list[str]) -> str:
    """Best-effort label/value extraction from modal text.

    Works for layouts where the label is on one line and the value is:
    - on the same line (with or without ":" / "-"), or
    - on the next line.
    """

    lines = [_normalize_spaces(l) for l in (text or "").split("\n")]
    lines = [l for l in lines if l]
    if not lines:
        return ""

    labels_low = [l.lower() for l in labels]
    ignore_values = {"n/a", "na", "não", "nao", "selecione o serviço", "selecione o servico"}
    for i, line in enumerate(lines):
        low = line.lower()
        for lab, lab_low in zip(labels, labels_low):
            if lab_low not in low:
                continue
            # Same-line value variants:
            # - "Label: value"
            # - "Label - value"
            # - "Label value"
            stripped = _normalize_spaces(
                re.sub(
                    rf"^\s*{re.escape(lab)}\s*[:\-]?\s*",
                    "",
                    line,
                    flags=re.IGNORECASE,
                )
            )
            if stripped and stripped.lower() not in ignore_values and stripped.lower() != low:
                return stripped

            if ":" in line:
                after = _normalize_spaces(line.split(":", 1)[1])
                if after and after.lower() not in ignore_values:
                    return after
            # Next line value.
            if i + 1 < len(lines):
                nxt = lines[i + 1]
                if nxt and nxt.lower() not in {lab_low, *ignore_values}:
                    return nxt
    return ""


def _looks_like_phone(value: str) -> bool:
    v = (value or "").strip()
    if not v:
        return False
    digits = re.sub(r"\D+", "", v)
    # Accept 10/11-digit BR numbers, but be flexible (e.g. missing DDD in some cases).
    return len(digits) >= 8


def _clean_placeholder(value: str) -> str:
    v = _normalize_spaces(value or "")
    if not v:
        return ""
    low = v.lower()
    # Common placeholders/headers that must never become data.
    if "selecione" in low:
        return ""
    if low in {"observações", "observacoes", "cpf do cliente", "whatsapp do cliente", "origem do cliente", "serviços", "servicos"}:
        return ""
    return v


def _find_field_container_by_label(modal, label: str):
    """Locate a field container by visible label inside the modal."""

    upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ"
    lower = "abcdefghijklmnopqrstuvwxyzàáâãäåçèéêëìíîïñòóôõöùúûüý"
    label_low = (label or "").strip().lower()
    if not label_low:
        return None

    xp = (
        './/*[self::h2 or self::p or self::label or self::span]'
        f'[contains(translate(normalize-space(.), "{upper}", "{lower}"), "{label_low}")]'
    )
    try:
        label_nodes = modal.find_elements(By.XPATH, xp)
    except Exception:
        return None

    if not label_nodes:
        return None

    control_probe = './/input | .//textarea | .//*[contains(@class, "multiselect")]'
    for el in label_nodes:
        candidate_paths = [
            ".",
            "./parent::div[1]",
            "./parent::div[1]/parent::div[1]",
            "./parent::div[1]/following-sibling::div[1]",
            "./parent::div[1]/following-sibling::div[.//input or .//textarea or .//*[contains(@class, 'multiselect')]][1]",
        ]
        for cpath in candidate_paths:
            try:
                container = el.find_element(By.XPATH, cpath)
            except Exception:
                continue
            try:
                if container.find_elements(By.XPATH, control_probe):
                    return container
            except Exception:
                continue

    # Last resort: return the first visible label node.
    return label_nodes[0]


def _extract_input_value_from_container(container) -> str:
    for xp in [
        './/input',
        './/textarea',
    ]:
        try:
            el = container.find_element(By.XPATH, xp)
            val = (el.get_attribute("value") or "").strip()
            if val:
                return val
        except Exception:
            continue

    # Some WW layouts render the label in a separate header element and place the input
    # in the next sibling container. Use a conservative "nearest following" fallback.
    for xp in [
        './following::input[1]',
        './following::textarea[1]',
    ]:
        try:
            el = container.find_element(By.XPATH, xp)
            val = (el.get_attribute("value") or "").strip()
            if val and val != "***":
                return val
        except Exception:
            continue
    return ""


def _extract_multiselect_value_from_container(container) -> str:
    # Vue multiselect often renders selected value here.
    xps = [
        './/*[contains(@class, "multiselect__single")]',
        './/*[contains(@class, "multiselect") and not(contains(@class,"multiselect__option"))]',
    ]
    for xp in xps:
        try:
            el = container.find_element(By.XPATH, xp)
            txt = _normalize_spaces(el.text or "")
            # Ignore placeholders.
            if txt and "selecione" not in txt.lower():
                return txt
        except Exception:
            continue
    return ""


def _extract_value_by_label(modal, *, labels: list[str], prefer_multiselect: bool = False, allow_input: bool = True) -> str:
    for label in labels:
        container = _find_field_container_by_label(modal, label)
        if container is None:
            continue
        candidates = []
        if prefer_multiselect:
            candidates.append(_extract_multiselect_value_from_container(container))
            if allow_input:
                candidates.append(_extract_input_value_from_container(container))
        else:
            if allow_input:
                candidates.append(_extract_input_value_from_container(container))
            candidates.append(_extract_multiselect_value_from_container(container))
        for candidate in candidates:
            cleaned = _clean_placeholder(candidate)
            if cleaned:
                return cleaned
    return ""


def _collapse_repeated_phrase(value: str) -> str:
    text = _normalize_spaces(value or "")
    if not text:
        return ""
    parts = text.split(" ")
    if len(parts) >= 2 and len(parts) % 2 == 0:
        half = len(parts) // 2
        if parts[:half] == parts[half:]:
            return " ".join(parts[:half])
    return text


def _looks_like_internal_id(value: str) -> bool:
    text = _normalize_spaces(value or "")
    return bool(re.fullmatch(r"\d{10,14}", text))


def _is_invalid_field_value(value: str, *, blocked_labels: list[str] | None = None) -> bool:
    text = _normalize_spaces(value or "")
    if not text:
        return True
    low = text.lower().strip(":")
    if blocked_labels:
        blocked = {b.lower().strip(":") for b in blocked_labels if b}
        for b in blocked:
            if low == b or low.startswith(f"{b} ") or low.startswith(f"{b}:") or low.startswith(f"{b}-"):
                return True
    if _looks_like_internal_id(text):
        return True
    return False


def _env_truthy(name: str) -> bool:
    return (os.getenv(name, "").strip().lower()) in {"1", "true", "yes", "on"}


def _truncate(text: str, *, limit: int = 1600) -> str:
    raw = (text or "").strip()
    if len(raw) <= limit:
        return raw
    return raw[:limit] + "..."


def _find_first_text(modal, *, xpaths: list[str]) -> str:
    for xp in xpaths:
        try:
            el = modal.find_element(By.XPATH, xp)
            txt = (el.text or "").strip()
            if txt:
                return txt
        except Exception:
            continue
    return ""


def _parse_date_time(dt_text: str) -> tuple[str, str]:
    """Return (date_ddmmyyyy, time_hhmm) from a 'Data e Hora' like string."""

    text = (dt_text or "").strip()
    if not text:
        return "", ""

    m_date = re.search(r"\b(\d{1,2}/\d{1,2}/\d{4})\b", text)
    m_time = re.search(r"\b(\d{1,2}:\d{2})\b", text)
    return (m_date.group(1) if m_date else "", m_time.group(1) if m_time else "")


def _try_modal_details(driver: WebDriver) -> dict[str, str]:
    details: dict[str, str] = {
        "Cliente": "",
        "Profissional": "",
        "Tipo de Agendamento": "",
        "Telefone": "",
        "CPF": "",
        "Por onde nos conheceu": "",
        "Serviço a realizar": "",
        "Observações": "",
        "Data": "",
        "Horário": "",
        "Status": "",
    }
    try:
        # The Espaço Facial UI uses WW "modal-dropzone" containers (not always role=dialog).
        # Keep locators simple to avoid slow DOM walks.
        modal_xpaths = [
            # Most specific: appointment modal content.
            '//div[contains(@class,"modal-dropzone") and .//*[contains(normalize-space(.), "Agendamento")]]',
            # Generic WW modal container.
            '//div[contains(@class,"modal-dropzone")]',
            # Generic dialog.
            '//div[@role="dialog" or contains(@class, "modal")]',
        ]

        modal = None
        for xp in modal_xpaths:
            try:
                modal = WebDriverWait(driver, 8, poll_frequency=0.2).until(
                    EC.presence_of_element_located((By.XPATH, xp))
                )
                if modal is not None:
                    break
            except Exception:
                continue
        if modal is None:
            return details

        time.sleep(0.5)
        text = modal.text or ""

        # --- Extra fields seen in Recorder (WW modal): Telefone(WhatsApp), CPF, Origem, Serviço ---
        details["Cliente"] = _extract_value_by_label(modal, labels=["Buscar cliente cadastrado"], prefer_multiselect=True, allow_input=False)
        if not details["Cliente"]:
            details["Cliente"] = _extract_value_by_label(
                modal,
                labels=["Nome do cliente", "Nome de cliente", "Cliente"],
                prefer_multiselect=False,
                allow_input=True,
            )
        details["Profissional"] = _extract_value_by_label(
            modal,
            labels=["Injetor", "Profissional"],
            prefer_multiselect=True,
            allow_input=True,
        )
        details["Tipo de Agendamento"] = _extract_value_by_label(
            modal,
            labels=["Tipo de Agendamento", "Tipo de agendamento", "Tipo do agendamento"],
            prefer_multiselect=True,
            allow_input=True,
        )
        if _is_invalid_field_value(
            details["Tipo de Agendamento"],
            blocked_labels=["Injetor", "Profissional", "Tipo de Agendamento", "Tipo do agendamento", "Status", "Origem do cliente"],
        ):
            details["Tipo de Agendamento"] = ""

        try:
            c = _find_field_container_by_label(modal, "WhatsApp do cliente")
            if c is not None:
                raw = _extract_input_value_from_container(c)
                raw = _clean_placeholder(raw)
                if _looks_like_phone(raw):
                    details["Telefone"] = _extract_phone(raw) or raw
        except Exception:
            pass

        try:
            c = _find_field_container_by_label(modal, "CPF do cliente")
            if c is not None:
                details["CPF"] = _clean_placeholder(_extract_input_value_from_container(c))
        except Exception:
            pass

        try:
            c = _find_field_container_by_label(modal, "Origem do cliente")
            if c is not None:
                details["Por onde nos conheceu"] = _clean_placeholder(_extract_multiselect_value_from_container(c))
        except Exception:
            pass

        # Service selection lives under "Serviços" section and shows placeholder "Selecione o serviço" when empty.
        try:
            c = _find_field_container_by_label(modal, "Serviços")
            if c is None:
                c = _find_field_container_by_label(modal, "Selecione o serviço")
            if c is not None:
                details["Serviço a realizar"] = _clean_placeholder(_extract_multiselect_value_from_container(c))
        except Exception:
            pass

        # Prefer structured fields when present.
        if not details["Cliente"]:
            details["Cliente"] = _find_first_text(
                modal,
                xpaths=[
                    './/p[contains(., "Cliente")]/strong',
                    './/*[contains(normalize-space(.), "Cliente")]/strong',
                ],
            )
        if not details["Profissional"]:
            details["Profissional"] = _find_first_text(
                modal,
                xpaths=[
                    './/p[contains(., "Injetor")]/strong',
                    './/*[contains(normalize-space(.), "Injetor")]/strong',
                    './/p[contains(., "Profissional")]/strong',
                    './/*[contains(normalize-space(.), "Profissional")]/strong',
                ],
            )
        if not details["Telefone"]:
            details["Telefone"] = _find_first_text(
                modal,
                xpaths=[
                    './/p[contains(., "Telefone")]/strong',
                    './/*[contains(normalize-space(.), "Telefone")]/strong',
                ],
            )
        if not details["Tipo de Agendamento"]:
            details["Tipo de Agendamento"] = _find_first_text(
                modal,
                xpaths=[
                    './/p[contains(., "Tipo de Agendamento")]/strong',
                    './/*[contains(normalize-space(.), "Tipo de Agendamento")]/strong',
                ],
            )
        dt_text = _find_first_text(
            modal,
            xpaths=[
                './/p[contains(., "Data e Hora")]/strong',
                './/*[contains(normalize-space(.), "Data e Hora")]/strong',
            ],
        )
        dt_date, dt_time = _parse_date_time(dt_text)
        details["Data"] = dt_date
        details["Horário"] = dt_time

        # WW modal variant: "Data de início" uses DD/MM/YY.
        if not details["Data"] or not details["Horário"]:
            m = re.search(r"Data\s+de\s+in[ií]cio\s+(\d{1,2}/\d{1,2}/\d{2,4})\s+(\d{1,2}:\d{2})", text, re.IGNORECASE)
            if m:
                raw_date = m.group(1)
                raw_time = m.group(2)
                try:
                    if re.fullmatch(r"\d{1,2}/\d{1,2}/\d{2}", raw_date):
                        dt = datetime.strptime(raw_date, "%d/%m/%y")
                    else:
                        dt = datetime.strptime(raw_date, "%d/%m/%Y")
                    details["Data"] = dt.strftime("%d/%m/%Y")
                except Exception:
                    details["Data"] = raw_date
                details["Horário"] = raw_time

        obs = _find_first_text(
            modal,
            xpaths=[
                './/p[contains(., "Observações")]/strong',
                './/*[contains(normalize-space(.), "Observações")]/strong',
            ],
        )
        if obs and obs.upper() != "N/A":
            details["Observações"] = obs[:200]

        # Fallbacks when the modal does not have strong-tag fields.
        if not details["Telefone"]:
            # First try to fetch the WhatsApp field from text, but ONLY if it looks like a phone.
            wa_text = _clean_placeholder(
                _find_value_by_label_in_text(text, labels=["WhatsApp do cliente", "WhatsApp"])
            )
            if _looks_like_phone(wa_text):
                details["Telefone"] = _extract_phone(wa_text) or wa_text
            else:
                # Last resort: scan the modal text for a phone-like pattern.
                details["Telefone"] = _extract_phone(text)
        details["Telefone"] = _clean_placeholder(details.get("Telefone", ""))

        if not details.get("CPF"):
            mcpf = re.search(r"\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b", text)
            if mcpf:
                details["CPF"] = mcpf.group(1)

        if not details.get("Por onde nos conheceu"):
            details["Por onde nos conheceu"] = _find_value_by_label_in_text(
                text,
                labels=["Origem do cliente", "Como nos conheceu", "Por onde nos conheceu"],
            )
        details["Por onde nos conheceu"] = _clean_placeholder(details.get("Por onde nos conheceu", ""))

        if not details.get("Serviço a realizar"):
            details["Serviço a realizar"] = _find_value_by_label_in_text(
                text,
                labels=["Serviço a realizar", "Selecione o serviço", "Serviços"],
            )
        details["Serviço a realizar"] = _clean_placeholder(details.get("Serviço a realizar", ""))
        if not details["Profissional"]:
            by_text_prof = _clean_placeholder(_find_value_by_label_in_text(text, labels=["Injetor", "Profissional"]))
            if not _is_invalid_field_value(
                by_text_prof,
                blocked_labels=["Injetor", "Profissional", "Tipo de Agendamento", "Status", "Origem do cliente"],
            ):
                details["Profissional"] = by_text_prof
        if not details["Tipo de Agendamento"]:
            by_text_type = _clean_placeholder(
                _find_value_by_label_in_text(
                    text,
                    labels=["Tipo de Agendamento", "Tipo de agendamento", "Tipo do agendamento"],
                )
            )
            if not _is_invalid_field_value(
                by_text_type,
                blocked_labels=["Injetor", "Profissional", "Tipo de Agendamento", "Tipo do agendamento", "Status", "Origem do cliente"],
            ):
                details["Tipo de Agendamento"] = by_text_type
        if not details["Observações"]:
            lines = text.split("\n")
            for idx, line in enumerate(lines):
                if "Observações" in line and idx + 1 < len(lines):
                    obs2 = lines[idx + 1].strip()
                    if obs2 and not obs2.startswith("("):
                        details["Observações"] = obs2[:200]
                    break

        if not details["Status"]:
            details["Status"] = _extract_value_by_label(modal, labels=["Status"], prefer_multiselect=True, allow_input=False)
        if not details["Status"]:
            details["Status"] = _extract_status(text)
        details["Status"] = _collapse_repeated_phrase(details["Status"])
        details["Profissional"] = _collapse_repeated_phrase(details["Profissional"])
        details["Tipo de Agendamento"] = _collapse_repeated_phrase(details["Tipo de Agendamento"])
        details["Por onde nos conheceu"] = _collapse_repeated_phrase(details["Por onde nos conheceu"])

        # Defensive rule: when type accidentally mirrors injector, trust the explicit
        # "Tipo ..." text labels instead of keeping a likely wrong value.
        if details["Tipo de Agendamento"] and details["Profissional"]:
            if _normalize_signature_text(details["Tipo de Agendamento"]) == _normalize_signature_text(details["Profissional"]):
                details["Tipo de Agendamento"] = ""
                by_text_type = _clean_placeholder(
                    _find_value_by_label_in_text(
                        text,
                        labels=["Tipo de Agendamento", "Tipo de agendamento", "Tipo do agendamento"],
                    )
                )
                if (
                    by_text_type
                    and not _is_invalid_field_value(
                        by_text_type,
                        blocked_labels=[
                            "Injetor",
                            "Profissional",
                            "Tipo de Agendamento",
                            "Tipo do agendamento",
                            "Status",
                            "Origem do cliente",
                        ],
                    )
                    and _normalize_signature_text(by_text_type) != _normalize_signature_text(details["Profissional"])
                ):
                    details["Tipo de Agendamento"] = by_text_type

        type_equals_professional = (
            bool(details.get("Tipo de Agendamento"))
            and bool(details.get("Profissional"))
            and _normalize_signature_text(details["Tipo de Agendamento"]) == _normalize_signature_text(details["Profissional"])
        )
        if _env_truthy("EF_DEBUG_MODAL_DUMP") and (not details["Tipo de Agendamento"] or type_equals_professional):
            client_filter = (os.getenv("EF_DEBUG_MODAL_CLIENT_CONTAINS", "") or "").strip().lower()
            haystack = f'{details.get("Cliente", "")} {text}'.lower()
            if not client_filter or client_filter in haystack:
                reason = "missing" if not details["Tipo de Agendamento"] else "equals_professional"
                log_file_only(
                    "DEBUG modal type issue (%s) | Cliente=%r | Profissional=%r | Tipo=%r | Status=%r"
                    % (
                        reason,
                        details.get("Cliente", ""),
                        details.get("Profissional", ""),
                        details.get("Tipo de Agendamento", ""),
                        details.get("Status", ""),
                    )
                )
                tipo_lines = [ln.strip() for ln in text.split("\n") if "tipo" in ln.lower()]
                for ln in tipo_lines[:8]:
                    log_file_only("DEBUG line(tipo): " + _truncate(ln, limit=300))

                tipo_container = _find_field_container_by_label(modal, "Tipo de Agendamento")
                if tipo_container is None:
                    tipo_container = _find_field_container_by_label(modal, "Tipo de agendamento")
                if tipo_container is not None:
                    log_file_only("DEBUG tipo container html: " + _truncate(_safe_outer_html(tipo_container)))
                    log_file_only("DEBUG tipo multiselect: " + _truncate(_extract_multiselect_value_from_container(tipo_container), limit=300))
                    log_file_only("DEBUG tipo input: " + _truncate(_extract_input_value_from_container(tipo_container), limit=300))
                else:
                    log_file_only("DEBUG tipo container not found")
    except Exception:
        return details

    return details


def _close_modal(driver: WebDriver) -> None:
    modal_locators = [
        (By.XPATH, '//div[contains(@class,"modal-dropzone") and .//*[contains(normalize-space(.), "Agendamento")]]'),
        (By.XPATH, '//div[contains(@class,"modal-dropzone")]'),
        (By.XPATH, '//div[@role="dialog" or contains(@class, "modal")]'),
    ]

    def _wait_closed() -> None:
        for by, sel in modal_locators:
            try:
                WebDriverWait(driver, 3, poll_frequency=0.2).until(EC.invisibility_of_element_located((by, sel)))
                return
            except Exception:
                continue

    try:
        btn = WebDriverWait(driver, 2).until(
            EC.element_to_be_clickable(
                (
                    By.XPATH,
                    '//button[contains(normalize-space(.), "Fechar") '
                    'or contains(normalize-space(.), "Close") '
                    'or contains(normalize-space(.), "Cancelar") '
                    'or contains(normalize-space(.), "Voltar")]'
                )
            )
        )
        driver.execute_script("arguments[0].click();", btn)
        time.sleep(0.3)
        _wait_closed()
        return
    except Exception:
        pass

    # Common in this UI: X icon.
    try:
        x = WebDriverWait(driver, 1).until(EC.presence_of_element_located((By.CSS_SELECTOR, "div.icon-x")))
        # Click the closest button/container.
        clicked = driver.execute_script(
            r"""
            const el = arguments[0];
            function isClickable(n){
              if (!n) return false;
              const tag = (n.tagName || '').toLowerCase();
              if (tag === 'button') return true;
              const role = (n.getAttribute && n.getAttribute('role')) ? n.getAttribute('role') : '';
              if (role === 'button') return true;
              return false;
            }
            let cur = el;
            for (let i=0;i<6 && cur;i++){
              if (isClickable(cur)) { cur.click(); return true; }
              cur = cur.parentElement;
            }
            try { el.click(); return true; } catch (e) { return false; }
            """,
            x,
        )
        if clicked:
            time.sleep(0.2)
            _wait_closed()
            return
    except Exception:
        pass

    try:
        from selenium.webdriver.common.keys import Keys

        driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
        time.sleep(0.2)
        _wait_closed()
    except Exception:
        return


def _scrape_complete_current_view(
    driver: WebDriver,
    *,
    target_signatures: Counter[str] | None = None,
    signature_mode: str = "dt_title",
) -> list[dict[str, str]]:
    """Complete scrape: always collect basic info and try to enrich with modal details."""

    log("Scraping appointments (complete)...")

    event_xpath, events = _find_events(driver)
    WebDriverWait(driver, 20).until(EC.presence_of_all_elements_located((By.XPATH, event_xpath)))
    _, events = _find_events(driver)
    log(f"Found {len(events)} events")

    rows: list[dict[str, str]] = []
    missing_time_count = 0
    error_count = 0
    missing_modal_count = 0

    for i in range(len(events)):
        try:
            log_file_only(f"Appointment {i+1}/{len(events)}: processing")
            _, events = _find_events(driver)
            if i >= len(events):
                break
            event = events[i]

            title_elem = event.find_element(By.XPATH, './/*[contains(@class, "fc-event-title")]')
            title_text = (title_elem.text or "").strip()
            time_text = ""
            try:
                time_elem = event.find_element(By.XPATH, './/*[contains(@class, "fc-event-time")]')
                time_text = (time_elem.text or "").strip()
            except NoSuchElementException:
                missing_time_count += 1
                log_file_only(
                    "WARNING event %s: missing fc-event-time (complete). title=%r event_text=%r outerHTML=%s"
                    % (i + 1, (title_elem.text or "").strip(), (event.text or "").strip(), _safe_outer_html(event))
                )

            base = _extract_event_info(title_text, time_text)
            base["Data"] = _extract_event_date(driver, event)
            duration_min = parse_duration_minutes_from_time_text(time_text)
            base["Duração Min"] = str(duration_min) if duration_min else ""
            base.setdefault("Telefone", "")
            base.setdefault("CPF", "")
            base.setdefault("Por onde nos conheceu", "")
            base.setdefault("Serviço a realizar", "")
            base.setdefault("Observações", "")
            base.setdefault("Status", "")

            signature = build_event_signature(
                base.get("Data", ""),
                base.get("Horário", ""),
                title_text,
                mode=signature_mode,
            )
            if target_signatures is not None:
                if target_signatures.get(signature, 0) <= 0:
                    continue
                target_signatures[signature] -= 1

            try:
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", event)
                time.sleep(0.2)
                try:
                    driver.execute_script("arguments[0].click();", event)
                except Exception:
                    try:
                        event.click()
                    except Exception:
                        pass

                details = _try_modal_details(driver)

                # Merge, preferring modal fields when present.
                if details.get("Cliente"):
                    base["Cliente"] = str(details["Cliente"])
                if details.get("Profissional"):
                    base["Profissional"] = str(details["Profissional"])
                if details.get("Tipo de Agendamento"):
                    base["Tipo de Agendamento"] = str(details["Tipo de Agendamento"])
                if details.get("Telefone"):
                    base["Telefone"] = str(details["Telefone"])
                if details.get("CPF"):
                    base["CPF"] = str(details["CPF"])
                if details.get("Por onde nos conheceu"):
                    base["Por onde nos conheceu"] = str(details["Por onde nos conheceu"])
                if details.get("Serviço a realizar"):
                    base["Serviço a realizar"] = str(details["Serviço a realizar"])
                if details.get("Observações"):
                    base["Observações"] = str(details["Observações"])
                if details.get("Status"):
                    base["Status"] = str(details["Status"])
                if details.get("Data"):
                    base["Data"] = str(details["Data"])
                if details.get("Horário"):
                    base["Horário"] = str(details["Horário"])
                    details_duration_min = parse_duration_minutes_from_time_text(base["Horário"])
                    if details_duration_min:
                        base["Duração Min"] = str(details_duration_min)
            except Exception:
                missing_modal_count += 1
            finally:
                _close_modal(driver)

            rows.append(base)
            if (i + 1) % 10 == 0:
                log(f"... {i+1}/{len(events)}")

        except Exception as e:
            error_count += 1
            log_exception(f"ERROR event {i+1}", e)
            continue

    if missing_time_count:
        log(f"NOTE: {missing_time_count} events had no visible time; saved with empty 'Horário'.")
    if missing_modal_count:
        log(f"NOTE: {missing_modal_count} events could not be enriched via modal; kept basic data.")
    if error_count:
        log(f"NOTE: {error_count} events failed; see log file for details.")

    return rows


def scrape_complete(
    driver: WebDriver,
    *,
    target_signatures: Counter[str] | None = None,
    signature_mode: str = "dt_title",
) -> list[dict[str, str]]:
    seen_keys: set[str] = set()

    def collect_current_view() -> list[dict[str, str]]:
        return _scrape_complete_current_view(
            driver,
            target_signatures=target_signatures,
            signature_mode=signature_mode,
        )

    rows_all = _collect_across_calendar_window(driver, collect_current_view)
    deduped: list[dict[str, str]] = []
    for row in rows_all:
        key = "||".join(
            [
                (row.get("Data") or "").strip(),
                (row.get("Horário") or "").strip(),
                (row.get("Cliente") or "").strip(),
                (row.get("Tipo de Agendamento") or "").strip(),
                (row.get("Profissional") or "").strip(),
            ]
        )
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(row)

        if target_signatures is not None and all(count <= 0 for count in target_signatures.values()):
            break

    return deduped


def _scrape_index_current_view(
    driver: WebDriver,
    *,
    signature_mode: str = "dt_title",
) -> list[dict[str, str]]:
    """Lightweight scrape: capture date/time + title for change detection."""

    log("Scraping appointments (index)...")

    # Wait for calendar container first; some units can legitimately have zero events.
    WebDriverWait(driver, 20).until(
        EC.presence_of_element_located(
            (
                By.XPATH,
                '//*[contains(@class, "fc-view-harness") or contains(@class, "fc-daygrid") or contains(@class, "fc-scroller")]',
            )
        )
    )

    # Then give events a short window to render. If still empty, continue with zero rows.
    try:
        WebDriverWait(driver, 8).until(lambda d: len(_find_events(d)[1]) > 0)
    except TimeoutException:
        pass

    _, events = _find_events(driver)
    log(f"Found {len(events)} events")
    if not events:
        log("No events found in current calendar view (index).")
        return []

    rows: list[dict[str, str]] = []
    missing_time_count = 0
    error_count = 0

    for i, event in enumerate(events, start=1):
        try:
            title_elem = event.find_element(By.XPATH, './/*[contains(@class, "fc-event-title")]')
            title_text = (title_elem.text or "").strip()
            time_text = ""
            try:
                time_elem = event.find_element(By.XPATH, './/*[contains(@class, "fc-event-time")]')
                time_text = (time_elem.text or "").strip()
            except NoSuchElementException:
                missing_time_count += 1
                log_file_only(
                    "WARNING event %s: missing fc-event-time (index). title=%r event_text=%r outerHTML=%s"
                    % (i, title_text, (event.text or "").strip(), _safe_outer_html(event))
                )

            date_text = _extract_event_date(driver, event)
            signature = build_event_signature(date_text, time_text, title_text, mode=signature_mode)
            rows.append(
                {
                    "Data": date_text,
                    "Horário": time_text,
                    "Título": title_text,
                    "Assinatura": signature,
                }
            )
        except Exception as e:
            error_count += 1
            log_exception(f"ERROR event {i} (index)", e)
            continue

    if missing_time_count:
        log(f"NOTE: {missing_time_count} events had no visible time; saved with empty 'Horário'.")
    if error_count:
        log(f"NOTE: {error_count} events failed to parse; see log file for details.")

    return rows


def scrape_index(
    driver: WebDriver,
    *,
    signature_mode: str = "dt_title",
) -> list[dict[str, str]]:
    rows_all = _collect_across_calendar_window(
        driver,
        lambda: _scrape_index_current_view(driver, signature_mode=signature_mode),
    )
    seen_keys: set[str] = set()
    deduped: list[dict[str, str]] = []
    for row in rows_all:
        key = (row.get("Assinatura") or "").strip()
        if not key:
            key = "||".join(
                [
                    (row.get("Data") or "").strip(),
                    (row.get("Horário") or "").strip(),
                    (row.get("Título") or "").strip(),
                ]
            )
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(row)
    return deduped


def scrape_full(driver: WebDriver) -> list[dict[str, str]]:
    """Backward compatible alias."""

    return scrape_complete(driver)


def save(rows: list[dict[str, str]], *, output_dir: Path, prefix: str) -> tuple[Path, Path]:
    if not rows:
        raise ValueError("No rows to save")

    df = pd.DataFrame(rows)

    # Standardize column set + ordering for downstream consumption.
    ordered_cols = [
        "Data",
        "Horário",
        "Cliente",
        "Tipo de Agendamento",
        "Profissional",
        "Duração Min",
        "Telefone",
        "CPF",
        "Por onde nos conheceu",
        "Serviço a realizar",
        "Observações",
        "Status",
    ]

    for c in ordered_cols:
        if c not in df.columns:
            df[c] = ""

    # Keep any extra columns at the end (non-breaking).
    extras = [c for c in df.columns if c not in ordered_cols]
    df = df[ordered_cols + extras]

    df = sort_by_date_time(df, date_col="Data", time_col="Horário")
    df = append_total_row(df, label_column="Data")
    df = replace_zero_with_dash(df)
    df = trim_empty_rows_cols(df)

    csv_path = output_dir / f"{prefix}.csv"
    xlsx_path = output_dir / f"{prefix}.xlsx"

    df.to_csv(csv_path, index=False, encoding="utf-8")
    df.to_excel(xlsx_path, index=False, engine="openpyxl")
    format_workbook(xlsx_path)

    return csv_path, xlsx_path


def save_index(
    rows: list[dict[str, str]],
    *,
    output_dir: Path,
    prefix: str,
    include_title: bool = False,
) -> tuple[Path, Path]:
    keep_cols = ["Data", "Horário"] + (["Título"] if include_title else [])
    if rows:
        df = pd.DataFrame(rows)
    else:
        df = pd.DataFrame(columns=keep_cols)
    for c in keep_cols:
        if c not in df.columns:
            df[c] = ""
    df = df[keep_cols]

    df = sort_by_date_time(df, date_col="Data", time_col="Horário")
    df = trim_empty_rows_cols(df)

    csv_path = output_dir / f"{prefix}.csv"
    xlsx_path = output_dir / f"{prefix}.xlsx"

    df.to_csv(csv_path, index=False, encoding="utf-8")
    df.to_excel(xlsx_path, index=False, engine="openpyxl")
    format_workbook(xlsx_path)

    return csv_path, xlsx_path
