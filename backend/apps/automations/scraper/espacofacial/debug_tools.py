from __future__ import annotations

import time
from pathlib import Path

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from .auth import log


def dump_reception(driver: WebDriver, reception_url: str, output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    log("Opening reception page for debug...")
    driver.get(reception_url)
    time.sleep(3)

    WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.TAG_NAME, "body")))

    html_path = output_dir / "debug_reception.html"
    png_path = output_dir / "debug_reception.png"

    html_path.write_text(driver.page_source, encoding="utf-8")
    driver.save_screenshot(png_path.as_posix())

    log(f"Saved: {html_path}")
    log(f"Saved: {png_path}")
    return html_path, png_path


def dump_cash(driver: WebDriver, cash_url: str, output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    log("Opening cash page for debug...")
    driver.get(cash_url)
    time.sleep(3)

    WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.TAG_NAME, "body")))

    html_path = output_dir / "debug_cash.html"
    png_path = output_dir / "debug_cash.png"

    html_path.write_text(driver.page_source, encoding="utf-8")
    driver.save_screenshot(png_path.as_posix())

    log(f"Saved: {html_path}")
    log(f"Saved: {png_path}")
    return html_path, png_path


def test_first_modal(driver: WebDriver, reception_url: str, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    log("Opening reception and clicking first event to capture modal...")
    driver.get(reception_url)
    time.sleep(4)

    event_xpath = '//div[contains(@class, "fc-event") and .//*[contains(@class, "fc-event-title")]]'
    WebDriverWait(driver, 20).until(EC.presence_of_all_elements_located((By.XPATH, event_xpath)))

    events = driver.find_elements(By.XPATH, event_xpath)
    if not events:
        raise RuntimeError("No events found")

    event = events[0]
    driver.execute_script("arguments[0].scrollIntoView(true);", event)
    time.sleep(0.2)
    driver.execute_script("arguments[0].click();", event)
    time.sleep(2)

    modal = driver.find_elements(By.XPATH, '//div[@role="dialog" or contains(@class, "modal")]')
    out_path = output_dir / "debug_modal.html"

    if modal:
        out_path.write_text(modal[0].get_attribute("outerHTML") or "", encoding="utf-8")
    else:
        out_path.write_text(driver.page_source, encoding="utf-8")

    log(f"Saved: {out_path}")
    return out_path
