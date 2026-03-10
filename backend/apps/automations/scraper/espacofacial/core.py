from __future__ import annotations

import atexit
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .config import (
    ENV_BASE_URL,
    ENV_CHROME_USER_DATA_DIR,
    ENV_DEBUG_DIR,
    ENV_DEBUG_ON_ERROR,
    ENV_HEADLESS,
    ENV_LOGIN_EMAIL,
    ENV_LOGIN_PASSWORD,
    ENV_OUTPUT_DIR,
    ENV_PERSIST_SESSION,
    ENV_TIMEOUT_SECONDS,
    ENV_UNIT_NAME,
    default_chrome_profile_dir,
    default_debug_dir,
    default_output_dir,
    env_path,
)

from selenium import webdriver
from selenium.common.exceptions import SessionNotCreatedException, WebDriverException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager


_SKIP_PATH_CHROMEDRIVER = False
_SKIP_CHROMEDRIVER_DIRS: set[str] = set()
_CACHED_CHROME_MAJOR: Optional[int] = None


def env_truthy(name: str, default: str = "0") -> bool:
    value = os.getenv(name)
    if value is None:
        value = default
    return value.strip().lower() in {"1", "true", "yes", "y", "on", "sim"}


@dataclass(frozen=True)
class Config:
    base_url: str
    reception_url: str
    cash_url: str
    email: str
    password: str
    unit_name: str
    headless: bool
    output_dir: Path
    timeout_seconds: int
    debug_on_error: bool
    debug_dir: Path
    persist_session: bool
    chrome_user_data_dir: Optional[Path]


def load_config() -> Config:
    base_url = os.getenv(ENV_BASE_URL, "https://app.espacofacial.com.br")
    email = os.getenv(ENV_LOGIN_EMAIL, "").strip()
    password = os.getenv(ENV_LOGIN_PASSWORD, "").strip()
    unit_name = os.getenv(ENV_UNIT_NAME, "").strip()
    headless = env_truthy(ENV_HEADLESS, "0")
    timeout_seconds = int(os.getenv(ENV_TIMEOUT_SECONDS, "20"))
    debug_on_error = env_truthy(ENV_DEBUG_ON_ERROR, "1")
    output_dir = env_path(ENV_OUTPUT_DIR, default_output_dir())
    output_dir.mkdir(parents=True, exist_ok=True)
    debug_dir = env_path(ENV_DEBUG_DIR, default_debug_dir())
    debug_dir.mkdir(parents=True, exist_ok=True)

    persist_session = env_truthy(ENV_PERSIST_SESSION, "0")
    raw_profile = os.getenv(ENV_CHROME_USER_DATA_DIR, "").strip()
    chrome_user_data_dir: Optional[Path]
    if raw_profile:
        chrome_user_data_dir = Path(raw_profile).expanduser()
    elif persist_session:
        chrome_user_data_dir = default_chrome_profile_dir()
    else:
        chrome_user_data_dir = None

    if chrome_user_data_dir is not None:
        chrome_user_data_dir.mkdir(parents=True, exist_ok=True)

    return Config(
        base_url=base_url,
        reception_url=f"{base_url}/reception_services/",
        # Caixa (Recebimentos) lives under reception services; the UI requires selecting the "Caixa" tab.
        cash_url=f"{base_url}/reception_services/",
        email=email,
        password=password,
        unit_name=unit_name,
        headless=headless,
        output_dir=output_dir,
        timeout_seconds=timeout_seconds,
        debug_on_error=debug_on_error,
        debug_dir=debug_dir,
        persist_session=persist_session,
        chrome_user_data_dir=chrome_user_data_dir,
    )


def build_chrome_options(headless: bool, *, user_data_dir: Optional[Path] = None) -> Options:
    opts = Options()

    chrome_bin = os.getenv("EF_CHROME_BINARY", "").strip()
    if chrome_bin:
        opts.binary_location = chrome_bin

    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--no-first-run")
    opts.add_argument("--no-default-browser-check")
    # Reduce profile / debugging-port conflicts (common cause of 'chrome not reachable').
    opts.add_argument("--remote-debugging-port=0")
    # Helps with some ChromeDriver/Chrome combinations.
    opts.add_argument("--remote-allow-origins=*")
    # Avoid forcing a Linux UA on macOS; let Chrome decide (more natural).
    opts.add_argument("--window-size=1400,900")

    # Optional: persist cookies/session by reusing a Chrome profile directory.
    if user_data_dir is not None:
        opts.add_argument(f"--user-data-dir={user_data_dir.as_posix()}")

    return opts


def _register_rmtree_on_exit(path: Path) -> None:
    def _cleanup() -> None:
        try:
            shutil.rmtree(path, ignore_errors=True)
        except Exception:
            pass

    atexit.register(_cleanup)


def _make_temp_profile_dir() -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="ef_chrome_profile_"))
    _register_rmtree_on_exit(tmp)
    return tmp


def _unique_keep_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if not item:
            continue
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _get_version_major(cmd: list[str]) -> Optional[int]:
    try:
        out = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT).strip()
    except Exception:
        return None
    match = re.search(r"(\d+)\.", out)
    if not match:
        return None
    try:
        return int(match.group(1))
    except Exception:
        return None


def _resolve_chrome_binary() -> Optional[str]:
    env_bin = os.getenv("EF_CHROME_BINARY", "").strip()
    if env_bin:
        return env_bin

    candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate

    for cmd in ("google-chrome", "chrome", "chromium", "chromium-browser"):
        resolved = shutil.which(cmd)
        if resolved:
            return resolved
    return None


def _get_chrome_major_cached() -> Optional[int]:
    global _CACHED_CHROME_MAJOR
    if _CACHED_CHROME_MAJOR is not None:
        return _CACHED_CHROME_MAJOR
    chrome_bin = _resolve_chrome_binary()
    if not chrome_bin:
        return None
    _CACHED_CHROME_MAJOR = _get_version_major([chrome_bin, "--version"])
    return _CACHED_CHROME_MAJOR


def _maybe_remove_mismatched_chromedriver() -> None:
    global _SKIP_PATH_CHROMEDRIVER
    if os.getenv("EF_CHROMEDRIVER_PATH", "").strip():
        return

    chrome_major = _get_chrome_major_cached()
    if chrome_major is None:
        return

    driver_path = shutil.which("chromedriver")
    if not driver_path:
        return

    driver_major = _get_version_major([driver_path, "--version"])
    if driver_major is None:
        return

    if driver_major == chrome_major:
        return

    try:
        os.remove(driver_path)
    except PermissionError as exc:
        _SKIP_PATH_CHROMEDRIVER = True
        _SKIP_CHROMEDRIVER_DIRS.add(str(Path(driver_path).parent))
        # Remove the directory from PATH for this process so Selenium/webdriver-manager won't pick it up.
        current_path = os.getenv("PATH", "")
        if current_path:
            parts = [p for p in current_path.split(os.pathsep) if p and p not in _SKIP_CHROMEDRIVER_DIRS]
            os.environ["PATH"] = os.pathsep.join(parts)
        print(
            f"WARNING: Detected mismatched chromedriver in PATH ({driver_path}) but lacked permission to delete. "
            f"Chrome {chrome_major}.* requires chromedriver {chrome_major}.*. "
            "Continuing by skipping PATH chromedriver."
        )
    except Exception as exc:
        raise RuntimeError(
            f"Detected mismatched chromedriver in PATH ({driver_path}). "
            f"Chrome {chrome_major}.* requires chromedriver {chrome_major}.*. "
            f"Failed to delete: {exc}"
        ) from exc


def create_driver(*, headless: bool, user_data_dir: Optional[Path] = None) -> webdriver.Chrome:
    """Create a Chrome WebDriver with a robust, macOS-friendly retry ladder.

    Retry order:
      1) Selenium Manager (no explicit Service)
      2) Explicit chromedriver paths (env/which/common locations)
      3) webdriver-manager (download)

    For each provider we try:
      A) requested user_data_dir (persist)
      B) temporary profile dir
      C) no profile
    """

    _maybe_remove_mismatched_chromedriver()

    profile_modes: list[tuple[str, Optional[Path]]] = []
    if user_data_dir is not None:
        profile_modes.append(("persist", user_data_dir))
        profile_modes.append(("temp", _make_temp_profile_dir()))
    profile_modes.append(("none", None))

    attempts: list[str] = []
    last_err: Optional[BaseException] = None

    def _record(strategy: str, profile_label: str, err: BaseException) -> None:
        msg = str(err).strip().replace("\n", " | ")
        if len(msg) > 240:
            msg = msg[:240] + "…"
        attempts.append(f"- {strategy} + profile={profile_label}: {type(err).__name__}: {msg}")

    def _try_provider(
        strategy: str,
        create_fn,
    ) -> Optional[webdriver.Chrome]:
        nonlocal last_err
        for profile_label, profile_dir in profile_modes:
            opts = build_chrome_options(headless=headless, user_data_dir=profile_dir)
            try:
                return create_fn(opts)
            except (SessionNotCreatedException, WebDriverException) as e:
                last_err = e
                _record(strategy, profile_label, e)
        return None

    # 0) If the user provides a driver path, trust it first.
    env_driver = os.getenv("EF_CHROMEDRIVER_PATH", "").strip()
    if env_driver:
        driver = _try_provider(
            f"chromedriver:{env_driver}",
            lambda opts, p=env_driver: webdriver.Chrome(service=Service(executable_path=p), options=opts),
        )
        if driver is not None:
            return driver

    # 1) Selenium Manager (preferred: resolves driver automatically and tends to match Chrome)
    driver = _try_provider("selenium-manager", lambda opts: webdriver.Chrome(options=opts))
    if driver is not None:
        return driver

    # 2) webdriver-manager (fallback; downloads a matching driver)
    try:
        wdm_path = ChromeDriverManager().install()
    except Exception as e:
        last_err = e
        attempts.append(f"- webdriver-manager: {type(e).__name__}: {str(e).strip()}")
    else:
        driver = _try_provider(
            f"webdriver-manager:{wdm_path}",
            lambda opts, p=wdm_path: webdriver.Chrome(service=Service(executable_path=p), options=opts),
        )
        if driver is not None:
            return driver

    # 3) Explicit chromedriver paths (last resort; PATH may have an outdated driver)
    if not _SKIP_PATH_CHROMEDRIVER:
        service_paths: list[str] = []
        which_driver = shutil.which("chromedriver")
        if which_driver:
            service_paths.append(which_driver)
        for candidate in ("/opt/homebrew/bin/chromedriver", "/usr/local/bin/chromedriver", "/usr/bin/chromedriver"):
            if Path(candidate).exists():
                service_paths.append(candidate)
        chrome_major = _get_chrome_major_cached()
        for path in _unique_keep_order(service_paths):
            if chrome_major is not None:
                driver_major = _get_version_major([path, "--version"])
                if driver_major is not None and driver_major != chrome_major:
                    continue
            driver = _try_provider(
                f"chromedriver:{path}",
                lambda opts, p=path: webdriver.Chrome(service=Service(executable_path=p), options=opts),
            )
            if driver is not None:
                return driver

    hints = (
        "Hints: close all Chrome windows (profile lock), then try again. "
        "If it still fails, try setting EF_CHROME_BINARY to your Chrome app binary and/or "
        "EF_CHROMEDRIVER_PATH to a matching chromedriver."
    )
    details = "\n".join(attempts) if attempts else "(no attempts recorded)"
    raise RuntimeError(f"Failed to start Chrome WebDriver.\n{details}\n{hints}") from last_err
