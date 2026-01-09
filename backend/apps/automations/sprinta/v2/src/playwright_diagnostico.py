from __future__ import annotations
import json
import time
from pathlib import Path
from typing import List, Dict
from playwright.sync_api import sync_playwright
from dotenv import load_dotenv
import os

load_dotenv()

EVENT_URL = "https://app.sprinta.com.br/event/30560768ac8e7500fef"
BASE_URL = "https://app.sprinta.com.br/"
OUTPUT_DIR = Path('logs')
OUTPUT_DIR.mkdir(exist_ok=True)

KEY_TERMS = ["enroll", "friend", "inscri", "amig", "register", "add", "corrida", "kit"]


def _visible(el) -> bool:
    try:
        box = el.bounding_box()
        if not box:
            return False
        return box['width'] > 2 and box['height'] > 2 and el.is_visible()
    except Exception:
        return False

def diagnostico_avancado(email: str | None = None, senha: str | None = None, headless: bool = False) -> Path:
    email = email or os.getenv('SPRINTA_EMAIL')
    senha = senha or os.getenv('SPRINTA_SENHA')
    items: List[Dict[str, str]] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless, args=["--lang=pt-BR"])
        context = browser.new_context(locale="pt-BR")
        page = context.new_page()

        page.goto(BASE_URL, wait_until="domcontentloaded")
        time.sleep(1.2)
        # Login se botão aparecer
        try:
            btn_login = page.locator("xpath=//button[span[text()='Login']]").first
            if btn_login.count() > 0:
                btn_login.click()
                page.locator("input[name='username']").fill(email or "")
                page.locator("input[name='password']").fill(senha or "")
                page.locator("xpath=//button[@type='submit' and .//span[text()='Login']]").click()
                page.wait_for_timeout(2000)
        except Exception:
            pass

        page.goto(EVENT_URL, wait_until="networkidle")
        time.sleep(1.0)

        # Scroll incremental
        for _ in range(6):
            page.mouse.wheel(0, 1500)
            page.wait_for_timeout(400)
        page.mouse.wheel(0, -2000)
        page.wait_for_timeout(600)

        # Coletar elementos potencialmente clicáveis
        selectors = [
            "button", "a", "div[role=button]", "[onclick]", "span", "div"
        ]
        seen = set()
        for sel in selectors:
            for el in page.locator(sel).all():
                if not _visible(el):
                    continue
                try:
                    text = (el.inner_text(timeout=0) or "").strip()
                except Exception:
                    text = ""
                if not any(k in text.lower() for k in KEY_TERMS):
                    continue
                html_snippet = ""
                try:
                    html_snippet = el.evaluate("e => e.outerHTML")[0:400]
                except Exception:
                    pass
                key = (sel, text)
                if key in seen:
                    continue
                seen.add(key)
                classes = ""
                try:
                    classes = el.get_attribute("class") or ""
                except Exception:
                    pass
                items.append({
                    "selector": sel,
                    "text": text,
                    "classes": classes,
                    "html": html_snippet
                })

        # Shadow roots (list only count)
        shadow_count = page.evaluate("()=>Array.from(document.querySelectorAll('*')).filter(e=>e.shadowRoot).length")

        data = {
            "timestamp": time.time(),
            "total_candidates": len(items),
            "shadow_root_elements": shadow_count,
            "candidates": items,
        }
        out_path = OUTPUT_DIR / "diagnostico_avancado.json"
        out_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        browser.close()
        return out_path

if __name__ == "__main__":
    p = diagnostico_avancado(headless=False)
    print(f"[diagnostico-avancado] Resultado em {p}")
