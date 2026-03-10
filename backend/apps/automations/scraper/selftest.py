#!/usr/bin/env python3
"""Unified self-test for the scraper environment.

This replaces the old smoke_test.py.

What it checks (best-effort):
- Python deps import
- CSV/XLSX export works (writes into EF_OUTPUT_DIR)
- Optional: headless Chrome can open the login page

It does NOT log in.
"""

from __future__ import annotations

import os
from pathlib import Path

from espacofacial.config import default_debug_dir


def test_imports() -> None:
    import pandas as pd
    import openpyxl
    import selenium
    import webdriver_manager

    _ = (pd.__name__, openpyxl.__name__, selenium.__name__, webdriver_manager.__name__)


def test_exports(output_dir: Path) -> None:
    import pandas as pd

    output_dir.mkdir(parents=True, exist_ok=True)

    df = pd.DataFrame(
        [
            {
                "Cliente": "Teste",
                "Profissional": "N/A",
                "Tipo de Agendamento": "N/A",
                "Horário": "00:00 - 00:30",
            }
        ]
    )

    csv_path = output_dir / "_selftest_export.csv"
    xlsx_path = output_dir / "_selftest_export.xlsx"

    df.to_csv(csv_path, index=False, encoding="utf-8")
    # pandas' typing for to_excel can be incomplete depending on stubs.
    df.to_excel(xlsx_path, index=False, engine="openpyxl")  # type: ignore[call-arg]

    assert csv_path.exists() and csv_path.stat().st_size > 0
    assert xlsx_path.exists() and xlsx_path.stat().st_size > 0


def test_selenium_login_page(*, headless: bool) -> None:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    from webdriver_manager.chrome import ChromeDriverManager

    base_url = os.getenv("EF_BASE_URL", "https://app.espacofacial.com.br")

    opts = Options()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--remote-debugging-port=0")
    opts.add_argument("--remote-allow-origins=*")

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=opts)

    try:
        driver.get(base_url)
        WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.XPATH, '//input[@type="email"]')))
    finally:
        driver.quit()


def main() -> int:
    headless = os.getenv("HEADLESS", "1") == "1"
    output_dir = Path(os.getenv("EF_OUTPUT_DIR", str(default_debug_dir()))).expanduser()

    print("[selftest] Starting...")
    print(f"[selftest] headless={'yes' if headless else 'no'}")
    print(f"[selftest] output_dir={output_dir}")

    test_imports()
    print("[selftest] imports ok")

    test_exports(output_dir)
    print("[selftest] exports ok")

    # Selenium portion is optional-ish: if Chrome/driver are mismatched it will raise.
    test_selenium_login_page(headless=headless)
    print("[selftest] selenium ok (login page loaded)")

    print("[selftest] SUCCESS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
