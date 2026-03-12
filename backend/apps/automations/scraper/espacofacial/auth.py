from __future__ import annotations

import os
import time
import traceback
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional
import json

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.remote.webdriver import WebDriver


_LOG_FILE_PATH: Optional[Path] = None
_LOG_JSON_PATH: Optional[Path] = None


def configure_file_logging(output_dir: Path, *, prefix: str = "run") -> Path:
    """Enable best-effort log file output.

    Returns the log file path. Safe to call multiple times.
    """

    global _LOG_FILE_PATH, _LOG_JSON_PATH
    if _LOG_FILE_PATH is not None:
        return _LOG_FILE_PATH

    raw_log_dir = os.getenv("EF_LOG_DIR", "").strip()
    raw_debug_dir = os.getenv("EF_DEBUG_DIR", "").strip()
    log_dir = Path(raw_log_dir).expanduser() if raw_log_dir else (Path(raw_debug_dir).expanduser() if raw_debug_dir else output_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_prefix = "".join(ch if (ch.isalnum() or ch in {"_", "-"}) else "_" for ch in prefix).strip("_-") or "run"
    _LOG_FILE_PATH = log_dir / f"{safe_prefix}_{ts}.log"
    _LOG_JSON_PATH = log_dir / f"{safe_prefix}_{ts}.jsonl"

    try:
        header = f"[{datetime.now().isoformat(timespec='seconds')}] Log started ({safe_prefix})\n"
        _LOG_FILE_PATH.write_text(header, encoding="utf-8")
    except Exception:
        # If we can't create the file, keep going without file logging.
        _LOG_FILE_PATH = None

    try:
        if _LOG_JSON_PATH is not None:
            _LOG_JSON_PATH.write_text("", encoding="utf-8")
    except Exception:
        _LOG_JSON_PATH = None

    return _LOG_FILE_PATH or (log_dir / f"{safe_prefix}_{ts}.log")


def get_log_file_path() -> Optional[Path]:
    return _LOG_FILE_PATH


def _append_to_file(line: str) -> None:
    if _LOG_FILE_PATH is None:
        return
    try:
        with _LOG_FILE_PATH.open("a", encoding="utf-8") as f:
            f.write(line.rstrip("\n") + "\n")
    except Exception:
        return


def _append_to_json(payload: dict) -> None:
    if _LOG_JSON_PATH is None:
        return
    try:
        with _LOG_JSON_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        return


def log(message: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {message}"
    print(line)
    _append_to_file(line)
    _append_to_json({"ts": datetime.now().isoformat(timespec="seconds"), "level": "info", "message": message})


def log_file_only(message: str) -> None:
    """Write a message only to the log file (if configured)."""

    ts = datetime.now().strftime("%H:%M:%S")
    _append_to_file(f"[{ts}] {message}")
    _append_to_json({"ts": datetime.now().isoformat(timespec="seconds"), "level": "debug", "message": message})


def log_exception(message: str, exc: BaseException) -> None:
    """Log a short message to console + full traceback to file (if enabled)."""

    log(f"{message}: {exc}")
    tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    log_file_only("Traceback:\n" + tb)
    _append_to_json(
        {
            "ts": datetime.now().isoformat(timespec="seconds"),
            "level": "error",
            "message": message,
            "error": str(exc),
            "type": type(exc).__name__,
        }
    )


@dataclass(frozen=True)
class Credentials:
    email: str
    password: str


def wait_for(driver: WebDriver, by, value, timeout: int = 20):
    return WebDriverWait(driver, timeout).until(EC.presence_of_element_located((by, value)))


def _select_unit_if_needed(driver: WebDriver, unit_name: str, *, timeout_seconds: int = 20) -> bool:
    if not unit_name:
        return True

    log(f"Selecting unit: {unit_name}")

    def _dropdown_label_contains(name: str) -> bool:
        try:
            els = driver.find_elements(
                By.XPATH,
                f'//*[contains(@class,"dropdown__layout")]//p[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ", "abcdefghijklmnopqrstuvwxyzàáâãäåçèéêëìíîïñòóôõöùúûüý"), "{name.lower()}")]',
            )
            return any(e.is_displayed() for e in els)
        except Exception:
            return False

    def _open_unit_dropdown() -> bool:
        # Recorder shows this UI:
        # 1) click the current unit label (e.g., "BarraShoppingSul") OR the chevron-down icon
        # 2) click the desired option inside dropdown__content
        triggers = [
            '//*[contains(@class,"dropdown__layout")]//p[contains(@class,"ww-text")][1]',
            '//*[contains(@class,"dropdown__layout")]//*[contains(@class,"icon-chevron-down")][1]',
        ]
        for xp in triggers:
            try:
                el = driver.find_element(By.XPATH, xp)
                if not el.is_displayed():
                    continue
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", el)
                driver.execute_script("arguments[0].click();", el)
                time.sleep(0.6)
                return True
            except Exception:
                continue
        return False

    def _click_unit_option(name: str) -> bool:
        # Prefer options inside dropdown content (matches recorder selectors).
        option_xpaths = [
            f'//*[contains(@class,"dropdown__content")]//*[self::p or self::span or self::div][normalize-space(.)="{name}"]',
            f'//*[contains(@class,"dropdown__content")]//*[self::p or self::span or self::div][contains(normalize-space(.), "{name}")]',
        ]
        for ox in option_xpaths:
            try:
                opt = WebDriverWait(driver, timeout_seconds).until(EC.presence_of_element_located((By.XPATH, ox)))
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", opt)
                driver.execute_script("arguments[0].click();", opt)
                time.sleep(1.2)
                return True
            except Exception:
                continue
        return False

    # Best-effort: different accounts/tenants have different UIs.
    # If we can't find a unit selector, assume it's already selected.
    try:
        # 0) If the UI shows a dropdown unit label, use it (most reliable for this tenant).
        # If unit is already selected, don't touch.
        if _dropdown_label_contains(unit_name):
            log("✓ Unit already selected")
            return True

        dropdown_present = bool(driver.find_elements(By.XPATH, '//*[contains(@class,"dropdown__layout")]'))
        if dropdown_present:
            if not _open_unit_dropdown():
                log("WARNING: Found unit dropdown but could not open it")
            else:
                # Some tenants show a suffix like "- RS"; accept contains.
                if not _click_unit_option(unit_name):
                    _click_unit_option(f"{unit_name} -")

            if _dropdown_label_contains(unit_name):
                log("✓ Unit selected")
                return True

            log("WARNING: Unit dropdown present but selection could not be verified")
            return False

        # 1) Native <select>
        select_xpath = '//select[contains(@name, "unit") or contains(@id, "unit") or contains(@name, "unidade") or contains(@id, "unidade")]'
        selects = driver.find_elements(By.XPATH, select_xpath)
        if selects:
            sel = selects[0]
            sel.click()
            time.sleep(0.5)
            option = driver.find_elements(By.XPATH, f'//option[contains(normalize-space(.), "{unit_name}")]')
            if option:
                option[0].click()
                time.sleep(1.5)
                log("✓ Unit selected")
                return True

        # 2) Dropdown trigger by "Unidade"
        trigger_xpaths = [
            '//button[contains(., "Unidade") or contains(., "Unidades")]',
            '//a[contains(., "Unidade") or contains(., "Unidades")]',
        ]
        for tx in trigger_xpaths:
            triggers = driver.find_elements(By.XPATH, tx)
            if not triggers:
                continue
            driver.execute_script("arguments[0].click();", triggers[0])
            time.sleep(0.8)
            choice = driver.find_elements(By.XPATH, f'//*[self::button or self::a or self::div][contains(normalize-space(.), "{unit_name}")]')
            if choice:
                driver.execute_script("arguments[0].click();", choice[0])
                time.sleep(1.5)
                log("✓ Unit selected")
                return True

        # 3) Direct button/element with unit name
        direct = driver.find_elements(By.XPATH, f'//button[contains(normalize-space(.), "{unit_name}")]')
        if direct:
            driver.execute_script("arguments[0].click();", direct[0])
            time.sleep(1.5)
            log("✓ Unit selected")
            return True

        log("Unit selector not found; assuming unit already selected")
        return True
    except Exception as e:
        log(f"WARNING: Unit selection failed: {e}")
        return True


def login(driver: WebDriver, *, base_url: str, creds: Credentials, timeout_seconds: int = 20) -> bool:
    log("Navigating to login page...")
    driver.get(base_url)
    time.sleep(2)

    try:
        # When using a persisted Chrome profile, the user may already be logged in.
        # Wait until either the login form appears or the app redirects into the authenticated area.
        def _visible(xpath: str) -> bool:
            try:
                els = driver.find_elements(By.XPATH, xpath)
                return any(e.is_displayed() for e in els)
            except Exception:
                return False

        def _ready(_driver: WebDriver) -> bool:
            try:
                # Some SPAs keep the login form in the DOM even when authenticated; only trust visible inputs.
                els = _driver.find_elements(By.XPATH, '//input[@type="email"]')
                if any(e.is_displayed() for e in els):
                    return True
            except Exception:
                pass
            url = (_driver.current_url or "").lower()
            return ("/unidade/" in url) or ("/reception_services" in url)

        WebDriverWait(driver, timeout_seconds).until(_ready)

        # If there's no login form, assume we're already authenticated.
        if not _visible('//input[@type="email"]'):
            log("✓ Already logged in (session reused)")
            return True

        if not creds.email or not creds.password:
            log("ERROR during login: login form is present but credentials are missing")
            return False

        email_input = WebDriverWait(driver, timeout_seconds).until(
            EC.visibility_of_element_located((By.XPATH, '//input[@type="email"]'))
        )
        email_input.clear()
        email_input.send_keys(creds.email)

        password_input = WebDriverWait(driver, timeout_seconds).until(
            EC.visibility_of_element_located((By.XPATH, '//input[@type="password"]'))
        )
        password_input.clear()
        password_input.send_keys(creds.password)

        login_button = wait_for(driver, By.XPATH, '//button[contains(., "Acessar conta")]', timeout=timeout_seconds)
        driver.execute_script("arguments[0].click();", login_button)
        time.sleep(4)
        log("✓ Login submitted")
        return True
    except Exception as e:
        log(f"ERROR during login: {e}")
        return False


def login_and_select_unit(
    driver: WebDriver,
    *,
    base_url: str,
    creds: Credentials,
    unit_name: str,
    timeout_seconds: int = 20,
) -> bool:
    if not login(driver, base_url=base_url, creds=creds, timeout_seconds=timeout_seconds):
        return False
    return _select_unit_if_needed(driver, unit_name, timeout_seconds=timeout_seconds)
