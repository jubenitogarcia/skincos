from __future__ import annotations

import re
import unicodedata
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Union

import pandas as pd
from selenium.common.exceptions import StaleElementReferenceException
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from .auth import log
from .dataframe_tools import (
    append_total_row,
    replace_zero_with_dash,
    sort_by_date_time,
    trim_empty_rows_cols,
)
from .excel import format_workbook


CashRow = dict[str, Union[str, int, float]]
ReceiptRow = dict[str, Union[str, float]]
SalePaymentRow = dict[str, Union[str, int, float]]


# Categorization rules for Sheets (keep them intentionally simple and permissive).
# Requested mapping:
# - Crédito: Cartão de Crédito, Crédito Parcelado - Rede, Cartão de Crédito - ONEBANK, Cartão de Crédito - SICOOB
# - Débito: Cartão de Débito - SICOOB, Cartão de Débito - ONEBANK
# - PIX: PIX, Transferência bancária
# - Ecommerce: Link de pagamento
# - Dinheiro: Dinheiro
# - Antecipado: Venda Antecipada, Gift Cards
_RE_CREDIT = re.compile(r"cr[eé]dito", re.IGNORECASE)
_RE_DEBIT = re.compile(r"d[eé]bito", re.IGNORECASE)
_RE_TRANSFER = re.compile(r"(pix|transfer[eê]ncia|doc|ted)", re.IGNORECASE)
_RE_ECOMMERCE = re.compile(r"(link|ecommerce)", re.IGNORECASE)
_RE_INSTALLMENTS = re.compile(r"(?P<n>\d+)\s*x\b", re.IGNORECASE)


def _normalize_payment_method_name(raw: str) -> str:
    name = re.sub(r"\s+", " ", (raw or "")).strip()
    # The modal sometimes prefixes method names with stray numeric tokens (e.g. "00 PIX", "80 Link de pagamento").
    name = re.sub(r"^[0-9]+(?:[.,][0-9]+)?%?\s+", "", name).strip()
    name = re.sub(r"^[-–—]+\s*", "", name).strip()
    return name


def _strip_accents(text: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFD", text) if unicodedata.category(ch) != "Mn")


def _normalize_payment_key(raw: str) -> str:
    text = _normalize_payment_method_name(raw or "")
    text = re.sub(r"\b\d+\s*x\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"[–—/\\-]", " ", text)
    text = re.sub(r"[()]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = _strip_accents(text).upper()
    return text


_PAYMENT_GROUP_ORDER = ["Crédito", "Débito", "PIX", "Ecommerce", "Dinheiro", "Antecipado"]
_PAYMENT_GROUP_METHODS = {
    "Crédito": [
        "Cartão de Crédito",
        "Crédito Parcelado - Rede",
        "Cartão de Crédito - ONEBANK",
        "Cartão de Crédito - SICOOB",
    ],
    "Débito": [
        "Cartão de Débito - SICOOB",
        "Cartão de Débito - ONEBANK",
        "Cartão de Débito",
    ],
    "PIX": [
        "PIX",
        "Transferência bancária",
    ],
    "Ecommerce": [
        "Link de pagamento",
    ],
    "Dinheiro": [
        "Dinheiro",
    ],
    "Antecipado": [
        "Venda Antecipada",
        "Compra Antecipada",
        "Compras Antecipadas",
        "Gift Cards",
        "Gift Card",
    ],
}
_PAYMENT_GROUP_KEYS = {
    group: [_normalize_payment_key(name) for name in names if name]
    for group, names in _PAYMENT_GROUP_METHODS.items()
}


def _match_payment_groups(raw: str) -> list[str]:
    text_key = _normalize_payment_key(raw)
    if not text_key:
        return []
    groups: list[str] = []
    for group in _PAYMENT_GROUP_ORDER:
        keys = _PAYMENT_GROUP_KEYS.get(group, [])
        if any(key and key in text_key for key in keys):
            groups.append(group)

    # Keyword fallback for noisy/free-text payment labels from the UI.
    if "Antecipado" not in groups and ("ANTECIP" in text_key or "GIFT CARD" in text_key):
        groups.append("Antecipado")
    if "Crédito" not in groups and "CREDITO" in text_key:
        groups.append("Crédito")
    if "Débito" not in groups and "DEBITO" in text_key:
        groups.append("Débito")
    if "PIX" not in groups and ("PIX" in text_key or "TRANSFERENCIA" in text_key):
        groups.append("PIX")
    if "Ecommerce" not in groups and ("LINK" in text_key or "ECOMMERCE" in text_key):
        groups.append("Ecommerce")
    if "Dinheiro" not in groups and "DINHEIRO" in text_key:
        groups.append("Dinheiro")
    return groups


def _group_payment_method(raw: str) -> str:
    groups = _match_payment_groups(raw)
    if groups:
        return groups[0]
    return _normalize_payment_method_name(raw or "")


def summarize_cash_rows_for_sheets(rows: list[CashRow]) -> dict[str, dict[str, float]]:
    """Aggregate extracted rows into per-day totals for Google Sheets.

    Returns: {"DD/MM/YYYY": {"credit": x, "debit": y, "cash": z, "ecommerce": a, "transfer": b, "total": t}}
    """

    per_day: dict[str, dict[str, float]] = {}

    for r in rows:
        day = str(r.get("Data Inicial") or "").strip()
        if not day:
            continue

        method = _normalize_payment_method_name(str(r.get("Forma de Pagamento") or ""))
        if method.strip().upper() == "TOTAL":
            continue

        raw_val = r.get("Valor")
        if isinstance(raw_val, (int, float)):
            value = float(raw_val)
        else:
            value = float(_extract_currency_value(str(raw_val or "")))

        bucket = per_day.setdefault(
            day,
            {"credit": 0.0, "debit": 0.0, "cash": 0.0, "ecommerce": 0.0, "transfer": 0.0, "total": 0.0},
        )

        method_norm = method.strip()

        # Apply in the order requested.
        if _RE_CREDIT.search(method_norm):
            bucket["credit"] += value
        elif _RE_DEBIT.search(method_norm):
            bucket["debit"] += value
        elif _RE_TRANSFER.search(method_norm):
            bucket["transfer"] += value
        elif _RE_ECOMMERCE.search(method_norm):
            bucket["ecommerce"] += value
        elif "dinheiro" in method_norm.lower():
            bucket["cash"] += value
        else:
            # Unknown bucket: include in total only.
            pass

        bucket["total"] += value

    return per_day


def _extract_currency_value(text: str) -> float:
    match = re.search(r"R\$\s*([\d.,]+)", (text or ""))
    if not match:
        return 0.0

    value_str = match.group(1).replace(".", "").replace(",", ".")
    try:
        return float(value_str)
    except Exception:
        return 0.0


def _format_brl(value: float) -> str:
    # Format as: R$ 1.234,56
    # Start from US format 1,234.56 then swap separators.
    s = f"{value:,.2f}"
    s = s.replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {s}"


def _set_input_value_and_dispatch(driver: WebDriver, element, value: str) -> None:
    driver.execute_script(
        """
        const el = arguments[0];
        const value = arguments[1];
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        """,
        element,
        value,
    )


def _click_first(driver: WebDriver, *, xpaths: list[str], timeout_seconds: int = 8) -> bool:
    end = time.time() + timeout_seconds
    last_exc: Exception | None = None
    while time.time() < end:
        for xp in xpaths:
            try:
                el = driver.find_element(By.XPATH, xp)
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", el)
                time.sleep(0.1)
                driver.execute_script("arguments[0].click();", el)
                return True
            except Exception as e:
                last_exc = e
                continue
        time.sleep(0.2)

    if last_exc is not None:
        log(f"⚠ Could not click any target element: {last_exc}")
    return False


def _parse_payment_methods_from_modal_text(text: str) -> tuple[dict[str, dict[str, Union[int, float]]], float]:
    """Parse modal text that may be multi-line or compact.

    Example compact format (as recorded):
    "PIX 2 R$ 899,00 ... Dinheiro 1 R$ 0,00"
    """

    normalized = re.sub(r"\s+", " ", (text or "").strip())
    if not normalized:
        return {}, 0.0

    # Match sequences: <method name> <count> R$ <amount>
    pattern = re.compile(
        r"(?P<method>[A-Za-zÀ-ÿ0-9\-_/(). ]+?)\s+(?P<count>\d+)\s+R\$\s*(?P<amount>[\d.,]+)"
    )

    methods: dict[str, dict[str, Union[int, float]]] = {}
    # Avoid double-counting when we harvest text from multiple DOM nodes.
    seen_entries: set[tuple[str, int, float]] = set()
    for m in pattern.finditer(normalized):
        method = _normalize_payment_method_name((m.group("method") or "").strip())
        count = int(m.group("count"))
        amount = _extract_currency_value(f"R$ {m.group('amount')}")
        if not method:
            continue
        if method.strip().upper() == "TOTAL":
            continue

        entry = (method, count, float(round(amount, 2)))
        if entry in seen_entries:
            continue
        seen_entries.add(entry)

        existing = methods.get(method)
        if existing is None:
            methods[method] = {"count": count, "value": amount}
        else:
            existing["count"] = int(existing.get("count") or 0) + count
            existing["value"] = float(existing.get("value") or 0.0) + amount

    # Fallback: keep the old line-based heuristic for unexpected modal formats.
    if not methods:
        lines = [ln.strip() for ln in (text or "").split("\n") if ln.strip()]
        for line in lines:
            if "R$" not in line:
                continue
            parts = line.split("R$")
            if len(parts) < 2:
                continue
            method = _normalize_payment_method_name(parts[0].strip())
            amount = _extract_currency_value(line)
            if method:
                if method.strip().upper() == "TOTAL":
                    continue
                entry = (method, 0, float(round(amount, 2)))
                if entry in seen_entries:
                    continue
                seen_entries.add(entry)
                existing = methods.get(method)
                if existing is None:
                    methods[method] = {"count": 0, "value": amount}
                else:
                    existing["value"] = float(existing.get("value") or 0.0) + amount

    total = float(sum(float(v.get("value") or 0.0) for v in methods.values()))
    return methods, total


def _extract_modal_payment_methods(
    driver: WebDriver,
) -> tuple[WebElement, dict[str, dict[str, Union[int, float]]], float]:
    # IMPORTANT: this app often keeps modal containers in the DOM even when closed.
    # So we must wait for a VISIBLE container that actually contains currency text.

    def _find_visible_modal_with_money(_driver: WebDriver):
        candidates = _driver.find_elements(
            By.XPATH,
            '//*[contains(@class, "modal-dropzone") and contains(@class, "middle")]'
            ' | //div[@role="dialog" or @aria-modal="true" or contains(@class, "modal")]',
        )
        for el in candidates:
            try:
                if not el.is_displayed():
                    continue
                t = (el.text or "").strip()
                if "R$" in t:
                    return el
            except Exception:
                continue
        return False

    modal = WebDriverWait(driver, 12).until(_find_visible_modal_with_money)
    time.sleep(0.5)

    # Some modals render the useful content deeper; harvest text from descendants that include currency.
    text_parts: list[str] = []
    try:
        money_nodes = modal.find_elements(By.XPATH, './/*[contains(normalize-space(.), "R$")]')
        for node in money_nodes:
            t = (node.text or "").strip()
            if t:
                text_parts.append(t)
    except Exception:
        text_parts = []

    text = "\n".join(text_parts).strip() if text_parts else (modal.text or "").strip()
    parsed, total = _parse_payment_methods_from_modal_text(text)
    return modal, parsed, total


_ACTION_PREFIXES = ("emitir", "tentar", "ver", "erro", "corre", "cancel")
_ZERO_STATUS_TOKENS = ("cancel", "falt", "desmarc")


def _parse_receipt_rows_from_modal(modal: WebElement) -> list[ReceiptRow]:
    """Extract per-client receipt rows shown in the Recebimentos modal."""

    receipts: list[ReceiptRow] = []
    candidates = modal.find_elements(By.XPATH, './/div[@data-ww-repeat-index]')
    for element in candidates:
        raw_text = (element.get_attribute("innerText") or element.text or "").strip()
        if not raw_text:
            continue
        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        if not lines:
            continue
        if len(lines) == 1 and lines[0].lower().startswith("emitir"):
            continue
        currency_lines = [line for line in lines if line.startswith("R$")]
        if not currency_lines:
            continue

        # Date/time and client.
        date_line = lines[0]
        client = lines[1] if len(lines) > 1 else ""

        # Segment status lines (between client and first currency entry).
        first_currency_idx = next((idx for idx, line in enumerate(lines) if line.startswith("R$")), None)
        status_lines: list[str] = []
        if first_currency_idx is not None:
            for line in lines[2:first_currency_idx]:
                low = line.lower()
                if any(low.startswith(prefix) for prefix in _ACTION_PREFIXES):
                    continue
                status_lines.append(line)

        status_summary = ", ".join(status_lines)

        # Locate the payment method and the associated amount.
        method = ""
        amount_str = ""
        for idx in range(first_currency_idx or 0, len(lines)):
            line = lines[idx]
            if line.startswith("R$"):
                continue
            low = line.lower()
            if any(low.startswith(prefix) for prefix in _ACTION_PREFIXES):
                continue
            next_amount = next((lines[j] for j in range(idx + 1, len(lines)) if lines[j].startswith("R$")), None)
            if next_amount:
                method = line
                amount_str = next_amount
                break

        if not method or not amount_str:
            continue

        value = float(_extract_currency_value(amount_str))
        if any(token in status_summary.lower() for token in _ZERO_STATUS_TOKENS):
            value = 0.0
        if not method:
            continue

        time_str = ""
        date_str = ""
        try:
            dt = datetime.strptime(date_line, "%d/%m/%y %H:%M")
            date_str = dt.strftime("%d/%m/%Y")
            time_str = dt.strftime("%H:%M")
        except ValueError:
            parts = date_line.split()
            date_str = parts[0] if parts else ""
            time_str = parts[1] if len(parts) > 1 else ""

        receipt: ReceiptRow = {
            "Data": date_str,
            "Horário": time_str,
            "Cliente": client,
            "Status": status_summary,
            "Forma de Pagamento": method,
            "Valor Pago": value,
            "Modal Info": amount_str,
        }
        receipts.append(receipt)

    return receipts


def extract_cash_receipts(driver: WebDriver, *, start_date: str = "", end_date: str = "") -> list[ReceiptRow]:
    """Click Recebimentos and harvest per-client receipt rows."""

    log("Opening Recebimentos breakdown (per client)...")
    opened = _click_first(
        driver,
        xpaths=[
            '//button[contains(., "Recebimentos") or contains(., "Recebimento")]',
            '//*[contains(normalize-space(.), "Recebimentos") or contains(normalize-space(.), "Recebimento")][self::button or self::a]',
            '//*[self::p or self::span][normalize-space(.)="Recebimentos do período"]',
            '//*[contains(normalize-space(.), "Recebimentos do período")]/ancestor::*[self::button or self::a][1]',
            '//*[contains(normalize-space(.), "Recebimentos do período")]/ancestor::div[1]',
            '//*[contains(normalize-space(.), "Recebimentos do período")]/following::*[self::p or self::span][contains(normalize-space(.), "R$")][1]',
            '//*[contains(normalize-space(.), "Recebimentos")]/ancestor::*[self::button or self::a or self::div][1]',
            '(//p[contains(normalize-space(.), "R$")])[1]',
        ],
        timeout_seconds=8,
    )
    if not opened:
        log("ERROR: Could not open Recebimentos breakdown")
        return []

    try:
        modal, _, _ = _extract_modal_payment_methods(driver)
    except Exception as e:
        log(f"ERROR: Failed to extract receipts modal: {e}")
        return []

    rows = _parse_receipt_rows_from_modal(modal)
    for row in rows:
        row.setdefault("Data Inicial", start_date)
        row.setdefault("Data Final", end_date)
    return _expand_sale_rows_by_payment(rows)


_RE_SALE_DATETIME = re.compile(r"(?P<date>\d{2}/\d{2}/\d{2,4})\s+(?P<time>\d{2}:\d{2})")


def _parse_sale_cell_datetime_and_client(text: str) -> tuple[str, str, str]:
    """Parse the 'Vendas' cell which contains date, time, and client name."""

    raw = (text or "").strip()
    if not raw:
        return "", "", ""

    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    if not lines:
        return "", "", ""

    date_str = ""
    time_str = ""
    client = ""

    for idx, line in enumerate(lines):
        m = _RE_SALE_DATETIME.search(line)
        if not m:
            continue
        date_token = m.group("date")
        time_str = m.group("time")
        # Normalize date to DD/MM/YYYY when possible.
        try:
            dt = datetime.strptime(date_token, "%d/%m/%y")
            date_str = dt.strftime("%d/%m/%Y")
        except ValueError:
            try:
                dt = datetime.strptime(date_token, "%d/%m/%Y")
                date_str = dt.strftime("%d/%m/%Y")
            except ValueError:
                date_str = date_token

        # Client name is typically the next line after the date/time.
        if idx + 1 < len(lines):
            client = lines[idx + 1].strip()
        break

    # Fallback when we didn't find the date/time line.
    if not date_str and not time_str and lines:
        maybe = lines[0]
        m = _RE_SALE_DATETIME.search(maybe)
        if m:
            date_str = m.group("date")
            time_str = m.group("time")
            client = lines[1].strip() if len(lines) > 1 else ""

    return date_str, time_str, client


def _format_currency_cell(raw: str) -> float:
    return float(_extract_currency_value(raw))


def _categorize_payment_method(raw: str) -> str:
    """Retorna grupos de pagamento encontrados, separados por ' / '."""
    groups = _match_payment_groups(raw)
    if groups:
        return " / ".join(groups)
    return _normalize_payment_method_name(raw or "")


def _parse_payment_breakdown(payment_text: str) -> list[dict[str, object]]:
    normalized = re.sub(r"\s+", " ", (payment_text or "")).strip()
    if not normalized or "R$" not in normalized:
        return []

    pattern_method_first = re.compile(
        r"(?P<method>[A-Za-zÀ-ÿ0-9\-_/(). ]+?)\s*R\$\s*(?P<amount>[\d.,]+)",
        re.IGNORECASE,
    )
    pattern_amount_first = re.compile(
        r"R\$\s*(?P<amount>[\d.,]+)\s*(?P<method>[A-Za-zÀ-ÿ0-9\-_/(). ]+?)(?=(?:\s+R\$)|$)",
        re.IGNORECASE,
    )

    def _clean_method(text: str) -> str:
        value = _normalize_payment_method_name(text or "")
        value = re.sub(r"R\$\s*[\d.,]+", " ", value, flags=re.IGNORECASE)
        value = re.sub(r"^(em|no|na|via|pelo|pela|por|com)\s+", "", value, flags=re.IGNORECASE)
        value = re.sub(r"\s+(e|ou|/|\+)$", "", value, flags=re.IGNORECASE)
        return value.strip()

    parts: list[dict[str, object]] = []
    matches: list[tuple[tuple[int, int], str, float]] = []
    for pattern in (pattern_method_first, pattern_amount_first):
        for m in pattern.finditer(normalized):
            method = _clean_method(m.group("method") or "")
            if not method:
                continue
            amount = _extract_currency_value(f"R$ {m.group('amount')}")
            if amount <= 0:
                continue
            matches.append((m.span(), method, float(amount)))

    matches.sort(key=lambda item: item[0][0])
    kept_ranges: list[tuple[int, int]] = []
    for span, method, amount in matches:
        if any(not (span[1] <= rng[0] or rng[1] <= span[0]) for rng in kept_ranges):
            continue
        installments = _extract_installments(payment_text=method, paid_value=amount)
        parts.append(
            {
                "method": method,
                "amount": float(amount),
                "installments": int(installments),
            }
        )
        kept_ranges.append(span)
    return parts


def _expand_sale_rows_by_payment(rows: list[SalePaymentRow]) -> list[SalePaymentRow]:
    def _to_float_cell(value: object) -> float:
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            raw = value.strip()
            if not raw or raw == "–":
                return 0.0
            raw = raw.replace("R$", "").strip()
            if "," in raw and "." in raw:
                raw = raw.replace(".", "").replace(",", ".")
            elif "," in raw:
                raw = raw.replace(",", ".")
            try:
                return float(raw)
            except Exception:
                return 0.0
        return 0.0

    def _is_antecipado_method(method: str) -> bool:
        normalized = _strip_accents(method or "").lower()
        return "antecip" in normalized or "gift card" in normalized or "gift cards" in normalized

    expanded: list[SalePaymentRow] = []
    for row in rows:
        raw_payment = str(row.get("Pagamento Raw") or row.get("Pagamento") or "").strip()
        parts = _parse_payment_breakdown(raw_payment)
        if len(parts) <= 1:
            row.pop("Pagamento Raw", None)
            expanded.append(row)
            continue

        credit_val = _to_float_cell(row.get("Crédito Cliente"))
        split_rows: list[SalePaymentRow] = []
        antecipado_indexes: list[int] = []
        for part in parts:
            new_row = dict(row)
            new_row.pop("Pagamento Raw", None)
            payment_method = _categorize_payment_method(str(part.get("method") or ""))
            new_row["Pagamento"] = payment_method
            amount = float(part.get("amount") or 0.0)
            new_row["Valor"] = amount
            installments = int(part.get("installments") or 0)

            # Rule: when the payment method is "Compra Antecipada", the amount must be
            # reflected in "Crédito Cliente" (client balance), not as current "Valor Pago".
            if _is_antecipado_method(payment_method):
                new_row["Crédito Cliente"] = amount
                new_row["Valor Pago"] = 0.0
                new_row["Parcelas"] = 0
                antecipado_indexes.append(len(split_rows))
            else:
                new_row["Crédito Cliente"] = 0.0
                new_row["Valor Pago"] = amount
                new_row["Parcelas"] = installments

            split_rows.append(new_row)

        # Fallback: if there is no explicit "Antecipado" part but source row has client credit,
        # preserve that credit information in the first split row.
        if credit_val > 0 and not antecipado_indexes and split_rows:
            split_rows[0]["Crédito Cliente"] = credit_val

        # Keep source credit value as truth when we have antecipado rows.
        if credit_val > 0 and antecipado_indexes:
            assigned_credit = sum(_to_float_cell(split_rows[idx].get("Crédito Cliente")) for idx in antecipado_indexes)
            diff = round(credit_val - assigned_credit, 2)
            if abs(diff) > 0.01:
                first_idx = antecipado_indexes[0]
                split_rows[first_idx]["Crédito Cliente"] = _to_float_cell(split_rows[first_idx].get("Crédito Cliente")) + diff

        for new_row in split_rows:
            if "Crédito Cliente" in new_row:
                # Ensure non-antecipado split rows don't keep stale credit values.
                if not _is_antecipado_method(str(new_row.get("Pagamento") or "")):
                    new_row["Crédito Cliente"] = _to_float_cell(new_row.get("Crédito Cliente"))
            expanded.append(new_row)
    return expanded



def _extract_installments(*, payment_text: str, paid_value: float) -> int:
    """Retorna número de parcelas como int. Se não encontrar:
    - paid_value > 0 => 1 (à vista)
    - paid_value == 0 => 0 (sem pagamento)
    """
    m = _RE_INSTALLMENTS.search(payment_text or "")
    if m:
        try:
            n = int(m.group("n"))
            return n if n > 0 else 1
        except Exception:
            return 1 if paid_value > 0 else 0
    if paid_value > 0:
        return 1
    return 0


def _find_cash_sales_header_row(driver: WebDriver) -> WebElement:
    """Find the header row for the sales table (Vendas/Status/Valor/... columns)."""

    def _find(_driver: WebDriver):
        xpaths = [
            # Header row with the columns the user cares about.
            (
                '//*[normalize-space(.)="Vendas"]'
                '/ancestor::div[@data-ww-layout-id]'
                '[.//*[normalize-space(.)="Status"]'
                ' and .//*[normalize-space(.)="Valor"]'
                ' and (.//*[contains(normalize-space(.), "Crédito cliente")]'
                '      or .//*[contains(normalize-space(.), "Crédito Cliente")]'
                '      or .//*[contains(normalize-space(.), "Credito cliente")]'
                '      or .//*[contains(normalize-space(.), "Credito Cliente")])'
                ' and .//*[normalize-space(.)="Valor Pago"]'
                ' and .//*[normalize-space(.)="Pagamento"]][1]'
            ),
            # Fallback if the DOM structure changed and the "ancestor::div[@data-ww-layout-id]" isn't stable.
            (
                '//*[normalize-space(.)="Vendas"]'
                '/ancestor::*'
                '[.//*[normalize-space(.)="Status"]'
                ' and .//*[normalize-space(.)="Valor"]'
                ' and (.//*[contains(normalize-space(.), "Crédito")]'
                '      or .//*[contains(normalize-space(.), "Credito")])'
                ' and .//*[normalize-space(.)="Valor Pago"]'
                ' and .//*[normalize-space(.)="Pagamento"]][1]'
            ),
        ]
        for xp in xpaths:
            try:
                el = _driver.find_element(By.XPATH, xp)
                if el.is_displayed():
                    return el
            except Exception:
                continue
        return False

    return WebDriverWait(driver, 20).until(_find)


def _find_cash_sales_body_container(header_row: WebElement) -> WebElement:
    """Find the container that holds the list of sales rows (below the header row)."""

    cursor: WebElement = header_row
    for _ in range(6):
        try:
            siblings = cursor.find_elements(By.XPATH, "following-sibling::*")
        except StaleElementReferenceException:
            raise
        except Exception:
            siblings = []

        for sib in siblings:
            try:
                if not sib.is_displayed():
                    continue
                t = (sib.text or "").strip()
                # Skip the pagination footer container.
                if t.startswith("Página") or "curPageFooter" in (sib.get_attribute("outerHTML") or ""):
                    continue
                return sib
            except Exception:
                continue

        # Go up and try again.
        try:
            cursor = cursor.find_element(By.XPATH, "..")
        except Exception:
            break

    # As a last resort, return the header row's parent.
    try:
        return header_row.find_element(By.XPATH, "..")
    except Exception:
        return header_row


def _find_cash_sales_pagination_input(driver: WebDriver, header_row: WebElement) -> WebElement | None:
    """Return the visible pagination input (name=curPageFooter) if present."""

    try:
        inputs = driver.find_elements(By.XPATH, '//input[@name="curPageFooter"]')
        for el in inputs:
            try:
                if el.is_displayed():
                    return el
            except Exception:
                continue
    except Exception:
        return None

    # Fallback: search near the header row.
    try:
        el = header_row.find_element(By.XPATH, './/following::input[@name="curPageFooter"][1]')
        if el.is_displayed():
            return el
    except Exception:
        return None

    return None


def _parse_sale_row_from_cells(cells: list[WebElement]) -> SalePaymentRow | None:
    if len(cells) < 6:
        return None

    venda_text = (cells[0].get_attribute("innerText") or cells[0].text or "").strip()
    status_text = (cells[1].get_attribute("innerText") or cells[1].text or "").strip()
    valor_text = (cells[2].get_attribute("innerText") or cells[2].text or "").strip()
    credito_text = (cells[3].get_attribute("innerText") or cells[3].text or "").strip()
    valor_pago_text = (cells[4].get_attribute("innerText") or cells[4].text or "").strip()
    pagamento_text = (cells[5].get_attribute("innerText") or cells[5].text or "").strip()

    date_str, time_str, client = _parse_sale_cell_datetime_and_client(venda_text)
    if not date_str and not client:
        return None

    paid_value = float(_extract_currency_value(valor_pago_text))
    installments = _extract_installments(payment_text=pagamento_text, paid_value=paid_value)
    pagamento = _categorize_payment_method(pagamento_text)
    return {
        "Data": date_str,
        "Horário": time_str,
        "Cliente": client,
        "Status": status_text,
        "Valor": _format_currency_cell(valor_text) if valor_text else 0.0,
        "Crédito Cliente": _format_currency_cell(credito_text) if credito_text else 0.0,
        "Valor Pago": _format_currency_cell(valor_pago_text) if valor_pago_text else 0.0,
        "Parcelas": int(installments),
        "Pagamento": pagamento,
        "Pagamento Raw": pagamento_text,
    }


def _parse_sale_row_from_text(text: str) -> SalePaymentRow | None:
    raw = (text or "").strip()
    if not raw:
        return None

    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    if not lines:
        return None

    # Find the date/time token.
    dt_idx = None
    date_token = ""
    time_str = ""
    for i, ln in enumerate(lines):
        m = _RE_SALE_DATETIME.search(ln)
        if m:
            dt_idx = i
            date_token = m.group("date")
            time_str = m.group("time")
            break
    if dt_idx is None:
        return None

    # Normalize date token.
    date_str = date_token
    try:
        date_str = datetime.strptime(date_token, "%d/%m/%y").strftime("%d/%m/%Y")
    except ValueError:
        try:
            date_str = datetime.strptime(date_token, "%d/%m/%Y").strftime("%d/%m/%Y")
        except ValueError:
            date_str = date_token

    # Client is typically the line after date/time.
    client = lines[dt_idx + 1] if dt_idx + 1 < len(lines) else ""

    # Status is the next non-currency line after the client.
    status = ""
    cursor = dt_idx + 2
    while cursor < len(lines):
        ln = lines[cursor]
        if "R$" in ln:
            break
        status = ln
        cursor += 1
        break

    # Capture the first 3 currency values after status: Valor / Crédito Cliente / Valor Pago.
    currency = []
    while cursor < len(lines) and len(currency) < 3:
        ln = lines[cursor]
        if "R$" in ln:
            currency.append(ln)
        cursor += 1

    while len(currency) < 3:
        currency.append("R$ 0,00")

    # Remaining text is the "Pagamento" column (may include R$ again).
    pagamento_raw = " ".join(re.sub(r"\s+", " ", ln).strip() for ln in lines[cursor:] if ln.strip())
    paid_value = float(_extract_currency_value(currency[2]))
    installments = _extract_installments(payment_text=pagamento_raw, paid_value=paid_value)
    pagamento = _categorize_payment_method(pagamento_raw)
    return {
        "Data": date_str,
        "Horário": time_str,
        "Cliente": client,
        "Status": status,
        "Valor": _format_currency_cell(currency[0]),
        "Crédito Cliente": _format_currency_cell(currency[1]),
        "Valor Pago": _format_currency_cell(currency[2]),
        "Parcelas": int(installments),
        "Pagamento": pagamento,
        "Pagamento Raw": pagamento_raw,
    }


def extract_cash_sales_payments(
    driver: WebDriver,
    *,
    start_date: str = "",
    end_date: str = "",
    max_pages: int = 500,
) -> list[SalePaymentRow]:
    """Extract per-sale payment rows from the main Caixa table.

    The UI fills the table after the date range is applied; no need to click "Recebimentos do período".
    """

    log("Extracting cash sales table (per client/payment)...")
    header = _find_cash_sales_header_row(driver)
    rows: list[SalePaymentRow] = []
    seen: set[tuple[str, str, str, str]] = set()

    page_input = _find_cash_sales_pagination_input(driver, header)
    page_count = 1
    if page_input is not None:
        try:
            page_count = int(float(page_input.get_attribute("max") or "1"))
            if page_count < 1:
                page_count = 1
        except Exception:
            page_count = 1

    page_count = min(page_count, max_pages)

    for page in range(1, page_count + 1):
        # Re-acquire header each loop because the table DOM may re-render on pagination.
        try:
            header = _find_cash_sales_header_row(driver)
        except Exception:
            break

        page_input = _find_cash_sales_pagination_input(driver, header)
        if page_input is not None:
            try:
                _set_input_value_and_dispatch(driver, page_input, str(page))
                time.sleep(0.8)
            except Exception:
                pass

        # Find the list container and its rows.
        try:
            body = _find_cash_sales_body_container(header)
        except Exception:
            body = header

        try:
            candidates = body.find_elements(By.XPATH, "./*")
        except Exception:
            candidates = []

        # Filter to row-like blocks (exclude headers/footers).
        row_blocks: list[WebElement] = []
        for el in candidates:
            try:
                if not el.is_displayed():
                    continue
                t = (el.get_attribute("innerText") or el.text or "").strip()
                if not t:
                    continue
                if "Página" in t and "curPageFooter" in (el.get_attribute("outerHTML") or ""):
                    continue
                if "R$" not in t:
                    continue
                if "/" not in t or ":" not in t:
                    continue
                row_blocks.append(el)
            except Exception:
                continue

        # If we didn't find direct children, try one level deeper.
        if not row_blocks:
            try:
                nested = body.find_elements(By.XPATH, "./*/child::*")
            except Exception:
                nested = []
            for el in nested:
                try:
                    if not el.is_displayed():
                        continue
                    t = (el.get_attribute("innerText") or el.text or "").strip()
                    if not t:
                        continue
                    if "R$" not in t:
                        continue
                    if "/" not in t or ":" not in t:
                        continue
                    row_blocks.append(el)
                except Exception:
                    continue

        for block in row_blocks:
            parsed: SalePaymentRow | None = None
            try:
                cell_candidates = [c for c in block.find_elements(By.XPATH, "./*") if c.is_displayed()]
                parsed = _parse_sale_row_from_cells(cell_candidates)
            except StaleElementReferenceException:
                parsed = None
            except Exception:
                parsed = None

            if parsed is None:
                try:
                    raw_text = (block.get_attribute("innerText") or block.text or "").strip()
                except Exception:
                    raw_text = ""
                parsed = _parse_sale_row_from_text(raw_text)

            if not parsed:
                continue

            key = (
                str(parsed.get("Data") or ""),
                str(parsed.get("Horário") or ""),
                str(parsed.get("Cliente") or ""),
                str(parsed.get("Valor Pago") or ""),
            )
            if key in seen:
                continue
            seen.add(key)
            parsed.setdefault("Data Inicial", start_date)
            parsed.setdefault("Data Final", end_date)
            rows.append(parsed)

    return _expand_sale_rows_by_payment(rows)


def navigate_to_cash(driver: WebDriver, cash_url: str, *, timeout_seconds: int = 20) -> bool:
    log(f"Navigating to cash page: {cash_url}")
    driver.get(cash_url)
    time.sleep(3)

    try:
        WebDriverWait(driver, timeout_seconds).until(EC.presence_of_element_located((By.XPATH, "//input|//button")))

        # The reception services page is multi-tool; explicitly select the Caixa tab.
        clicked_caixa = _click_first(
            driver,
            xpaths=[
                '//button[.//span[normalize-space()="Caixa"] or normalize-space()="Caixa"]',
                '//*[self::span or self::p][normalize-space()="Caixa"]/ancestor::button[1]',
                '//*[normalize-space()="Caixa"][self::button or self::a]',
            ],
            timeout_seconds=5,
        )
        if clicked_caixa:
            time.sleep(1.0)
            log("✓ Selected Caixa")
        else:
            log("⚠ Could not explicitly click 'Caixa' (continuing)")

        log("✓ Cash page loaded")
        return True
    except Exception as e:
        log(f"ERROR: Could not load cash page: {e}")
        return False


def set_date_range_last_days(driver: WebDriver, days: int) -> tuple[str, str]:
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)

    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")

    return set_date_range(driver, start_date=start_str, end_date=end_str)


def set_date_range(driver: WebDriver, *, start_date: str, end_date: str) -> tuple[str, str]:
    """Set an explicit date range (YYYY-MM-DD) and click 'Aplicar' if available."""

    date_inputs = driver.find_elements(By.XPATH, '//input[@type="date"]')
    if len(date_inputs) >= 2:
        log(f"Setting date range: {start_date} to {end_date}")
        _set_input_value_and_dispatch(driver, date_inputs[0], start_date)
        _set_input_value_and_dispatch(driver, date_inputs[1], end_date)
        time.sleep(0.5)
    else:
        log("⚠ Could not find 2 date inputs; using defaults")

    # The UI requires applying the filter.
    clicked_apply = _click_first(
        driver,
        xpaths=[
            '//button[.//span[normalize-space()="Aplicar"] or normalize-space()="Aplicar"]',
            '//*[self::span or self::p][normalize-space()="Aplicar"]/ancestor::button[1]',
        ],
        timeout_seconds=5,
    )
    if clicked_apply:
        time.sleep(1.0)
        log("✓ Applied date filters")
    else:
        log("⚠ Could not click 'Aplicar' (date filters may not be applied)")

    return start_date, end_date


def extract_cash_breakdown(driver: WebDriver, *, start_date: str = "", end_date: str = "") -> list[CashRow]:
    """Clicks 'Recebimentos' and parses modal for payment methods."""

    log("Opening Recebimentos breakdown...")
    opened = _click_first(
        driver,
        xpaths=[
            # Primary: explicit Recebimentos action.
            '//button[contains(., "Recebimentos") or contains(., "Recebimento")]',
            '//*[contains(normalize-space(.), "Recebimentos") or contains(normalize-space(.), "Recebimento")][self::button or self::a]',
            # Fallback: click the "Recebimentos do período" card/value (this matches the UI you've recorded).
            # Recorder-confirmed: clicking the label itself opens the modal.
            '//*[self::p or self::span][normalize-space(.)="Recebimentos do período"]',
            '//*[contains(normalize-space(.), "Recebimentos do período")]/ancestor::*[self::button or self::a][1]',
            '//*[contains(normalize-space(.), "Recebimentos do período")]/ancestor::div[1]',
            '//*[contains(normalize-space(.), "Recebimentos do período")]/following::*[self::p or self::span][contains(normalize-space(.), "R$")][1]',
            '//*[contains(normalize-space(.), "Recebimentos")]/ancestor::*[self::button or self::a or self::div][1]',
            # Last resort: click a visible currency value (often opens the modal in this UI).
            '(//p[contains(normalize-space(.), "R$")])[1]',
        ],
        timeout_seconds=8,
    )
    if not opened:
        # JS fallback: click the card that contains "Recebimentos do período" and a currency value.
        try:
            opened = bool(
                driver.execute_script(
                    r"""
                    const norm = (s) => (s || '').replace(/\s+/g,' ').trim();
                    const nodes = Array.from(document.querySelectorAll('p,span,div'));
                    const label = nodes.find(n => norm(n.textContent) === 'Recebimentos do período');
                    if (!label) return false;

                    let container = label.closest('div');
                    for (let i=0; i<8 && container; i++) {
                      const t = container.innerText || '';
                      if (t.includes('R$')) break;
                      container = container.parentElement;
                    }

                    const valueEl = container
                      ? Array.from(container.querySelectorAll('p,span,div')).find(n => norm(n.textContent).startsWith('R$'))
                      : null;
                    (valueEl || label).click();
                    return true;
                    """
                )
            )
            if opened:
                time.sleep(0.6)
        except Exception:
            opened = False
    if not opened:
        log("ERROR: Could not open Recebimentos breakdown")
        return []

    try:
        _, payment_methods, total = _extract_modal_payment_methods(driver)
    except Exception as e:
        # Skip this day (the menu loop will continue).
        log(f"ERROR: Failed to extract payment methods from modal (skipping day): {e}")
        return []
    if not payment_methods:
        log("⚠ No payment methods found in modal")
        return []

    grouped: dict[str, dict[str, Union[int, float]]] = {}
    group_order: list[str] = []
    for method, meta in payment_methods.items():
        group = _group_payment_method(method)
        value = float(meta.get("value") or 0.0)
        count = int(meta.get("count") or 0)
        existing = grouped.get(group)
        if existing is None:
            grouped[group] = {"count": count, "value": value}
            group_order.append(group)
        else:
            existing["count"] = int(existing.get("count") or 0) + count
            existing["value"] = float(existing.get("value") or 0.0) + value

    rows: list[CashRow] = []
    for group in group_order:
        meta = grouped[group]
        rows.append(
            {
                "Forma de Pagamento": group,
                "Quantidade": int(meta.get("count") or 0),
                "Valor": float(meta.get("value") or 0.0),
                "Data Inicial": start_date,
                "Data Final": end_date,
            }
        )

    rows.append(
        {
            "Forma de Pagamento": "TOTAL",
            "Quantidade": sum(int(meta.get("count") or 0) for meta in grouped.values()),
            "Valor": total,
            "Data Inicial": start_date,
            "Data Final": end_date,
        }
    )

    return rows


def save(rows: list[CashRow], *, output_dir: Path, prefix: str) -> tuple[Path, Path]:
    if not rows:
        raise ValueError("No rows to save")

    output_dir.mkdir(parents=True, exist_ok=True)

    df = pd.DataFrame(rows)
    if not df.empty:
        if "Data Inicial" in df.columns:
            df = sort_by_date_time(df, date_col="Data Inicial", time_col=None)
        df = append_total_row(df, label_column="Forma de Pagamento")
        df = replace_zero_with_dash(df)
        df = trim_empty_rows_cols(df)

    csv_path = output_dir / f"{prefix}.csv"
    xlsx_path = output_dir / f"{prefix}.xlsx"

    df.to_csv(csv_path, index=False, encoding="utf-8")
    df.to_excel(xlsx_path, index=False, engine="openpyxl")
    format_workbook(xlsx_path)

    return csv_path, xlsx_path


def save_csv(rows: list[CashRow], *, output_dir: Path, prefix: str) -> Path:
    if not rows:
        raise ValueError("No rows to save")

    output_dir.mkdir(parents=True, exist_ok=True)

    df = pd.DataFrame(rows)
    if not df.empty:
        if "Data Inicial" in df.columns:
            df = sort_by_date_time(df, date_col="Data Inicial", time_col=None)
        df = append_total_row(df, label_column="Forma de Pagamento")
        df = replace_zero_with_dash(df)
        df = trim_empty_rows_cols(df)
    csv_path = output_dir / f"{prefix}.csv"
    df.to_csv(csv_path, index=False, encoding="utf-8")
    return csv_path


def save_daily_payment_matrix_csv(
    rows: list[CashRow],
    *,
    output_dir: Path,
    prefix: str,
    day_order: list[str] | None = None,
) -> Path:
    """Save a matrix CSV.

    Columns:
    - Column A: Forma de Pagamento
    - Column B..: day (DD) extracted from Data Inicial (expected DD/MM/YYYY)
    Values are written as numeric values (formatting is handled by the sheet).
    """

    if not rows:
        raise ValueError("No rows to save")

    output_dir.mkdir(parents=True, exist_ok=True)

    df = pd.DataFrame(rows)
    if df.empty:
        raise ValueError("No rows to save")

    if "Forma de Pagamento" not in df.columns or "Data Inicial" not in df.columns or "Valor" not in df.columns:
        raise ValueError("Missing required columns for matrix export")

    # Preserve the order methods appeared in the source rows.
    method_order = [str(m) for m in df["Forma de Pagamento"].dropna().tolist()]
    seen_methods: set[str] = set()
    unique_method_order: list[str] = []
    for m in method_order:
        if m in seen_methods:
            continue
        seen_methods.add(m)
        unique_method_order.append(m)

    def _to_float(v: object) -> float:
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            return float(_extract_currency_value(v))
        return 0.0

    df["_valor_num"] = df["Valor"].apply(_to_float)

    # Day column name is only DD.
    day_raw = df["Data Inicial"].astype(str).str.strip()
    df["_day"] = day_raw.str.slice(0, 2)

    pivot = df.pivot_table(
        index="Forma de Pagamento",
        columns="_day",
        values="_valor_num",
        aggfunc="sum",
        fill_value=0.0,
    )
    pivot.columns.name = None

    # Apply stable ordering for methods.
    pivot = pivot.reindex(unique_method_order)

    # Apply requested day ordering (unique preserving order).
    if day_order:
        seen_days: set[str] = set()
        unique_days: list[str] = []
        for d in day_order:
            dd = str(d).zfill(2)
            if dd in seen_days:
                continue
            seen_days.add(dd)
            unique_days.append(dd)

        ordered = [d for d in unique_days if d in pivot.columns]
        remaining = [c for c in pivot.columns if c not in ordered]
        remaining = sorted(remaining, key=lambda x: int(x) if str(x).isdigit() else str(x))
        pivot = pivot.reindex(columns=ordered + remaining)
    else:
        pivot = pivot.reindex(columns=sorted(pivot.columns, key=lambda x: int(x) if str(x).isdigit() else str(x)))

    out = pivot.reset_index()
    if not out.empty:
        out = append_total_row(out, label_column=out.columns[0])
        out = replace_zero_with_dash(out, columns=out.columns[1:])

    csv_path = output_dir / f"{prefix}.csv"
    out.to_csv(csv_path, index=False, encoding="utf-8")
    return csv_path
