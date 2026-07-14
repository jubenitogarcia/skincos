from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from selenium.webdriver.chrome.webdriver import WebDriver


@dataclass(frozen=True)
class DiagnosticArtifacts:
    html_path: Optional[Path]
    screenshot_path: Optional[Path]


def _safe_slug(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9._-]+", "-", text)
    return text.strip("-_") or "artifact"


def capture_artifacts(
    driver: WebDriver,
    *,
    output_dir: Path,
    label: str,
    save_html: bool = True,
    save_screenshot: bool = True,
) -> DiagnosticArtifacts:
    """Best-effort capture of page artifacts.

    Intended to be called in exception handlers.
    """

    output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    slug = _safe_slug(label)

    html_path: Optional[Path] = None
    screenshot_path: Optional[Path] = None

    if save_html:
        try:
            html_path = output_dir / f"{ts}_{slug}.html"
            html_path.write_text(driver.page_source or "", encoding="utf-8")
        except Exception:
            html_path = None

    if save_screenshot:
        try:
            screenshot_path = output_dir / f"{ts}_{slug}.png"
            png_bytes = driver.get_screenshot_as_png()
            screenshot_path.write_bytes(png_bytes)
        except Exception:
            screenshot_path = None

    return DiagnosticArtifacts(html_path=html_path, screenshot_path=screenshot_path)


def cleanup_debug_dir(output_dir: Path, *, retention_days: int) -> int:
    """Delete debug artifacts older than retention_days."""

    if retention_days <= 0:
        return 0

    cutoff = datetime.now() - timedelta(days=retention_days)
    removed = 0
    for path in output_dir.glob("*"):
        try:
            if not path.is_file():
                continue
            mtime = datetime.fromtimestamp(path.stat().st_mtime)
            if mtime < cutoff:
                path.unlink()
                removed += 1
        except Exception:
            continue
    return removed
