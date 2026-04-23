from __future__ import annotations

import json
import re
import threading
import time
import unicodedata
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable, Sequence
from zoneinfo import ZoneInfo

from selenium.common.exceptions import StaleElementReferenceException, TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from .appointments import navigate_to_reception
from .auth import Credentials, log
from .diagnostics import capture_artifacts


def _normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def _normalize_match(value: str) -> str:
    text = _normalize_spaces(value)
    text = "".join(
        ch
        for ch in unicodedata.normalize("NFD", text)
        if unicodedata.category(ch) != "Mn"
    )
    return text.casefold()


def _strip_non_digits(value: str) -> str:
    return re.sub(r"\D+", "", value or "")


def _normalize_tokens(value: str) -> list[str]:
    return [token for token in re.split(r"[^a-z0-9]+", _normalize_match(value)) if token]


def _text_matches_value(current: str, expected: str, *, token_threshold: int = 2) -> bool:
    current_text = _normalize_match(current)
    expected_text = _normalize_match(expected)
    if not current_text or not expected_text:
        return False
    if current_text == expected_text or expected_text in current_text or current_text in expected_text:
        return True

    current_tokens = _normalize_tokens(current)
    expected_tokens = _normalize_tokens(expected)
    if not current_tokens or not expected_tokens:
        return False

    common = set(current_tokens) & set(expected_tokens)
    if not common:
        return False

    shorter = min(len(current_tokens), len(expected_tokens))
    required = min(token_threshold, shorter)
    return len(common) >= required


def _is_generic_service_name(value: str) -> bool:
    normalized = _normalize_match(value)
    return normalized in {
        _normalize_match("Outro"),
        _normalize_match("Outros"),
        _normalize_match("Outro procedimento"),
        _normalize_match("Outros procedimentos"),
        _normalize_match("Outros procedimentos ou combinação"),
        _normalize_match("Outros procedimentos ou combinacao"),
        _normalize_match("Any"),
    }


@dataclass(frozen=True)
class BookingRequest:
    unit_name: str
    client_name: str
    appointment_date: str
    start_time: str
    end_time: str
    professional_name: str = ""
    procedure_name: str = ""
    service_name: str = ""
    service_candidates: tuple[str, ...] = ()
    appointment_type: str = ""
    notes: str = ""
    client_phone: str = ""
    client_cpf: str = ""
    customer_origin: str = ""
    dry_run: bool = False
    raw_payload: dict | None = None

    @classmethod
    def from_payload(cls, payload: dict, *, default_unit_name: str = "") -> "BookingRequest":
        if not isinstance(payload, dict):
            raise ValueError("payload must be a JSON object")

        payload = _coerce_payload(payload)

        unit_name = _first_text(payload, "unit", "unitName", "unidade", "unit_name") or default_unit_name
        client_name = _first_text(
            payload,
            "client_name",
            "clientName",
            "cliente",
            "cliente_nome",
            "customer_name",
            "name",
        )
        appointment_date = _coerce_date(_first_text(payload, "date", "data", "appointment_date", "appointmentDate"))

        start_time = _first_text(payload, "start_time", "startTime", "horario_inicio", "hora_inicio")
        end_time = _first_text(payload, "end_time", "endTime", "horario_fim", "hora_fim")
        time_range = _first_text(payload, "time_range", "timeRange", "horario", "time")
        duration_minutes = _first_int(payload, "duration_minutes", "durationMinutes", "duracao_minutos")
        start_time, end_time = _coerce_times(start_time, end_time, time_range, duration_minutes)

        doctor_slug = _first_text(payload, "doctorSlug", "doctor_slug")
        professional_name = _first_text(
            payload,
            "doctorName",
            "professional",
            "professional_name",
            "professionalName",
            "profissional",
            "injetor",
        )
        professional_name = _canonical_professional_name(professional_name, doctor_slug)
        procedure_name = _first_text(
            payload,
            "procedureName",
            "procedure_name",
            "procedimento",
            "procedure",
        )
        service_name = _first_text(payload, "serviceName", "service_name", "servico", "serviço", "service")
        service_candidates = tuple(_first_text_list(payload, "serviceCandidates", "service_candidates", "serviceKeywords", "service_keywords"))
        appointment_type = _first_text(
            payload,
            "appointment_type",
            "appointmentType",
            "tipo_agendamento",
            "tipo",
        )
        notes = _first_text(payload, "notes", "observacoes", "observações", "observation", "obs")
        client_phone = _first_text(payload, "phone", "whatsapp", "client_phone", "clientPhone")
        client_cpf = _first_text(payload, "cpf", "client_cpf", "clientCpf")
        customer_origin = _first_text(payload, "customer_origin", "customerOrigin", "origem", "origem_cliente")
        dry_run = _first_bool(payload, "dry_run", "dryRun")

        missing: list[str] = []
        if not unit_name:
            missing.append("unit_name")
        if not client_name:
            missing.append("client_name")
        if not appointment_date:
            missing.append("appointment_date")
        if not start_time:
            missing.append("start_time")
        if not end_time:
            missing.append("end_time")
        if not service_name and not appointment_type:
            missing.append("service_name")
        if missing:
            raise ValueError(f"missing required fields: {', '.join(missing)}")

        return cls(
            unit_name=unit_name,
            client_name=client_name,
            appointment_date=appointment_date,
            start_time=start_time,
            end_time=end_time,
            professional_name=professional_name,
            procedure_name=procedure_name,
            service_name=service_name,
            service_candidates=service_candidates,
            appointment_type=appointment_type,
            notes=notes,
            client_phone=client_phone,
            client_cpf=client_cpf,
            customer_origin=customer_origin,
            dry_run=dry_run,
            raw_payload=payload,
        )


@dataclass(frozen=True)
class BookingResult:
    ok: bool
    message: str
    request: BookingRequest
    current_url: str = ""
    html_path: str = ""
    screenshot_path: str = ""

    def to_dict(self) -> dict[str, object]:
        return {
            "ok": self.ok,
            "message": self.message,
            "request": asdict(self.request),
            "currentUrl": self.current_url,
            "htmlPath": self.html_path,
            "screenshotPath": self.screenshot_path,
        }


class BookingError(RuntimeError):
    pass


def _canonical_professional_name(name: str, doctor_slug: str = "") -> str:
    normalized_name = _normalize_match(name)
    normalized_slug = _normalize_match(doctor_slug)
    alias_to_canonical = {
        _normalize_match("dragabrielamenegat"): "Gabriela Menegat",
        _normalize_match("drajosielesouza"): "Josiele Maiara de Souza",
        _normalize_match("drmarcelogsoares"): "Marcelo Gomes Soares",
        _normalize_match("dramarinalima"): "Marina Pereira Lima",
        _normalize_match("drraulrosariojunior"): "Raul Rosario Junior",
        _normalize_match("drasamarassilva"): "Samara Silva",
        _normalize_match("drviniciusvieira"): "Vinícius Vieira",
        _normalize_match("dravivianemondin"): "Viviane Mondin",
        _normalize_match("dr. gabriela menegat"): "Gabriela Menegat",
        _normalize_match("gabriela menegat"): "Gabriela Menegat",
        _normalize_match("dra. josiele de souza"): "Josiele Maiara de Souza",
        _normalize_match("dra. josiele maiara de souza"): "Josiele Maiara de Souza",
        _normalize_match("josiele de souza"): "Josiele Maiara de Souza",
        _normalize_match("josiele maiara de souza"): "Josiele Maiara de Souza",
        _normalize_match("dr. marcelo soares"): "Marcelo Gomes Soares",
        _normalize_match("dr. marcelo gomes soares"): "Marcelo Gomes Soares",
        _normalize_match("marcelo soares"): "Marcelo Gomes Soares",
        _normalize_match("marcelo gomes soares"): "Marcelo Gomes Soares",
        _normalize_match("dra. marina lima"): "Marina Pereira Lima",
        _normalize_match("dra. marina pereira lima"): "Marina Pereira Lima",
        _normalize_match("marina lima"): "Marina Pereira Lima",
        _normalize_match("marina pereira lima"): "Marina Pereira Lima",
        _normalize_match("dr. raul rosario junior"): "Raul Rosario Junior",
        _normalize_match("raul rosario junior"): "Raul Rosario Junior",
        _normalize_match("dra. samara silva"): "Samara Silva",
        _normalize_match("samara silva"): "Samara Silva",
        _normalize_match("dr. vinicius vieira"): "Vinícius Vieira",
        _normalize_match("dr. vinícius vieira"): "Vinícius Vieira",
        _normalize_match("vinicius vieira"): "Vinícius Vieira",
        _normalize_match("vinícius vieira"): "Vinícius Vieira",
        _normalize_match("dra. viviane mondin"): "Viviane Mondin",
        _normalize_match("viviane mondin"): "Viviane Mondin",
    }
    if normalized_slug and normalized_slug in alias_to_canonical:
        return alias_to_canonical[normalized_slug]
    if normalized_name and normalized_name in alias_to_canonical:
        return alias_to_canonical[normalized_name]
    return _normalize_spaces(name)


def _coerce_payload(payload: dict) -> dict:
    booking = payload.get("booking")
    if not isinstance(booking, dict):
        return payload

    flattened = dict(payload)
    flattened.update(booking)

    service = booking.get("service")
    if isinstance(service, dict):
        if "serviceName" not in flattened and service.get("name"):
            flattened["serviceName"] = service.get("name")
        if "serviceId" not in flattened and service.get("id"):
            flattened["serviceId"] = service.get("id")
        if "serviceCandidates" not in flattened:
            candidates = service.get("candidates")
            if isinstance(candidates, (list, tuple)) and candidates:
                flattened["serviceCandidates"] = candidates
            else:
                subtitle = _normalize_spaces(str(service.get("subtitle") or ""))
                if subtitle:
                    flattened["serviceCandidates"] = [part for part in re.split(r"[,\n;|]+", subtitle) if _normalize_spaces(part)]

    selected_services = booking.get("selectedServices")
    if isinstance(selected_services, (list, tuple)):
        selected_candidates: list[str] = []
        for item in selected_services:
            if isinstance(item, dict):
                name = _normalize_spaces(str(item.get("name") or ""))
            else:
                name = _normalize_spaces(str(item))
            if name and name not in selected_candidates:
                selected_candidates.append(name)
        if selected_candidates:
            existing_candidates = _first_text_list(flattened, "serviceCandidates", "service_candidates")
            merged_candidates = [*existing_candidates]
            for candidate in selected_candidates:
                if candidate not in merged_candidates:
                    merged_candidates.append(candidate)
            if merged_candidates:
                flattened["serviceCandidates"] = merged_candidates

    procedure = booking.get("procedure")
    if isinstance(procedure, dict):
        if "procedureName" not in flattened and procedure.get("name"):
            flattened["procedureName"] = procedure.get("name")
        if "procedureId" not in flattened and procedure.get("id"):
            flattened["procedureId"] = procedure.get("id")

    includes = booking.get("includes")
    if isinstance(includes, dict) and "appointmentType" not in flattened and "appointment_type" not in flattened:
        if includes.get("procedimento"):
            flattened["appointmentType"] = "Procedimento"
        elif includes.get("avaliacao"):
            flattened["appointmentType"] = "Avaliação"
        elif includes.get("revisao"):
            flattened["appointmentType"] = "Revisão"

    unit_slug = _normalize_spaces(str(booking.get("unitSlug") or ""))
    if unit_slug and "unit" not in flattened and "unitName" not in flattened:
        flattened["unitName"] = _map_unit_slug(unit_slug)

    patient_name = booking.get("patientName")
    if patient_name and "clientName" not in flattened and "client_name" not in flattened:
        flattened["clientName"] = patient_name

    notes = booking.get("notes")
    if notes and "notes" not in flattened:
        flattened["notes"] = notes

    is_website_booking = _normalize_match(str(payload.get("event") or "")) == _normalize_match("booking.created")
    if is_website_booking and not _first_text(flattened, "customer_origin", "customerOrigin", "origem", "origem_cliente"):
        flattened["customerOrigin"] = "Site"

    start_at_ms = booking.get("startAtMs")
    end_at_ms = booking.get("endAtMs")
    if start_at_ms not in {None, ""}:
        date_value, start_value = _ms_to_sao_paulo_date_time(start_at_ms)
        flattened.setdefault("appointmentDate", date_value)
        flattened.setdefault("startTime", start_value)
    if end_at_ms not in {None, ""}:
        _, end_value = _ms_to_sao_paulo_date_time(end_at_ms)
        flattened.setdefault("endTime", end_value)

    return flattened


def _map_unit_slug(value: str) -> str:
    normalized = _normalize_match(value)
    aliases = {
        "barrashoppingsul": "BarraShoppingSul",
        "barra shopping sul": "BarraShoppingSul",
        "novohamburgo": "Novo Hamburgo",
        "novo-hamburgo": "Novo Hamburgo",
        "novo hamburgo": "Novo Hamburgo",
    }
    return aliases.get(normalized, value)


def _ms_to_sao_paulo_date_time(value: object) -> tuple[str, str]:
    try:
        timestamp_ms = int(str(value).strip())
    except Exception as exc:
        raise ValueError(f"invalid timestamp value: {value!r}") from exc
    dt = datetime.fromtimestamp(timestamp_ms / 1000, tz=ZoneInfo("America/Sao_Paulo"))
    return dt.strftime("%d/%m/%Y"), dt.strftime("%H:%M")


def _first_text(payload: dict, *keys: str) -> str:
    for key in keys:
        value = payload.get(key)
        if value is None:
            continue
        text = _normalize_spaces(str(value))
        if text:
            return text
    return ""


def _first_int(payload: dict, *keys: str) -> int | None:
    for key in keys:
        value = payload.get(key)
        if value in {None, ""}:
            continue
        try:
            return int(str(value).strip())
        except Exception:
            continue
    return None


def _first_text_list(payload: dict, *keys: str) -> list[str]:
    values: list[str] = []
    for key in keys:
        raw = payload.get(key)
        if raw is None or raw == "":
            continue
        items: Iterable[object]
        if isinstance(raw, (list, tuple)):
            items = raw
        else:
            items = re.split(r"[,\n;|]+", str(raw))
        for item in items:
            text = _normalize_spaces(str(item))
            if text and text not in values:
                values.append(text)
        if values:
            return values
    return []


def _first_bool(payload: dict, *keys: str) -> bool:
    for key in keys:
        if key not in payload:
            continue
        value = payload.get(key)
        if isinstance(value, bool):
            return value
        text = _normalize_match(str(value))
        if text in {"1", "true", "yes", "y", "sim", "s"}:
            return True
        if text in {"0", "false", "no", "n", "nao", "não"}:
            return False
    return False


def _coerce_date(value: str) -> str:
    text = _normalize_spaces(value)
    if not text:
        return ""
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%d/%m/%Y")
        except ValueError:
            continue
    raise ValueError(f"invalid appointment_date: {value!r}")


def _coerce_times(start: str, end: str, time_range: str, duration_minutes: int | None) -> tuple[str, str]:
    start = _normalize_time(start)
    end = _normalize_time(end)
    if (not start or not end) and time_range:
        match = re.findall(r"\b\d{1,2}:\d{2}\b", time_range)
        if len(match) >= 2:
            start = start or _normalize_time(match[0])
            end = end or _normalize_time(match[1])
    if start and not end and duration_minutes:
        dt = datetime.strptime(start, "%H:%M") + timedelta(minutes=duration_minutes)
        end = dt.strftime("%H:%M")
    return start, end


def _normalize_time(value: str) -> str:
    text = _normalize_spaces(value)
    if not text:
        return ""
    match = re.search(r"\b(\d{1,2}):(\d{2})\b", text)
    if not match:
        raise ValueError(f"invalid time value: {value!r}")
    hour = int(match.group(1))
    minute = int(match.group(2))
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError(f"invalid time value: {value!r}")
    return f"{hour:02d}:{minute:02d}"


def _wait_for_body_text(driver: WebDriver, expected: str, *, timeout: int = 30) -> None:
    target = _normalize_match(expected)

    def _body_contains(_driver: WebDriver) -> bool:
        try:
            text = _normalize_match(_driver.find_element(By.TAG_NAME, "body").text)
        except Exception:
            return False
        return target in text

    WebDriverWait(driver, timeout).until(_body_contains)


def _wait_for_any_body_text(driver: WebDriver, expected_values: Sequence[str], *, timeout: int = 30) -> None:
    targets = [_normalize_match(value) for value in expected_values if _normalize_spaces(value)]

    def _body_contains(_driver: WebDriver) -> bool:
        try:
            text = _normalize_match(_driver.find_element(By.TAG_NAME, "body").text)
        except Exception:
            return False
        return any(target in text for target in targets)

    WebDriverWait(driver, timeout).until(_body_contains)


def _find_visible_elements(driver: WebDriver, xpaths: Sequence[str]) -> list:
    found: list = []
    for xpath in xpaths:
        try:
            for el in driver.find_elements(By.XPATH, xpath):
                if el.is_displayed():
                    found.append(el)
        except Exception:
            continue
    return found


def _click_by_text(driver: WebDriver, texts: Sequence[str], *, timeout: int = 15) -> bool:
    deadline = time.time() + timeout
    normalized_targets = [_normalize_match(t) for t in texts if _normalize_spaces(t)]
    xpaths = [
        "//button",
        "//a",
        "//*[@role='button']",
        "//*[self::div or self::span][@tabindex='0']",
    ]
    while time.time() < deadline:
        for el in _find_visible_elements(driver, xpaths):
            try:
                text = _normalize_match(el.text)
            except Exception:
                continue
            if not text:
                continue
            if any(target == text or target in text or text in target for target in normalized_targets):
                try:
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", el)
                    driver.execute_script("arguments[0].click();", el)
                    return True
                except Exception:
                    continue
        time.sleep(0.25)
    return False


def _find_visible_dialog(driver: WebDriver):
    dialogs = driver.find_elements(By.XPATH, "//*[@role='dialog']")
    visible: list = []
    for dialog in dialogs:
        try:
            if dialog.is_displayed():
                visible.append(dialog)
        except Exception:
            continue
    if not visible:
        raise TimeoutException("visible dialog not found")
    return max(visible, key=lambda el: len(_normalize_spaces(el.text)))


def _find_booking_sheet(driver: WebDriver, *, timeout: int = 12):
    targets = (
        _normalize_match("Agendamento"),
        _normalize_match("Tipo do agendamento"),
        _normalize_match("Salvar"),
    )
    deadline = time.time() + timeout
    while time.time() < deadline:
        candidates = _find_visible_elements(driver, ["//*[@role='dialog']", "//div", "//section", "//aside"])
        best = None
        best_score = -1
        for candidate in candidates:
            try:
                text_raw = _normalize_spaces(candidate.text)
            except Exception:
                continue
            if not text_raw:
                continue
            text = _normalize_match(text_raw)
            score = sum(1 for target in targets if target in text)
            if score < 2:
                continue
            if len(text_raw) > 8000:
                continue
            if score > best_score:
                best = candidate
                best_score = score
        if best is not None:
            return best
        time.sleep(0.25)
    raise TimeoutException("booking sheet not found")


def _booking_dialog_still_open(driver: WebDriver) -> bool:
    try:
        dialog = _find_booking_sheet(driver, timeout=1)
    except Exception:
        return False
    text = _normalize_match(dialog.text)
    return any(
        target in text
        for target in (
            _normalize_match("Agendamento"),
            _normalize_match("Tipo do agendamento"),
            _normalize_match("Nome do cliente"),
            _normalize_match("WhatsApp do cliente"),
        )
    )


def _find_injector_access_modal(driver: WebDriver):
    modal_markers = (
        _normalize_match("Acesso injetor"),
        _normalize_match("Escaneie o QR Code"),
        _normalize_match("Instruções"),
    )
    for dialog in driver.find_elements(By.XPATH, "//*[@role='dialog']"):
        try:
            if not dialog.is_displayed():
                continue
            text = _normalize_match(dialog.text)
        except Exception:
            continue
        if any(marker in text for marker in modal_markers):
            return dialog
    return None


def _dismiss_injector_access_modal(driver: WebDriver, *, timeout: int = 4) -> bool:
    deadline = time.time() + timeout
    dismissed = False

    while time.time() < deadline:
        modal = _find_injector_access_modal(driver)
        if modal is None:
            return dismissed
        dismissed = True

        try:
            modal_rect = driver.execute_script(
                """
                const rect = arguments[0].getBoundingClientRect();
                return {left: rect.left, top: rect.top, width: rect.width, height: rect.height};
                """,
                modal,
            )
        except Exception:
            modal_rect = None

        close_candidates: list = []
        seen_ids: set[str] = set()
        try:
            raw_candidates = modal.find_elements(
                By.XPATH,
                ".//button | .//*[@role='button'] | .//*[contains(@class,'icon-x')] | .//*[contains(@class,'ph-x')]",
            )
        except Exception:
            raw_candidates = []

        for raw_candidate in raw_candidates:
            candidates_to_try = [raw_candidate]
            current = raw_candidate
            for _ in range(4):
                try:
                    current = current.find_element(By.XPATH, "./..")
                except Exception:
                    break
                candidates_to_try.append(current)
            for candidate in candidates_to_try:
                try:
                    if not candidate.is_displayed():
                        continue
                    candidate_id = getattr(candidate, "id", None) or ""
                except Exception:
                    continue
                if candidate_id in seen_ids:
                    continue
                seen_ids.add(candidate_id)
                close_candidates.append(candidate)

        scored: list[tuple[float, object]] = []
        for candidate in close_candidates:
            try:
                text = _normalize_match(candidate.text)
                aria = _normalize_match(candidate.get_attribute("aria-label") or "")
                title = _normalize_match(candidate.get_attribute("title") or "")
                class_name = _normalize_match(candidate.get_attribute("class") or "")
                rect = driver.execute_script(
                    """
                    const rect = arguments[0].getBoundingClientRect();
                    return {left: rect.left, top: rect.top, width: rect.width, height: rect.height};
                    """,
                    candidate,
                )
            except Exception:
                continue
            width = float(rect.get("width") or 0)
            height = float(rect.get("height") or 0)
            if width <= 0 or height <= 0:
                continue
            center_x = float(rect.get("left") or 0) + width / 2
            center_y = float(rect.get("top") or 0) + height / 2
            in_top_right = False
            if modal_rect:
                modal_left = float(modal_rect.get("left") or 0)
                modal_top = float(modal_rect.get("top") or 0)
                modal_width = float(modal_rect.get("width") or 0)
                modal_height = float(modal_rect.get("height") or 0)
                in_top_right = (
                    center_x >= modal_left + modal_width * 0.62
                    and center_y <= modal_top + modal_height * 0.32
                )
            area = width * height
            keyword_score = 0
            if any(
                token in text or token in aria or token in title or token in class_name
                for token in ("fechar", "close", "icon-x", "ph-x", "xmark")
            ):
                keyword_score += 500000
            if in_top_right:
                keyword_score += 250000
            score = keyword_score - area + center_x - center_y
            scored.append((score, candidate))

        scored.sort(key=lambda item: item[0], reverse=True)

        for _, candidate in scored:
            if not _real_click(driver, candidate):
                continue
            time.sleep(0.35)
            if _find_injector_access_modal(driver) is None:
                return True

        try:
            driver.execute_script(
                """
                for (const dialog of Array.from(document.querySelectorAll('[role="dialog"]'))) {
                  const text = (dialog.innerText || '').toLowerCase();
                  if (!text.includes('acesso injetor') && !text.includes('escaneie o qr code')) continue;
                  dialog.style.display = 'none';
                  dialog.setAttribute('aria-hidden', 'true');
                  let parent = dialog.parentElement;
                  for (let i = 0; i < 3 && parent; i += 1) {
                    const parentText = (parent.innerText || '').toLowerCase();
                    if (parentText.includes('acesso injetor') || parentText.includes('escaneie o qr code')) {
                      parent.style.display = 'none';
                      parent.setAttribute('aria-hidden', 'true');
                    }
                    parent = parent.parentElement;
                  }
                }
                """,
            )
        except Exception:
            pass
        time.sleep(0.2)
        if _find_injector_access_modal(driver) is None:
            return True

    return dismissed


def _date_to_iso(date_ddmmyyyy: str) -> str:
    return datetime.strptime(date_ddmmyyyy, "%d/%m/%Y").strftime("%Y-%m-%d")


def _split_time_range(value: str) -> tuple[str, str]:
    normalized = _normalize_spaces(value)
    times = re.findall(r"\b\d{1,2}:\d{2}\b", normalized)
    if not times:
        return "", ""
    if len(times) == 1:
        return _normalize_time(times[0]), ""
    return _normalize_time(times[0]), _normalize_time(times[1])


def _event_matches_request(row: dict[str, str], request: BookingRequest) -> bool:
    row_date = _normalize_spaces(row.get("Data", ""))
    row_title_raw = _normalize_spaces(row.get("Título", ""))
    row_title = _normalize_match(row_title_raw)
    row_start, row_end = _split_time_range(row.get("Horário", ""))

    if row_date != request.appointment_date:
        return False
    if row_start and row_start != request.start_time:
        return False
    if row_end and request.end_time and row_end != request.end_time:
        return False

    client_full = _normalize_match(request.client_name)
    client_anchor = _normalize_match(" ".join(_normalize_spaces(request.client_name).split()[:3]))
    title_client_part = _normalize_match(row_title_raw.split(" - ", 1)[0])
    if client_full not in row_title:
        partial_ok = False
        if client_anchor and client_anchor in row_title:
            partial_ok = True
        elif title_client_part:
            # Event titles can truncate client names in the calendar grid.
            partial_ok = title_client_part in client_full or client_full.startswith(title_client_part)
        if not partial_ok:
            return False
    return True


def _agenda_text_contains_request(driver: WebDriver, request: BookingRequest) -> bool:
    try:
        body_text = _normalize_match(driver.find_element(By.TAG_NAME, "body").text)
    except Exception:
        return False

    client_full = _normalize_match(request.client_name)
    client_anchor = _normalize_match(" ".join(_normalize_spaces(request.client_name).split()[:3]))
    time_range = _normalize_match(f"{request.start_time} - {request.end_time}")
    service = _normalize_match(request.service_name)

    if client_full and client_full in body_text and time_range in body_text:
        return True

    if client_anchor and client_anchor in body_text and time_range in body_text:
        return True

    if client_anchor and client_anchor in body_text and service and service in body_text:
        return True

    return False


def _calendar_event_xpath() -> str:
    return (
        '//div[contains(@class, "fc-daygrid-event-harness")]//a[contains(@class, "fc-event")]'
        ' | //a[contains(@class, "fc-event") and .//*[contains(@class, "fc-event-title")]]'
        ' | //div[contains(@class, "fc-event") and .//*[contains(@class, "fc-event-title")]]'
    )


def _event_element_date(driver: WebDriver, element) -> str:
    try:
        value = driver.execute_script(
            """
            const el = arguments[0];
            if (!el) return '';
            let cur = el;
            for (let i = 0; i < 10 && cur; i += 1) {
              if (cur.getAttribute && cur.getAttribute('data-date')) {
                return cur.getAttribute('data-date') || '';
              }
              cur = cur.parentElement;
            }
            return '';
            """,
            element,
        )
    except Exception:
        return ""
    return _normalize_spaces(str(value or ""))


def _event_element_matches_request(driver: WebDriver, element, request: BookingRequest) -> bool:
    try:
        if not element.is_displayed():
            return False
        text_raw = _normalize_spaces(element.text)
        text = _normalize_match(text_raw)
    except Exception:
        return False

    if not text:
        return False

    client_full = _normalize_match(request.client_name)
    client_anchor = _normalize_match(" ".join(_normalize_spaces(request.client_name).split()[:3]))
    time_range = _normalize_match(f"{request.start_time} - {request.end_time}")
    appointment_type = _normalize_match(_resolve_booking_type(request))
    event_date = _event_element_date(driver, element)
    target_date = _date_to_iso(request.appointment_date)
    if event_date and event_date != target_date:
        return False

    if time_range not in text and _normalize_match(request.start_time) not in text:
        return False

    if client_full not in text and client_anchor not in text:
        return False

    if appointment_type and appointment_type not in text:
        return False

    return True


def _find_calendar_event(driver: WebDriver, request: BookingRequest):
    for element in driver.find_elements(By.XPATH, _calendar_event_xpath()):
        if _event_element_matches_request(driver, element, request):
            return element
    return None


def _calendar_events_for_date(driver: WebDriver, appointment_date: str) -> list:
    target_iso = _date_to_iso(appointment_date)
    try:
        elements = driver.execute_script(
            """
            const targetDate = arguments[0];
            const selectors = [
              `.fc-timegrid-col[data-date="${targetDate}"] .fc-event`,
              `.fc-daygrid-day[data-date="${targetDate}"] .fc-event`,
              `[data-date="${targetDate}"] .fc-event`,
            ];
            const out = [];
            const seen = new Set();
            for (const selector of selectors) {
              for (const el of document.querySelectorAll(selector)) {
                if (seen.has(el)) continue;
                seen.add(el);
                out.push(el);
              }
            }
            return out;
            """,
            target_iso,
        )
    except Exception:
        return []
    return list(elements or [])


def _calendar_event_candidate_score(element, request: BookingRequest) -> int:
    try:
        text_raw = _normalize_spaces(element.text)
    except Exception:
        text_raw = ""
    text = _normalize_match(text_raw)
    score = 0
    client_full = _normalize_match(request.client_name)
    client_anchor = _normalize_match(" ".join(_normalize_spaces(request.client_name).split()[:3]))
    time_range = _normalize_match(f"{request.start_time} - {request.end_time}")
    start_time = _normalize_match(request.start_time)
    service = _normalize_match(request.service_name)
    if client_full and client_full in text:
        score += 10
    elif client_anchor and client_anchor in text:
        score += 6
    if time_range and time_range in text:
        score += 8
    elif start_time and start_time in text:
        score += 4
    if service and service in text:
        score += 2
    return score


def _verify_booking_in_date_candidates(driver: WebDriver, request: BookingRequest) -> bool:
    candidates = []
    for element in _calendar_events_for_date(driver, request.appointment_date):
        try:
            if not element.is_displayed():
                continue
        except Exception:
            continue
        candidates.append(element)

    candidates.sort(key=lambda element: _calendar_event_candidate_score(element, request), reverse=True)

    for element in candidates[:24]:
        if not _real_click(driver, element):
            continue
        try:
            if _verify_booking_modal_fields(driver, request):
                _close_booking_sheet(driver)
                return True
        except Exception:
            pass
        _close_booking_sheet(driver)
        time.sleep(0.2)
    return False


def _close_booking_sheet(driver: WebDriver) -> None:
    for xpath in (
        "//button[normalize-space()='Cancelar']",
        "//button[normalize-space()='Fechar']",
        "//button[normalize-space()='Voltar']",
        "//*[contains(@class, 'icon-x')]",
        "//*[contains(@class, 'ph-x')]",
    ):
        try:
            for el in driver.find_elements(By.XPATH, xpath):
                if not el.is_displayed():
                    continue
                if _real_click(driver, el):
                    time.sleep(0.6)
                    return
        except Exception:
            continue


def _verify_booking_modal_fields(driver: WebDriver, request: BookingRequest) -> bool:
    dialog = _find_booking_sheet(driver, timeout=10)

    expected_name = _normalize_spaces(request.client_name)
    actual_name = _input_value_by_placeholder(dialog, ["Digite o nome"])
    if _normalize_spaces(actual_name) != expected_name:
        return False

    if request.client_phone:
        expected_phone = _normalize_phone_for_ui(request.client_phone)
        actual_phone = _input_value_by_placeholder(dialog, ["Digite o WhatsApp"])
        if not _input_value_matches(actual_phone, expected_phone):
            return False

    if request.client_cpf:
        actual_cpf = _input_value_by_placeholder(dialog, ["Digite o CPF"])
        if not _input_value_matches(actual_cpf, request.client_cpf):
            return False

    if request.service_name:
        service_values: list[str] = []
        for value in [*request.service_candidates, request.service_name]:
            normalized = _normalize_spaces(value)
            if normalized and normalized not in service_values:
                service_values.append(normalized)
        if not _service_summary_contains_any(dialog, service_values):
            return False

    current_start, current_end = _read_sheet_datetimes(driver, dialog)
    expected_start = datetime.strptime(f"{request.appointment_date} {request.start_time}", "%d/%m/%Y %H:%M")
    expected_end = datetime.strptime(f"{request.appointment_date} {request.end_time}", "%d/%m/%Y %H:%M")
    if current_start and current_start != expected_start:
        return False
    if current_end and current_end != expected_end:
        return False

    return True


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


def _calendar_visible_date_bounds(driver: WebDriver) -> tuple[str, str, bool]:
    try:
        bounds = driver.execute_script(
            """
            const dates = Array.from(document.querySelectorAll('[data-date]'))
              .map((el) => (el.getAttribute('data-date') || '').trim())
              .filter((v) => /^\\d{4}-\\d{2}-\\d{2}$/.test(v))
              .sort();
            if (!dates.length) return { min: '', max: '', has: false };
            return { min: dates[0], max: dates[dates.length - 1], has: true };
            """
        ) or {"min": "", "max": "", "has": False}
        return (
            _normalize_spaces(str(bounds.get("min") or "")),
            _normalize_spaces(str(bounds.get("max") or "")),
            bool(bounds.get("has")),
        )
    except Exception:
        return "", "", False


def _ensure_date_visible(driver: WebDriver, target_date: str, *, timeout: int = 15) -> None:
    target_iso = _date_to_iso(target_date)
    deadline = time.time() + timeout

    while time.time() < deadline:
        min_date, max_date, has_dates = _calendar_visible_date_bounds(driver)
        if has_dates and min_date <= target_iso <= max_date:
            return

        if not has_dates:
            time.sleep(0.5)
            continue

        direction = "next" if target_iso > max_date else "prev"
        if not _click_calendar_nav(driver, direction):
            return
        time.sleep(0.8)


def _verify_booking_in_agenda(driver: WebDriver, request: BookingRequest, *, timeout: int = 40) -> bool:
    deadline = time.time() + timeout
    attempts = 0

    while time.time() < deadline:
        attempts += 1
        try:
            _ensure_date_visible(driver, request.appointment_date, timeout=10)
            event = _find_calendar_event(driver, request)
            if event is not None and _real_click(driver, event):
                if _verify_booking_modal_fields(driver, request):
                    _close_booking_sheet(driver)
                    return True
                _close_booking_sheet(driver)
            if _verify_booking_in_date_candidates(driver, request):
                return True
            if _agenda_text_contains_request(driver, request):
                return True
        except Exception:
            if _agenda_text_contains_request(driver, request):
                return True

        if attempts % 2 == 0:
            try:
                driver.refresh()
                _wait_for_any_body_text(driver, ["Agenda", "Marcar", "Data"], timeout=20)
            except Exception:
                pass
        time.sleep(2)

    return False


def _requested_slot_time(request: BookingRequest) -> str:
    return f"{request.start_time}:00"


def _requested_slot_click_plan(request: BookingRequest) -> tuple[str, float]:
    start = datetime.strptime(request.start_time, "%H:%M")
    base_minute = (start.minute // 30) * 30
    offset_minutes = start.minute - base_minute
    base_time = f"{start.hour:02d}:{base_minute:02d}:00"
    click_fraction = min(max((offset_minutes / 30) + 0.25, 0.2), 0.8)
    return base_time, click_fraction


def _click_calendar_slot(driver: WebDriver, request: BookingRequest) -> bool:
    try:
        _ensure_date_visible(driver, request.appointment_date, timeout=10)
        base_time, click_fraction = _requested_slot_click_plan(request)
        clicked = driver.execute_script(
            """
            const targetDate = arguments[0];
            const targetTime = arguments[1];
            const clickFraction = arguments[2];
            const slot = document.querySelector(`td.fc-timegrid-slot-lane[data-time="${targetTime}"]`);
            const col = document.querySelector(`td.fc-timegrid-col[data-date="${targetDate}"]`);
            if (!slot || !col) return false;
            slot.scrollIntoView({ block: 'center' });
            const cr = col.getBoundingClientRect();
            const sr = slot.getBoundingClientRect();
            const x = Math.floor(cr.left + cr.width / 2);
            const y = Math.floor(sr.top + (sr.height * clickFraction));
            const target = document.elementsFromPoint(x, y).find((el) => el instanceof HTMLElement) || document.elementFromPoint(x, y);
            if (!target) return false;
            for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
              target.dispatchEvent(new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
                button: 0,
              }));
            }
            return true;
            """,
            _date_to_iso(request.appointment_date),
            base_time,
            click_fraction,
        )
        return bool(clicked)
    except Exception:
        return False


def _click_text_in_scope(scope, texts: Sequence[str]) -> bool:
    normalized_targets = [_normalize_match(t) for t in texts if _normalize_spaces(t)]
    xpaths = [
        ".//button",
        ".//a",
        ".//*[@role='button']",
        ".//*[self::div or self::span][@tabindex='0']",
        ".//*[self::div or self::span][contains(@class, 'chip') or contains(@class, 'tag')]",
    ]
    for xpath in xpaths:
        try:
            elements = scope.find_elements(By.XPATH, xpath)
        except Exception:
            continue
        for el in elements:
            try:
                if not el.is_displayed():
                    continue
                text = _normalize_match(el.text)
            except Exception:
                continue
            if not text:
                continue
            if any(target == text or target in text or text in target for target in normalized_targets):
                try:
                    if _real_click(el.parent, el):
                        return True
                except Exception:
                    continue
    return False


def _scope_has_pressed_text(scope, texts: Sequence[str]) -> bool:
    normalized_targets = [_normalize_match(t) for t in texts if _normalize_spaces(t)]
    xpaths = [
        ".//button[@aria-pressed='true']",
        ".//*[@role='button'][@aria-pressed='true']",
        ".//*[@data-selected='true']",
        ".//*[contains(@class, 'is-selected')]",
    ]
    for xpath in xpaths:
        try:
            elements = scope.find_elements(By.XPATH, xpath)
        except Exception:
            continue
        for el in elements:
            try:
                if not el.is_displayed():
                    continue
                text = _normalize_match(el.text)
            except Exception:
                continue
            if not text:
                continue
            if any(target == text or target in text or text in target for target in normalized_targets):
                return True
    return False


def _visible_button(driver: WebDriver, texts: Sequence[str], *, timeout: int = 20):
    deadline = time.time() + timeout
    normalized_targets = [_normalize_match(t) for t in texts if _normalize_spaces(t)]
    while time.time() < deadline:
        for el in driver.find_elements(By.XPATH, "//button | //*[@role='button']"):
            try:
                if not el.is_displayed():
                    continue
                text = _normalize_match(el.text)
                disabled = _normalize_match(el.get_attribute("aria-disabled") or "") == "true"
                disabled = disabled or (el.get_attribute("disabled") is not None)
            except Exception:
                continue
            if disabled or not text:
                continue
            if any(target == text or target in text or text in target for target in normalized_targets):
                return el
        time.sleep(0.25)
    raise TimeoutException(f"button not found for texts={texts!r}")


def _click_button(driver: WebDriver, texts: Sequence[str], *, timeout: int = 20) -> bool:
    try:
        button = _visible_button(driver, texts, timeout=timeout)
    except TimeoutException:
        return False
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", button)
    driver.execute_script("arguments[0].click();", button)
    return True


def _dispatch_input_events(driver: WebDriver, element) -> None:
    driver.execute_script(
        """
        const el = arguments[0];
        el.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: null,
        }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        """,
        element,
    )


def _real_click(driver: WebDriver, element) -> bool:
    try:
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
    except Exception:
        pass
    try:
        element.click()
        return True
    except Exception:
        pass
    try:
        driver.execute_script(
            """
            const el = arguments[0];
            const rect = el.getBoundingClientRect();
            const x = Math.floor(rect.left + rect.width / 2);
            const y = Math.floor(rect.top + rect.height / 2);
            for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
              el.dispatchEvent(new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
                button: 0,
              }));
            }
            """,
            element,
        )
        return True
    except Exception:
        return False


def _set_input_value(driver: WebDriver, element, value: str) -> None:
    driver.execute_script(
        """
        const el = arguments[0];
        const value = arguments[1];
        el.focus();
        if (el.isContentEditable || (el.getAttribute('contenteditable') || '').toLowerCase() === 'true') {
          const paragraph = document.createElement('p');
          paragraph.textContent = value;
          el.replaceChildren(paragraph);
          const selection = window.getSelection && window.getSelection();
          if (selection) {
            const range = document.createRange();
            range.selectNodeContents(paragraph);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        } else if ('value' in el) {
          const proto = el.tagName === 'TEXTAREA'
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) {
            setter.call(el, value);
          } else {
            el.value = value;
          }
        } else {
          el.textContent = value;
        }
        """,
        element,
        value,
    )
    _dispatch_input_events(driver, element)


def _field_value(driver: WebDriver, element) -> str:
    try:
        return _normalize_spaces(
            driver.execute_script(
                """
                const el = arguments[0];
                if (el.isContentEditable || (el.getAttribute('contenteditable') || '').toLowerCase() === 'true') {
                  return (el.innerText || el.textContent || '').trim();
                }
                return (el.value || '').trim();
                """,
                element,
            )
            or ""
        )
    except Exception:
        try:
            return _normalize_spaces((element.get_attribute("value") or "").strip())
        except Exception:
            return ""


def _find_container_by_labels(scope, labels: Sequence[str], *, timeout: int = 12):
    normalized_labels = [_normalize_match(label) for label in labels if _normalize_spaces(label)]
    deadline = time.time() + timeout
    while time.time() < deadline:
        containers = scope.find_elements(
            By.XPATH,
            "//*[self::div or self::section or self::fieldset or self::form or self::label][.//input or .//textarea or .//select or .//*[@role='combobox'] or .//*[@contenteditable='true'] or .//button]",
        )
        best = None
        best_len = 10**9
        for container in containers:
            try:
                if not container.is_displayed():
                    continue
                text_raw = _normalize_spaces(container.text)
                text = _normalize_match(text_raw)
            except Exception:
                continue
            if not text:
                continue
            if len(text_raw) > 3000:
                continue
            if any(label in text for label in normalized_labels):
                if len(text_raw) < best_len:
                    best = container
                    best_len = len(text_raw)
        if best is not None:
            return best
        time.sleep(0.25)
    raise TimeoutException(f"container not found for labels={labels!r}")


def _find_input_in_container(container):
    xpaths = [
        ".//input[not(@type='hidden')]",
        ".//textarea",
        ".//select",
        ".//*[@role='combobox']",
        ".//*[@contenteditable='true']",
    ]
    for xpath in xpaths:
        try:
            for el in container.find_elements(By.XPATH, xpath):
                if el.is_displayed():
                    return el
        except Exception:
            continue
    raise TimeoutException("input not found inside container")


def _fill_field_by_labels(driver: WebDriver, scope, labels: Sequence[str], value: str, *, timeout: int = 15) -> bool:
    value = _normalize_spaces(value)
    if not value:
        return False
    try:
        container = _find_container_by_labels(scope, labels, timeout=timeout)
        field = _find_input_in_container(container)
        _set_input_value(driver, field, value)
        current = _field_value(driver, field)
        if _input_value_matches(current, value):
            return True
        try:
            field.click()
            field.send_keys(value)
        except Exception:
            return False
        current = _field_value(driver, field)
        return _input_value_matches(current, value)
    except Exception:
        return False


def _open_dropdown_by_labels(driver: WebDriver, scope, labels: Sequence[str], *, timeout: int = 15) -> bool:
    try:
        container = _find_container_by_labels(scope, labels, timeout=timeout)
    except Exception:
        return False

    xpaths = [
        ".//*[@role='combobox']",
        ".//button",
        ".//input[not(@type='hidden')]",
        ".//*[contains(@class, 'dropdown')]",
        ".//*[contains(@class, 'select')]",
    ]
    for xpath in xpaths:
        try:
            for el in container.find_elements(By.XPATH, xpath):
                if not el.is_displayed():
                    continue
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", el)
                driver.execute_script("arguments[0].click();", el)
                return True
        except Exception:
            continue
    try:
        driver.execute_script("arguments[0].click();", container)
        return True
    except Exception:
        return False


def _select_option(driver: WebDriver, value: str, *, timeout: int = 15) -> bool:
    targets = {_normalize_match(value)}
    digits = _strip_non_digits(value)
    deadline = time.time() + timeout
    while time.time() < deadline:
        options = driver.find_elements(
            By.XPATH,
            "//div[contains(@class, 'dropdown__content')]//*[self::div or self::p or self::span or self::li or self::button] | //*[self::div or self::p or self::span or self::li or self::button][@role='option']",
        )
        for el in options:
            try:
                if not el.is_displayed():
                    continue
                text = _normalize_match(el.text)
            except Exception:
                continue
            if not text:
                continue
            if any(target in text or text in target for target in targets) or _text_matches_value(text, value):
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", el)
                driver.execute_script("arguments[0].click();", el)
                return True
            if digits and digits in _strip_non_digits(text):
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", el)
                driver.execute_script("arguments[0].click();", el)
                return True
        time.sleep(0.25)
    return False


def _fill_input_by_placeholder(driver: WebDriver, scope, placeholders: Sequence[str], value: str, *, timeout: int = 12) -> bool:
    targets = [_normalize_match(item) for item in placeholders if _normalize_spaces(item)]
    deadline = time.time() + timeout
    while time.time() < deadline:
        for el in scope.find_elements(By.XPATH, ".//input[not(@type='hidden')] | .//textarea"):
            try:
                if not el.is_displayed():
                    continue
                placeholder = _normalize_match(el.get_attribute("placeholder") or "")
            except Exception:
                continue
            if not placeholder:
                continue
            if any(target == placeholder or target in placeholder or placeholder in target for target in targets):
                try:
                    el.clear()
                except Exception:
                    pass
                _set_input_value(driver, el, value)
                current = _normalize_spaces(driver.execute_script("return arguments[0].value || '';", el) or "")
                if _input_value_matches(current, value):
                    return True
                try:
                    el.clear()
                except Exception:
                    pass
                try:
                    el.click()
                    el.send_keys(value)
                except Exception:
                    pass
                current = _normalize_spaces(driver.execute_script("return arguments[0].value || '';", el) or "")
                return _input_value_matches(current, value)
        time.sleep(0.25)
    return False


def _input_value_by_placeholder(scope, placeholders: Sequence[str]) -> str:
    targets = [_normalize_match(item) for item in placeholders if _normalize_spaces(item)]
    for el in scope.find_elements(By.XPATH, ".//input[not(@type='hidden')] | .//textarea"):
        try:
            if not el.is_displayed():
                continue
            placeholder = _normalize_match(el.get_attribute("placeholder") or "")
        except Exception:
            continue
        if not placeholder:
            continue
        if any(target == placeholder or target in placeholder or placeholder in target for target in targets):
            try:
                value = el.get_attribute("value") or ""
            except Exception:
                value = el.get_attribute("value") or ""
            return _normalize_spaces(value or "")
    return ""


def _input_value_matches(current: str, expected: str) -> bool:
    current_text = _normalize_spaces(current)
    expected_text = _normalize_spaces(expected)
    if current_text == expected_text:
        return True
    current_digits = _strip_non_digits(current_text)
    expected_digits = _strip_non_digits(expected_text)
    if expected_digits and current_digits == expected_digits:
        return True
    return False


def _normalize_phone_for_ui(value: str) -> str:
    digits = _strip_non_digits(value)
    if digits.startswith("55") and len(digits) in {12, 13}:
        digits = digits[2:]
    return digits


def _type_input_by_placeholder(driver: WebDriver, scope, placeholders: Sequence[str], value: str, *, timeout: int = 12) -> bool:
    typed_value = _normalize_spaces(value)
    if not typed_value:
        return False
    targets = [_normalize_match(item) for item in placeholders if _normalize_spaces(item)]
    deadline = time.time() + timeout
    while time.time() < deadline:
        for el in scope.find_elements(By.XPATH, ".//input[not(@type='hidden')] | .//textarea"):
            try:
                if not el.is_displayed():
                    continue
                placeholder = _normalize_match(el.get_attribute("placeholder") or "")
            except Exception:
                continue
            if not placeholder:
                continue
            if any(target == placeholder or target in placeholder or placeholder in target for target in targets):
                try:
                    driver.execute_script("arguments[0].focus();", el)
                    driver.execute_script("arguments[0].value = '';", el)
                    _dispatch_input_events(driver, el)
                except Exception:
                    pass
                try:
                    el.click()
                except Exception:
                    pass
                try:
                    for char in typed_value:
                        el.send_keys(char)
                        time.sleep(0.03)
                    el.send_keys(Keys.TAB)
                except Exception:
                    pass
                current = _normalize_spaces(driver.execute_script("return arguments[0].value || '';", el) or "")
                return _input_value_matches(current, typed_value)
        time.sleep(0.25)
    return False


def _find_multiselect_by_placeholder(scope, placeholders: Sequence[str], *, timeout: int = 12):
    targets = [_normalize_match(item) for item in placeholders if _normalize_spaces(item)]
    deadline = time.time() + timeout
    while time.time() < deadline:
        candidates = scope.find_elements(By.XPATH, ".//*[contains(@class, 'multiselect')]")
        for candidate in candidates:
            try:
                if not candidate.is_displayed():
                    continue
                text = _normalize_match(candidate.text)
            except Exception:
                continue
            if not text:
                continue
            if not any(target in text for target in targets):
                continue
            return candidate
        time.sleep(0.25)
    raise TimeoutException(f"multiselect not found for placeholders={placeholders!r}")


def _open_multiselect_by_placeholder(driver: WebDriver, scope, placeholders: Sequence[str], *, timeout: int = 12):
    try:
        candidate = _find_multiselect_by_placeholder(scope, placeholders, timeout=timeout)
    except Exception:
        return None

    def _is_open() -> bool:
        try:
            return bool(
                driver.execute_script(
                    """
                    const root = arguments[0];
                    const input = root.querySelector('.multiselect-search');
                    const dropdown = root.querySelector('.multiselect-dropdown');
                    if (!input || !dropdown) return false;
                    const expanded = (input.getAttribute('aria-expanded') || '').trim() === 'true';
                    const style = getComputedStyle(dropdown);
                    const visible = !dropdown.classList.contains('is-hidden') && style.display !== 'none' && style.visibility !== 'hidden';
                    return expanded && visible;
                    """,
                    candidate,
                )
            )
        except Exception:
            return False

    xpaths = [
        ".//*[@role='combobox']",
        ".//input[contains(@class, 'multiselect-search')]",
        ".//*[contains(@class, 'multiselect-wrapper')]",
        ".//*[contains(@class, 'multiselect-placeholder-el')]",
    ]
    for xpath in xpaths:
        try:
            for el in candidate.find_elements(By.XPATH, xpath):
                if not el.is_displayed():
                    continue
                if _real_click(driver, el):
                    time.sleep(0.2)
                    if _is_open():
                        return candidate
        except Exception:
            continue

    if _real_click(driver, candidate):
        time.sleep(0.2)
        if _is_open():
            return candidate

    try:
        input_el = candidate.find_element(By.XPATH, ".//input[contains(@class, 'multiselect-search')]")
        driver.execute_script(
            """
            const el = arguments[0];
            el.focus();
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            """,
            input_el,
        )
        time.sleep(0.2)
        if _is_open():
            return candidate
    except Exception:
        pass
    return None


def _multiselect_has_selected_label(scope, value: str) -> bool:
    for el in scope.find_elements(By.XPATH, ".//*[contains(@class, 'multiselect-single-label') and not(contains(@class, 'multiselect-single-label-el'))]"):
        try:
            if not el.is_displayed():
                continue
            text = el.text
        except Exception:
            continue
        if _text_matches_value(text, value):
            return True
    try:
        texts = (
            scope.parent.execute_script(
                """
                const root = arguments[0];
                return Array.from(
                  root.querySelectorAll(
                    '.multiselect-single-label, .multiselect-tag, .multiselect-label'
                  )
                ).filter((el) => {
                  const className = String(el.className || '');
                  if (className.includes('multiselect-single-label-el')) return false;
                  const option = el.closest('[role="option"], .multiselect-option');
                  if (option) return false;
                  return true;
                }).map((el) => (el.innerText || el.textContent || '').trim()).filter(Boolean);
                """,
                scope,
            )
            or []
        )
    except Exception:
        texts = []
    for text in texts:
        if _text_matches_value(str(text), value):
            return True
    return False


def _select_multiselect_option(driver: WebDriver, container, value: str, *, timeout: int = 15) -> bool:
    target = _normalize_match(value)
    digits = _strip_non_digits(value)
    deadline = time.time() + timeout

    def _selected_now() -> bool:
        return _multiselect_has_selected_label(container, value)

    def _finalize_selection() -> None:
        search = _search_input()
        if search is not None:
            for key in (Keys.ESCAPE, Keys.TAB):
                try:
                    search.send_keys(key)
                    time.sleep(0.1)
                except Exception:
                    continue
        try:
            driver.execute_script(
                """
                const root = arguments[0];
                const active = document.activeElement;
                if (active && typeof active.blur === 'function') {
                  active.blur();
                }
                const wrapper = root.querySelector('.multiselect-wrapper');
                if (wrapper && typeof wrapper.blur === 'function') {
                  wrapper.blur();
                }
                if (document.body) {
                  document.body.click();
                }
                """,
                container,
            )
        except Exception:
            pass
        time.sleep(0.2)

    def _search_input():
        try:
            return container.find_element(By.XPATH, ".//input[contains(@class, 'multiselect-search')]")
        except Exception:
            return None

    def _type_search(query: str) -> None:
        search = _search_input()
        if search is None:
            return
        try:
            driver.execute_script("arguments[0].focus();", search)
        except Exception:
            pass
        try:
            driver.execute_script("arguments[0].value = '';", search)
            _dispatch_input_events(driver, search)
        except Exception:
            pass
        try:
            search.clear()
        except Exception:
            pass
        try:
            search.send_keys(query)
        except Exception:
            _set_input_value(driver, search, query)
        _dispatch_input_events(driver, search)
        time.sleep(0.35)

    search_queries: list[str] = []
    normalized_value = _normalize_spaces(value)
    if normalized_value:
        search_queries.append(normalized_value)
    token_query = " ".join(_normalize_tokens(value)[:3]).strip()
    if token_query and token_query not in search_queries:
        search_queries.append(token_query)

    for query in search_queries:
        _type_search(query)
    if _selected_now():
        _finalize_selection()
        return True
    search = _search_input()
    if search is not None:
        for keys in ((Keys.ARROW_DOWN, Keys.ENTER), (Keys.ENTER,)):
            try:
                search.click()
            except Exception:
                pass
            try:
                for key in keys:
                    search.send_keys(key)
                    time.sleep(0.15)
            except Exception:
                pass
            if _selected_now():
                _finalize_selection()
                return True
    while time.time() < deadline:
        options = container.find_elements(By.XPATH, ".//*[@role='option'] | .//li[contains(@class, 'multiselect-option')]")
        for el in options:
            try:
                if not el.is_displayed():
                    continue
                text = _normalize_match(el.get_attribute("aria-label") or el.text)
            except Exception:
                continue
            if not text:
                continue
            if target in text or text in target or _text_matches_value(text, value) or (digits and digits in _strip_non_digits(text)):
                if _real_click(driver, el):
                    time.sleep(0.25)
                    if _selected_now():
                        _finalize_selection()
                        return True
                    search = _search_input()
                    if search is not None:
                        try:
                            search.send_keys(Keys.ENTER)
                            time.sleep(0.2)
                        except Exception:
                            pass
                        if _selected_now():
                            _finalize_selection()
                            return True
        try:
            dropdown = container.find_element(By.XPATH, ".//*[contains(@class, 'multiselect-dropdown')]")
            driver.execute_script("arguments[0].scrollTop = arguments[0].scrollTop + Math.max(arguments[0].clientHeight, 120);", dropdown)
        except Exception:
            pass
        time.sleep(0.25)
    return False


def _service_summary_contains(scope, value: str) -> bool:
    try:
        return bool(
            scope.parent.execute_script(
                """
                const scope = arguments[0];
                const rawValue = arguments[1];
                const normalize = (value) => (value || '')
                  .normalize('NFD')
                  .replace(/[\\u0300-\\u036f]/g, '')
                  .replace(/\\s+/g, ' ')
                  .trim()
                  .toLowerCase();
                const target = normalize(rawValue);
                if (!target) return false;

                const hasTrashIcon = (node) => {
                  if (!node) return false;
                  return !!node.querySelector('.ph-trash, .icon-trash, [class*="trash"]');
                };

                const textOf = (node) => normalize(node.innerText || node.textContent || '');
                const nodes = Array.from(scope.querySelectorAll('div, p, section, article'));

                return nodes.some((node) => {
                  const text = textOf(node);
                  if (!text || !text.includes(target)) return false;
                  if (text.includes('selecione o servico')) return false;
                  if (text.includes('servicos') && text === 'servicos') return false;
                  if (hasTrashIcon(node)) return true;
                  let parent = node.parentElement;
                  let depth = 0;
                  while (parent && depth < 4) {
                    if (hasTrashIcon(parent)) return true;
                    parent = parent.parentElement;
                    depth += 1;
                  }
                  return false;
                });
                """,
                scope,
                value,
            )
        )
    except Exception:
        return False


def _service_summary_contains_any(scope, values: Sequence[str]) -> bool:
    return any(_service_summary_contains(scope, value) for value in values if _normalize_spaces(value))


def _fill_or_select(driver: WebDriver, scope, labels: Sequence[str], value: str, *, timeout: int = 15) -> bool:
    if _fill_field_by_labels(driver, scope, labels, value, timeout=timeout):
        return True
    if _open_dropdown_by_labels(driver, scope, labels, timeout=timeout):
        if _select_option(driver, value, timeout=timeout):
            return True
    return False


def _select_or_fill(driver: WebDriver, scope, labels: Sequence[str], value: str, *, timeout: int = 15) -> bool:
    if _open_dropdown_by_labels(driver, scope, labels, timeout=timeout):
        if _select_option(driver, value, timeout=timeout):
            return True
    return _fill_field_by_labels(driver, scope, labels, value, timeout=timeout)


def _ensure_agenda_tab(driver: WebDriver) -> None:
    _click_button(driver, ["Agenda"], timeout=8)
    _wait_for_body_text(driver, "Marcar", timeout=20)


def _open_new_booking_sheet(driver: WebDriver, request: BookingRequest) -> None:
    if request.appointment_date and request.start_time and _click_calendar_slot(driver, request):
        _find_booking_sheet(driver, timeout=20)
        return

    button = _visible_button(driver, ["Marcar"], timeout=20)
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", button)
    driver.execute_script("arguments[0].click();", button)
    _find_booking_sheet(driver, timeout=20)


def _resolve_booking_type(request: BookingRequest) -> str:
    for candidate in (request.procedure_name, request.appointment_type, request.service_name):
        normalized = _normalize_match(candidate)
        if normalized in {
            _normalize_match("Avaliação"),
            _normalize_match("Procedimento"),
            _normalize_match("Revisão"),
            _normalize_match("Gift Card"),
            _normalize_match("Compra Antecipada"),
        }:
            return candidate
    return ""


def _should_fill_service(request: BookingRequest) -> bool:
    service_name = _normalize_spaces(request.service_name)
    if not service_name:
        return False
    booking_type = _normalize_match(_resolve_booking_type(request))
    if booking_type in {
        _normalize_match("Avaliação"),
        _normalize_match("Revisão"),
        _normalize_match("Gift Card"),
        _normalize_match("Compra Antecipada"),
    }:
        return False
    if _is_generic_service_name(service_name):
        meaningful_candidates = [value for value in request.service_candidates if not _is_generic_service_name(value)]
        if booking_type in {
            _normalize_match("Avaliação"),
            _normalize_match("Revisão"),
            _normalize_match("Gift Card"),
            _normalize_match("Compra Antecipada"),
        } and not meaningful_candidates:
            return False
    if request.service_candidates:
        return True
    if booking_type and _normalize_match(service_name) == booking_type:
        return False
    return True


def _parse_sheet_datetime(text: str) -> datetime | None:
    match = re.search(r"(\d{2}/\d{2}/\d{2,4})\s+(\d{2}:\d{2})", _normalize_spaces(text))
    if not match:
        return None
    date_part = match.group(1)
    time_part = match.group(2)
    for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%y %H:%M"):
        try:
            return datetime.strptime(f"{date_part} {time_part}", fmt)
        except ValueError:
            continue
    return None


def _expected_sheet_datetimes(request: BookingRequest) -> tuple[datetime, datetime]:
    return (
        datetime.strptime(f"{request.appointment_date} {request.start_time}", "%d/%m/%Y %H:%M"),
        datetime.strptime(f"{request.appointment_date} {request.end_time}", "%d/%m/%Y %H:%M"),
    )


_MONTH_TEXT_TO_NUMBER = {
    "jan": 1,
    "jan.": 1,
    "fev": 2,
    "fev.": 2,
    "feb": 2,
    "mar": 3,
    "mar.": 3,
    "abr": 4,
    "abr.": 4,
    "apr": 4,
    "apr.": 4,
    "mai": 5,
    "mai.": 5,
    "may": 5,
    "jun": 6,
    "jun.": 6,
    "jul": 7,
    "jul.": 7,
    "ago": 8,
    "ago.": 8,
    "aug": 8,
    "aug.": 8,
    "set": 9,
    "set.": 9,
    "sep": 9,
    "sep.": 9,
    "out": 10,
    "out.": 10,
    "oct": 10,
    "oct.": 10,
    "nov": 11,
    "nov.": 11,
    "dez": 12,
    "dez.": 12,
    "dec": 12,
    "dec.": 12,
}


def _read_sheet_datetimes(driver: WebDriver, scope) -> tuple[datetime | None, datetime | None]:
    try:
        values = driver.execute_script(
            """
            const scope = arguments[0];
            return Array.from(scope.querySelectorAll('[aria-label="Datepicker input"][role="textbox"]'))
              .map((el) => (el.innerText || '').trim());
            """,
            scope,
        ) or []
    except Exception:
        values = []
    parsed = [_parse_sheet_datetime(str(value)) for value in values]
    while len(parsed) < 2:
        parsed.append(None)
    return parsed[0], parsed[1]


def _request_datetime_ms(request: BookingRequest) -> tuple[int, int]:
    raw_payload = request.raw_payload or {}
    booking = raw_payload.get("booking") if isinstance(raw_payload.get("booking"), dict) else {}
    start_at_ms = booking.get("startAtMs") if isinstance(booking, dict) else None
    end_at_ms = booking.get("endAtMs") if isinstance(booking, dict) else None

    def _coerce_ms(value: object) -> int | None:
        try:
            return int(str(value).strip())
        except Exception:
            return None

    start_ms = _coerce_ms(start_at_ms)
    end_ms = _coerce_ms(end_at_ms)
    if start_ms is not None and end_ms is not None:
        return start_ms, end_ms

    tz = ZoneInfo("America/Sao_Paulo")
    expected_start, expected_end = _expected_sheet_datetimes(request)
    return int(expected_start.replace(tzinfo=tz).timestamp() * 1000), int(expected_end.replace(tzinfo=tz).timestamp() * 1000)


def _format_sheet_datetime(value: datetime) -> str:
    return value.strftime("%d/%m/%y %H:%M")


def _find_visible_datepicker_menu(driver: WebDriver, *, timeout: int = 6):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for menu in driver.find_elements(By.CSS_SELECTOR, '.dp__menu[role="dialog"]'):
            try:
                if menu.is_displayed():
                    return menu
            except Exception:
                continue
        time.sleep(0.1)
    raise TimeoutException("datepicker menu not found")


def _scope_datepicker_displays(scope) -> list:
    try:
        return [
            el
            for el in scope.find_elements(By.XPATH, './/*[@aria-label="Datepicker input" and @role="textbox"]')
            if el.is_displayed()
        ]
    except Exception:
        return []


def _datepicker_click_aria(driver: WebDriver, aria_label: str, *, timeout: int = 6) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            menu = _find_visible_datepicker_menu(driver, timeout=1)
            button = menu.find_element(By.XPATH, f'.//*[@aria-label="{aria_label}"]')
            if _real_click(driver, button):
                return True
        except Exception:
            pass
        time.sleep(0.1)
    return False


def _datepicker_select_overlay_value(driver: WebDriver, value: str, *, timeout: int = 6) -> bool:
    target_value = _normalize_spaces(value)
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            menu = _find_visible_datepicker_menu(driver, timeout=1)
            clicked = driver.execute_script(
                """
                const menu = arguments[0];
                const targetValue = arguments[1];
                const candidates = Array.from(menu.querySelectorAll('.dp__overlay_cell, .dp__overlay_col, [role="option"]'));
                const target = candidates.find((el) => ((el.innerText || el.textContent || '').trim() === targetValue));
                if (!target) return false;
                target.click();
                return true;
                """,
                menu,
                target_value,
            )
            if clicked:
                return True
        except Exception:
            pass
        time.sleep(0.1)
    return False


def _datepicker_current_month_year(driver: WebDriver) -> tuple[int | None, int | None]:
    try:
        menu = _find_visible_datepicker_menu(driver, timeout=1)
        values = driver.execute_script(
            """
            const menu = arguments[0];
            return Array.from(menu.querySelectorAll('.dp__month_year_select'))
              .map((el) => (el.innerText || el.textContent || '').trim());
            """,
            menu,
        ) or []
    except Exception:
        return None, None

    month_text = _normalize_match(str(values[0] or "")) if values else ""
    year_text = _normalize_spaces(str(values[1] or "")) if len(values) > 1 else ""
    month = _MONTH_TEXT_TO_NUMBER.get(month_text)
    try:
        year = int(year_text)
    except Exception:
        year = None
    return month, year


def _datepicker_select_date(driver: WebDriver, target: datetime, *, timeout: int = 8) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            menu = _find_visible_datepicker_menu(driver, timeout=1)
            clicked = driver.execute_script(
                """
                const menu = arguments[0];
                const targetYear = arguments[1];
                const targetMonth = arguments[2];
                const targetDay = arguments[3];
                const cells = Array.from(menu.querySelectorAll('[role="gridcell"][data-test]'));
                const target = cells.find((cell) => {
                  const raw = (cell.getAttribute('data-test') || '').trim();
                  const dt = new Date(raw);
                  if (Number.isNaN(dt.getTime())) return false;
                  return (
                    dt.getFullYear() === targetYear &&
                    dt.getMonth() === targetMonth &&
                    dt.getDate() === targetDay
                  );
                });
                if (!target) return false;
                const clickable = target.querySelector('.dp__cell_inner') || target;
                clickable.click();
                return true;
                """,
                menu,
                target.year,
                target.month - 1,
                target.day,
            )
            if clicked:
                return True
        except Exception:
            pass

        current_month, current_year = _datepicker_current_month_year(driver)
        if current_month is None or current_year is None:
            return False
        if (current_year, current_month) == (target.year, target.month):
            return False
        direction = "Next month" if (current_year, current_month) < (target.year, target.month) else "Previous month"
        if not _datepicker_click_aria(driver, direction, timeout=1):
            return False
        time.sleep(0.2)
    return False


def _set_single_datepicker_datetime(driver: WebDriver, scope, index: int, target: datetime) -> bool:
    displays = _scope_datepicker_displays(scope)
    if len(displays) <= index:
        return False

    if not _real_click(driver, displays[index]):
        return False
    time.sleep(0.2)
    _find_visible_datepicker_menu(driver, timeout=4)

    if not _datepicker_select_date(driver, target, timeout=6):
        return False

    if not _datepicker_click_aria(driver, "Open time picker", timeout=4):
        return False
    time.sleep(0.15)

    hour_text = f"{target.hour:02d}"
    minute_text = f"{target.minute:02d}"

    try:
        current_hour = _find_visible_datepicker_menu(driver, timeout=1).find_element(By.XPATH, './/*[@aria-label="Open hours overlay"]').text
    except Exception:
        current_hour = ""
    if _normalize_spaces(current_hour) != hour_text:
        if not _datepicker_click_aria(driver, "Open hours overlay", timeout=2):
            return False
        time.sleep(0.1)
        if not _datepicker_select_overlay_value(driver, hour_text, timeout=2):
            return False
        time.sleep(0.15)

    try:
        current_minute = _find_visible_datepicker_menu(driver, timeout=1).find_element(By.XPATH, './/*[@aria-label="Open minutes overlay"]').text
    except Exception:
        current_minute = ""
    if _normalize_spaces(current_minute) != minute_text:
        if not _datepicker_click_aria(driver, "Open minutes overlay", timeout=2):
            return False
        time.sleep(0.1)
        if not _datepicker_select_overlay_value(driver, minute_text, timeout=2):
            return False
        time.sleep(0.15)

    _datepicker_click_aria(driver, "Close time Picker", timeout=2)
    time.sleep(0.2)
    try:
        driver.execute_script("document.body.click();")
    except Exception:
        pass
    time.sleep(0.2)
    return True


def _set_sheet_datetimes(driver: WebDriver, scope, request: BookingRequest) -> bool:
    expected_start, expected_end = _expected_sheet_datetimes(request)
    current_start, current_end = _read_sheet_datetimes(driver, scope)
    if current_start != expected_start:
        if not _set_single_datepicker_datetime(driver, scope, 0, expected_start):
            return False
    current_start, current_end = _read_sheet_datetimes(driver, scope)
    if current_end != expected_end:
        if not _set_single_datepicker_datetime(driver, scope, 1, expected_end):
            return False
    time.sleep(0.2)
    current_start, current_end = _read_sheet_datetimes(driver, scope)
    return current_start == expected_start and current_end == expected_end


def _adjust_duration_buttons(driver: WebDriver, scope, request: BookingRequest) -> None:
    current_start, current_end = _read_sheet_datetimes(driver, scope)
    if current_start is None or current_end is None:
        return

    expected_start, expected_end = _expected_sheet_datetimes(request)
    if current_start != expected_start:
        return

    delta_minutes = int((expected_end - current_end).total_seconds() // 60)
    if delta_minutes == 0 or delta_minutes % 30 != 0:
        return

    button_text = "+ 30 min" if delta_minutes > 0 else "- 30 min"
    for _ in range(abs(delta_minutes) // 30):
        if not _click_text_in_scope(scope, [button_text]):
            break
        time.sleep(0.4)


def _try_fill_current_step(driver: WebDriver, request: BookingRequest) -> None:
    dialog = _find_booking_sheet(driver, timeout=8)

    booking_type = _resolve_booking_type(request)
    if booking_type and not _scope_has_pressed_text(dialog, [booking_type]):
        _click_text_in_scope(dialog, [booking_type])
        time.sleep(0.3)
        dialog = _find_booking_sheet(driver, timeout=8)

    sheet_datetimes_ok = _set_sheet_datetimes(driver, dialog, request)
    _adjust_duration_buttons(driver, dialog, request)
    if not sheet_datetimes_ok:
        current_start, current_end = _read_sheet_datetimes(driver, dialog)
        log(f"Booking fill: datetime not-set ({current_start} -> {current_end})")
        raise BookingError(
            f"booking datetime not set to requested slot: expected {request.appointment_date} {request.start_time}-{request.end_time}"
        )

    if request.professional_name:
        if _dismiss_injector_access_modal(driver):
            time.sleep(0.3)
            dialog = _find_booking_sheet(driver, timeout=8)
        selected_prof = _multiselect_has_selected_label(dialog, request.professional_name)
        professional_multiselect = None
        if not selected_prof:
            professional_multiselect = _open_multiselect_by_placeholder(driver, dialog, ["Selecione o Injetor"], timeout=8)
            if professional_multiselect is None and _dismiss_injector_access_modal(driver):
                time.sleep(0.3)
                dialog = _find_booking_sheet(driver, timeout=8)
                professional_multiselect = _open_multiselect_by_placeholder(driver, dialog, ["Selecione o Injetor"], timeout=8)
            if professional_multiselect is not None:
                selected_prof = _select_multiselect_option(driver, professional_multiselect, request.professional_name, timeout=8)
                if not selected_prof and _dismiss_injector_access_modal(driver):
                    time.sleep(0.3)
                    dialog = _find_booking_sheet(driver, timeout=8)
                    professional_multiselect = _open_multiselect_by_placeholder(driver, dialog, ["Selecione o Injetor"], timeout=8)
                    if professional_multiselect is not None:
                        selected_prof = _select_multiselect_option(driver, professional_multiselect, request.professional_name, timeout=8)
            selected_prof = selected_prof and _multiselect_has_selected_label(professional_multiselect or dialog, request.professional_name)
        if selected_prof:
            try:
                driver.execute_script("document.body.click();")
            except Exception:
                pass
            time.sleep(0.2)
            dialog = _find_booking_sheet(driver, timeout=8)
        log(f"Booking fill: professional {'ok' if selected_prof else 'not-found'} ({request.professional_name})")
        if not selected_prof:
            raise BookingError(f"professional not selected from list: {request.professional_name}")

    if _should_fill_service(request):
        service_values: list[str] = []
        for value in [*request.service_candidates, request.service_name]:
            normalized = _normalize_spaces(value)
            if normalized and normalized not in service_values and not _is_generic_service_name(normalized):
                service_values.append(normalized)

        selected_service = False
        selected_service_value = ""
        stale_error: StaleElementReferenceException | None = None
        for _ in range(3):
            try:
                dialog = _find_booking_sheet(driver, timeout=8)
                selected_service = _service_summary_contains_any(dialog, service_values)
                if selected_service:
                    selected_service_value = next(
                        (value for value in service_values if _service_summary_contains(dialog, value)),
                        service_values[0],
                    )
                else:
                    services_multiselect = _open_multiselect_by_placeholder(driver, dialog, ["Selecione o serviço"], timeout=8)
                    for service_value in service_values:
                        if services_multiselect is not None:
                            selected_service = _select_multiselect_option(driver, services_multiselect, service_value, timeout=8)
                        if not selected_service:
                            selected_service = _select_or_fill(
                                driver,
                                dialog,
                                ["Serviços", "Serviços do agendamento", "Selecione o serviço"],
                                service_value,
                                timeout=8,
                            )
                        if selected_service:
                            selected_service_value = service_value
                            break
                    selected_service = selected_service and _service_summary_contains_any(dialog, [selected_service_value, *service_values])
                stale_error = None
                break
            except StaleElementReferenceException as exc:
                stale_error = exc
                time.sleep(0.3)
                continue
        if stale_error is not None and not selected_service:
            raise stale_error
        if selected_service:
            try:
                driver.execute_script("document.body.click();")
            except Exception:
                pass
            time.sleep(0.2)
            dialog = _find_booking_sheet(driver, timeout=8)
        log(f"Booking fill: service {'ok' if selected_service else 'not-found'} ({selected_service_value or request.service_name})")
        if service_values and not selected_service:
            raise BookingError(f"service not selected: {selected_service_value or request.service_name}")

    name_ok = _type_input_by_placeholder(driver, dialog, ["Digite o nome"], request.client_name, timeout=8)
    if not name_ok:
        name_ok = _fill_input_by_placeholder(driver, dialog, ["Digite o nome"], request.client_name, timeout=6)
    if not name_ok:
        name_ok = _fill_field_by_labels(driver, dialog, ["Nome do cliente", "Nome"], request.client_name, timeout=6)
    if name_ok:
        try:
            driver.execute_script("arguments[0].click();", dialog)
        except Exception:
            pass
        time.sleep(0.2)
    name_value = _input_value_by_placeholder(dialog, ["Digite o nome"])
    if not _input_value_matches(name_value, request.client_name):
        name_ok = _fill_field_by_labels(driver, dialog, ["Nome do cliente", "Nome"], request.client_name, timeout=4)
        if name_ok:
            try:
                driver.execute_script("arguments[0].click();", dialog)
            except Exception:
                pass
            time.sleep(0.2)
            name_value = _input_value_by_placeholder(dialog, ["Digite o nome"])
    name_matches = _input_value_matches(name_value, request.client_name)
    log(f"Booking fill: client {'ok' if name_matches else 'not-found'} ({request.client_name})")
    if not name_matches:
        raise BookingError(f"client name not filled: {request.client_name}")
    if request.client_phone:
        phone_value_for_ui = _normalize_phone_for_ui(request.client_phone)
        phone_ok = _type_input_by_placeholder(driver, dialog, ["Digite o WhatsApp"], phone_value_for_ui, timeout=8)
        phone_value = _input_value_by_placeholder(dialog, ["Digite o WhatsApp"])
        log(f"Booking fill: whatsapp {'ok' if phone_ok and _input_value_matches(phone_value, phone_value_for_ui) else 'not-found'} ({phone_value_for_ui})")
    if request.client_cpf:
        cpf_ok = _fill_input_by_placeholder(driver, dialog, ["Digite o CPF"], request.client_cpf, timeout=8)
        cpf_value = _input_value_by_placeholder(dialog, ["Digite o CPF"])
        log(f"Booking fill: cpf {'ok' if cpf_ok and _input_value_matches(cpf_value, request.client_cpf) else 'not-found'} ({request.client_cpf})")
    if request.customer_origin:
        selected_origin = False
        origin_multiselect = _open_multiselect_by_placeholder(driver, dialog, ["Selecione a origem do cliente"], timeout=8)
        if origin_multiselect is not None:
            selected_origin = _select_multiselect_option(driver, origin_multiselect, request.customer_origin, timeout=8)
        if not selected_origin:
            selected_origin = _select_or_fill(driver, dialog, ["Origem do cliente", "Origem"], request.customer_origin, timeout=8)
        if selected_origin:
            try:
                driver.execute_script("document.body.click();")
            except Exception:
                pass
            time.sleep(0.2)
            dialog = _find_booking_sheet(driver, timeout=8)
        log(f"Booking fill: customer-origin {'ok' if selected_origin else 'not-found'} ({request.customer_origin})")
    if request.notes:
        notes_ok = _fill_input_by_placeholder(driver, dialog, ["Digite aqui"], request.notes, timeout=6)
        if not notes_ok:
            notes_ok = _fill_or_select(driver, dialog, ["Observações", "Observacoes", "Observação", "Observacao"], request.notes, timeout=8)
        log(f"Booking fill: notes {'ok' if notes_ok else 'not-found'}")
    if request.professional_name:
        final_prof_selected = _multiselect_has_selected_label(dialog, request.professional_name)
        if not final_prof_selected:
            professional_multiselect = _open_multiselect_by_placeholder(driver, dialog, ["Selecione o Injetor"], timeout=5)
            if professional_multiselect is not None:
                final_prof_selected = _select_multiselect_option(driver, professional_multiselect, request.professional_name, timeout=6)
        if final_prof_selected:
            try:
                driver.execute_script("document.body.click();")
            except Exception:
                pass
            time.sleep(0.2)
        log(f"Booking fill: professional-final {'ok' if final_prof_selected else 'not-found'} ({request.professional_name})")
        if not final_prof_selected:
            raise BookingError(f"professional not persisted in form before save: {request.professional_name}")


def _advance_until_review(driver: WebDriver, request: BookingRequest) -> None:
    log("Booking flow: filling current step")
    _try_fill_current_step(driver, request)
    dialog = _find_booking_sheet(driver, timeout=2)
    has_advance = _click_text_in_scope(dialog, ["Avançar"])
    log(f"Booking flow: advance {'clicked' if has_advance else 'not-present'}")
    if not has_advance:
        return
    time.sleep(1.5)
    log("Booking flow: filling review step")
    _try_fill_current_step(driver, request)


def _finish_booking(driver: WebDriver) -> bool:
    try:
        dialog = _find_booking_sheet(driver, timeout=4)
        driver.execute_script("arguments[0].scrollTop = arguments[0].scrollHeight;", dialog)
    except Exception:
        pass
    clicked = _click_button(driver, ["Salvar", "Agendar", "Concluir", "Finalizar", "Criar agendamento"], timeout=6)
    log(f"Booking flow: finish button {'clicked' if clicked else 'not-found'}")
    return clicked


def execute_booking(
    driver: WebDriver,
    *,
    reception_url: str,
    request: BookingRequest,
    debug_dir: Path,
    timeout_seconds: int = 20,
    ) -> BookingResult:
    try:
        if not navigate_to_reception(driver, reception_url, timeout_seconds=timeout_seconds):
            raise BookingError("could not load reception page")
        _ensure_agenda_tab(driver)
        _open_new_booking_sheet(driver, request)
        _advance_until_review(driver, request)

        if request.dry_run:
            return BookingResult(
                ok=True,
                message="Dry run complete; booking sheet was opened and fields were filled best-effort.",
                request=request,
                current_url=driver.current_url or "",
            )

        if not _finish_booking(driver):
            raise BookingError("could not find final confirmation button after filling booking flow")

        log("Booking flow: waiting after submit")
        time.sleep(3)
        dialog_open = _booking_dialog_still_open(driver)
        log(f"Booking flow: dialog {'still-open' if dialog_open else 'closed'} after submit")
        if dialog_open:
            raise BookingError("booking dialog remained open after submit; likely validation error or missing required field")

        log("Booking flow: verifying saved event in agenda")
        if not _verify_booking_in_agenda(driver, request, timeout=45):
            raise BookingError("booking submit returned, but appointment was not found in agenda index for the requested date/time")

        return BookingResult(
            ok=True,
            message="Booking flow submitted and verified in agenda index.",
            request=request,
            current_url=driver.current_url or "",
        )
    except Exception as exc:
        artifacts = capture_artifacts(driver, output_dir=debug_dir, label="booking_error")
        raise BookingError(
            json.dumps(
                {
                    "message": str(exc),
                    "htmlPath": str(artifacts.html_path) if artifacts.html_path else "",
                    "screenshotPath": str(artifacts.screenshot_path) if artifacts.screenshot_path else "",
                    "currentUrl": driver.current_url or "",
                },
                ensure_ascii=False,
            )
        ) from exc


class _BookingLock:
    _lock = threading.Lock()

    def __enter__(self):
        self._lock.acquire()
        return self

    def __exit__(self, exc_type, exc, tb):
        self._lock.release()
        return False


BOOKING_LOCK = _BookingLock()
