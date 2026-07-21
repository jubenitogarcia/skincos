#!/usr/bin/env python3
"""Terminal runner for the scraper.

Goal: run specific actions via EF_MODE (no menu).

Security:
- The password is NOT stored in code or files.
- Credentials can be stored securely in the OS Keychain (macOS) via `keyring`.
- You can optionally set EF_LOGIN_EMAIL / EF_LOGIN_PASSWORD as env vars.
- If not provided, the script will prompt (password hidden).

Optional .env support:
- If a .env file exists in this folder, variables will be loaded.
- Recommended: store ONLY EF_LOGIN_EMAIL there (never commit passwords).
"""

from __future__ import annotations

import os
import sys
import json
import unicodedata
from getpass import getpass
from datetime import datetime, timedelta
from pathlib import Path

from espacofacial.config import default_chrome_profile_dir, default_debug_dir, default_output_dir

try:
    from dotenv import load_dotenv  # type: ignore
except Exception:
    load_dotenv = None


PROJECT_DIR = Path(__file__).resolve().parent


def _keyring_available() -> bool:
    try:
        import keyring  # type: ignore

        _ = keyring.get_password
        return True
    except Exception:
        return False


def _keyring_service_name() -> str:
    return "scraper"


def _keyring_get_email_password() -> tuple[str, str]:
    try:
        import keyring  # type: ignore

        service = _keyring_service_name()
        email = keyring.get_password(service, "email") or ""
        password = keyring.get_password(service, "password") or ""
        return email.strip(), password
    except Exception:
        return "", ""


def _keyring_set_email_password(*, email: str, password: str) -> bool:
    try:
        import keyring  # type: ignore

        service = _keyring_service_name()
        keyring.set_password(service, "email", email)
        keyring.set_password(service, "password", password)
        return True
    except Exception:
        return False




def _maybe_print_log_path() -> None:
    try:
        from espacofacial.auth import get_log_file_path

        log_path = get_log_file_path()
        if log_path:
            print(f"\nLog salvo em: {log_path}")
    except Exception:
        return


def _load_env() -> None:
    if load_dotenv is None:
        return
    env_path = PROJECT_DIR / ".env"
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)


def _load_simple_env_file(path: Path, *, allowed_keys: set[str] | None = None) -> None:
    """Load KEY=VALUE pairs from env files without overriding existing vars."""

    if not path.exists():
        return

    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            item = line.strip()
            if not item or item.startswith("#") or "=" not in item:
                continue
            if item.startswith("export "):
                item = item[len("export ") :].strip()
            key, value = item.split("=", 1)
            key = key.strip()
            if allowed_keys is not None and key not in allowed_keys:
                continue
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)
    except Exception:
        return


def _load_login_env_file() -> None:
    """Load login credentials from a user-level env file when present."""

    raw = os.getenv("EF_LOGIN_ENV_FILE", "").strip()
    path = Path(raw).expanduser() if raw else Path("~/.config/espacofacial/login.env").expanduser()
    _load_simple_env_file(path, allowed_keys={"EF_LOGIN_EMAIL", "EF_LOGIN_PASSWORD"})


def _load_booking_env_file() -> None:
    """Load booking API runtime vars from secrets/booking_api.env when present."""

    raw = os.getenv("EF_BOOKING_ENV_FILE", "").strip()
    path = Path(raw).expanduser() if raw else (PROJECT_DIR / "secrets" / "booking_api.env")
    _load_simple_env_file(
        path,
        allowed_keys={
            "EF_BOOKING_API_HOST",
            "EF_BOOKING_API_PORT",
            "EF_BOOKING_API_TOKEN",
            "EF_BOOKING_WEBHOOK_SECRET",
            "EF_MODE",
            "HEADLESS",
        },
    )


def _prompt_yes_no(prompt: str, default: bool) -> bool:
    if _is_non_interactive():
        return default

    suffix = "Y/n" if default else "y/N"
    while True:
        raw = input(f"{prompt} ({suffix}): ").strip().lower()
        if raw == "":
            return default
        if raw in {"y", "yes", "s", "sim"}:
            return True
        if raw in {"n", "no", "nao", "não"}:
            return False
        print("Digite y/n.")


def _env_flag(name: str) -> bool | None:
    raw = os.getenv(name)
    if raw is None:
        return None
    val = raw.strip().lower()
    if val in {"1", "true", "t", "yes", "y", "sim", "s"}:
        return True
    if val in {"0", "false", "f", "no", "n", "nao", "não"}:
        return False
    return None


def _is_non_interactive() -> bool:
    if sys.stdin.isatty():
        return False

    non_interactive_env = _env_flag("EF_NON_INTERACTIVE")
    if non_interactive_env is not None:
        return non_interactive_env
    return True


def _safe_folder_name(value: str) -> str:
    raw = (value or "").strip()
    safe = "".join(ch if ch not in {"/", "\\", ":"} and ord(ch) >= 32 else "_" for ch in raw)
    safe = safe.strip(" .")
    return safe or "sem_unidade"


def _unit_output_dir(base_output_dir: Path, unit_name: str) -> Path:
    path = base_output_dir / _safe_folder_name(unit_name)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _choose_output_dir() -> Path:
    default = os.getenv("EF_OUTPUT_DIR", str(default_output_dir()))
    if _is_non_interactive():
        chosen = Path(default)
        chosen.mkdir(parents=True, exist_ok=True)
        return chosen

    raw = input(f"Pasta de saída (ENTER p/ padrão: {default}): ").strip()
    chosen = Path(raw) if raw else Path(default)
    chosen.mkdir(parents=True, exist_ok=True)
    return chosen


def _choose_unit_name() -> str:
    default = os.getenv("EF_UNIT_NAME", "").strip()
    if _is_non_interactive():
        return default

    if default:
        raw = input(f"Unidade (opcional, ENTER p/ manter: {default}): ").strip()
        return raw or default
    return input("Unidade (opcional, ENTER p/ pular): ").strip()


def _choose_unit_from_list() -> str:
    """Choose a unit from a numbered list (no free typing by default)."""

    env = os.getenv("EF_UNIT_OPTIONS", "").strip()
    options = [o.strip() for o in env.split(",") if o.strip()] if env else ["BarraShoppingSul", "Novo Hamburgo"]

    default = os.getenv("EF_UNIT_NAME", "").strip()
    if default and _is_non_interactive():
        return default

    env_units = os.getenv("EF_UNITS", "").strip()
    if env_units:
        units = [o.strip() for o in env_units.split(",") if o.strip()]
        if len(units) == 1:
            return units[0]

    if not options:
        return default
    if default and default not in options:
        options.append(default)
    if len(options) == 1 and not default:
        return options[0]

    if _is_non_interactive():
        print(
            "Unidade não definida em modo não interativo. "
            "Defina EF_UNIT_NAME ou EF_UNITS com uma única unidade."
        )
        print(f"Opções disponíveis: {', '.join(options)}")
        return ""

    print("\nEscolha a unidade:")
    for i, opt in enumerate(options, start=1):
        print(f"{i}) {opt}")
    if default:
        print(f"0) Pular | ENTER p/ padrão: {default}")
    else:
        print("0) Pular")

    while True:
        raw = input("> ").strip()
        if raw == "":
            return default
        if raw == "0":
            return ""
        try:
            idx = int(raw)
        except ValueError:
            print("Digite um número da lista.")
            continue
        if 1 <= idx <= len(options):
            return options[idx - 1]
        print("Opção inválida.")


def _get_credentials(*, persist_session: bool) -> tuple[str, str]:
    _load_login_env_file()

    # For local usage: prefer Keychain automatically when available.
    use_keyring = _keyring_available()
    os.environ["EF_USE_KEYRING"] = "1" if use_keyring else "0"

    # Fetch credentials from OS keychain.
    if use_keyring:
        email_kr, password_kr = _keyring_get_email_password()
        if email_kr and password_kr:
            return email_kr, password_kr

    email_default = os.getenv("EF_LOGIN_EMAIL", "").strip()
    password_default = os.getenv("EF_LOGIN_PASSWORD", "").strip()
    if email_default and password_default:
        return email_default, password_default

    if _is_non_interactive():
        if not email_default or not password_default:
            print(
                "Credenciais ausentes em modo não interativo. "
                "Defina EF_LOGIN_EMAIL/EF_LOGIN_PASSWORD ou ~/.config/espacofacial/login.env."
            )
        return email_default, password_default

    if email_default:
        email = input(f"Email (ENTER p/ padrão: {email_default}): ").strip() or email_default
    else:
        email = input("Email: ").strip()

    password = password_default or getpass("Senha (não aparece): ").strip()

    # Save to Keychain to avoid retyping on next runs.
    if use_keyring and email and password:
        _keyring_set_email_password(email=email, password=password)

    return email, password


def _set_runtime_env(
    email: str,
    password: str,
    output_dir: Path,
    headless: bool,
    unit_name: str,
    persist_session: bool,
) -> None:
    os.environ["EF_LOGIN_EMAIL"] = email
    os.environ["EF_LOGIN_PASSWORD"] = password
    os.environ["EF_OUTPUT_DIR"] = str(output_dir)
    os.environ["HEADLESS"] = "1" if headless else "0"
    if unit_name.strip():
        os.environ["EF_UNIT_NAME"] = unit_name.strip()
    else:
        os.environ.pop("EF_UNIT_NAME", None)

    # Always enable debug artifacts on error (HTML + screenshot).
    os.environ["EF_DEBUG_ON_ERROR"] = "1"
    os.environ.setdefault("EF_DEBUG_DIR", str(default_debug_dir()))
    # Centralize logs in the same debug folder.
    os.environ.setdefault("EF_LOG_DIR", os.environ["EF_DEBUG_DIR"])

    if persist_session:
        os.environ["EF_PERSIST_SESSION"] = "1"
        # Keep a stable profile path so the session survives runs.
        os.environ.setdefault("EF_CHROME_USER_DATA_DIR", str(default_chrome_profile_dir()))
    else:
        os.environ.pop("EF_PERSIST_SESSION", None)
        os.environ.pop("EF_CHROME_USER_DATA_DIR", None)


def _maybe_print_profile_path() -> None:
    try:
        from espacofacial.core import load_config

        cfg = load_config()
        if cfg.persist_session and cfg.chrome_user_data_dir is not None:
            print(f"Perfil do Chrome (sessão/cookies): {cfg.chrome_user_data_dir}")
    except Exception:
        return


def _write_run_summary(
    *,
    mode: str,
    unit_name: str,
    output_dir: Path,
    status: str,
    started_at: datetime,
    ended_at: datetime,
    details: dict[str, object] | None = None,
    outputs: list[str] | None = None,
) -> Path:
    debug_dir = Path(os.getenv("EF_DEBUG_DIR", str(default_debug_dir()))).expanduser()
    debug_dir.mkdir(parents=True, exist_ok=True)

    payload = {
        "mode": mode,
        "unit": unit_name,
        "status": status,
        "started_at": started_at.isoformat(timespec="seconds"),
        "ended_at": ended_at.isoformat(timespec="seconds"),
        "duration_s": round((ended_at - started_at).total_seconds(), 2),
        "output_dir": str(output_dir),
        "outputs": outputs or [],
        "details": details or {},
    }

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = debug_dir / f"run_summary_{mode}_{ts}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _run_agenda(
    headless: bool,
    output_dir: Path,
    unit_name: str,
    persist_session: bool,
    *,
    agenda_mode: str = "full",
) -> int:
    started_at = datetime.now()
    email, password = _get_credentials(persist_session=persist_session)
    if (not email or not password) and not persist_session:
        print("Credenciais não informadas. Abortando.")
        _write_run_summary(
            mode="agenda" if agenda_mode == "full" else f"agenda_{agenda_mode}",
            unit_name=unit_name,
            output_dir=output_dir,
            status="failed",
            started_at=started_at,
            ended_at=datetime.now(),
            details={"reason": "missing_credentials"},
        )
        return 2

    _set_runtime_env(email, password, output_dir, headless, unit_name, persist_session)

    try:
        from espacofacial.auth import configure_file_logging, log

        configure_file_logging(output_dir, prefix="menu_appointments")
        log(f"Starting appointments run ({agenda_mode})")
    except Exception:
        pass

    import scraper_final

    ok = scraper_final.main(mode=agenda_mode)
    outputs: list[str] = []
    if agenda_mode == "full":
        outputs = [
            str(output_dir / "agendamentos_espacofacial_completo.csv"),
            str(output_dir / "agendamentos_espacofacial_completo.xlsx"),
        ]
    elif agenda_mode == "index":
        outputs = [
            str(output_dir / "agendamentos_espacofacial_index.csv"),
            str(output_dir / "agendamentos_espacofacial_index.xlsx"),
        ]
    elif agenda_mode == "delta":
        outputs = [
            str(output_dir / "agendamentos_espacofacial_index.csv"),
            str(output_dir / "agendamentos_espacofacial_index.xlsx"),
        ]
        delta_csv = output_dir / "agendamentos_espacofacial_delta.csv"
        delta_xlsx = output_dir / "agendamentos_espacofacial_delta.xlsx"
        if delta_csv.exists():
            outputs.append(str(delta_csv))
        if delta_xlsx.exists():
            outputs.append(str(delta_xlsx))
    details: dict[str, object] = {}
    if ok:
        try:
            import pandas as pd

            if agenda_mode == "full":
                csv_path = output_dir / "agendamentos_espacofacial_completo.csv"
                if csv_path.exists():
                    df = pd.read_csv(csv_path)
                    details["rows"] = int(len(df))
                    required = ["Cliente", "Tipo de Agendamento", "Profissional", "Horário"]
                    missing = [c for c in required if c not in df.columns]
                    if missing:
                        details["missing_columns"] = missing
                        log(f"WARNING: missing appointment columns: {missing}")
            elif agenda_mode == "index":
                csv_path = output_dir / "agendamentos_espacofacial_index.csv"
                if csv_path.exists():
                    df = pd.read_csv(csv_path)
                    details["rows_index"] = int(len(df))
            elif agenda_mode == "delta":
                csv_path = output_dir / "agendamentos_espacofacial_delta.csv"
                if csv_path.exists():
                    df = pd.read_csv(csv_path)
                    details["rows_delta"] = int(len(df))
                else:
                    details["rows_delta"] = 0
        except Exception:
            pass

    _write_run_summary(
        mode="agenda" if agenda_mode == "full" else f"agenda_{agenda_mode}",
        unit_name=unit_name,
        output_dir=output_dir,
        status="success" if ok else "failed",
        started_at=started_at,
        ended_at=datetime.now(),
        details=details,
        outputs=outputs if ok else [],
    )
    return 0 if ok else 1


def _prompt_int(prompt: str, default: int, *, min_value: int = 1, max_value: int = 3650) -> int:
    if _is_non_interactive():
        return default

    while True:
        raw = input(f"{prompt} (ENTER p/ padrão: {default}): ").strip()
        if raw == "":
            return default
        try:
            val = int(raw)
        except ValueError:
            print("Digite um número inteiro.")
            continue
        if val < min_value or val > max_value:
            print(f"Digite um valor entre {min_value} e {max_value}.")
            continue
        return val


def _prompt_date(prompt: str, default: str) -> str:
    if _is_non_interactive():
        return default

    while True:
        raw = input(f"{prompt} (DD/MM/AAAA) (ENTER p/ padrão: {default}): ").strip()
        val = raw or default
        try:
            datetime.strptime(val, "%d/%m/%Y")
        except ValueError:
            print("Data inválida. Use o formato DD/MM/AAAA (ex: 10/01/2026).")
            continue
        return val


def _prompt_date_range(*, default_days: int = 7) -> tuple[str, str]:
    mode = os.getenv("EF_DATE_RANGE_MODE", "").strip().lower()
    if mode in {"prev_month", "previous_month", "last_month"}:
        today = datetime.now().date()
        first_of_this_month = today.replace(day=1)
        last_of_prev_month = first_of_this_month - timedelta(days=1)
        first_of_prev_month = last_of_prev_month.replace(day=1)
        return first_of_prev_month.strftime("%d/%m/%Y"), last_of_prev_month.strftime("%d/%m/%Y")

    today = datetime.now().date()
    default_end = today.strftime("%d/%m/%Y")
    default_start = (today - timedelta(days=default_days)).strftime("%d/%m/%Y")

    while True:
        start_str = _prompt_date("Data inicial", default_start)
        end_str = _prompt_date("Data final", default_end)
        start_dt = datetime.strptime(start_str, "%d/%m/%Y").date()
        end_dt = datetime.strptime(end_str, "%d/%m/%Y").date()
        if end_dt < start_dt:
            print("Data final não pode ser menor que a inicial.")
            continue
        return start_str, end_str


def _daterange_days(start_date: datetime.date, end_date: datetime.date):
    cur = start_date
    while cur <= end_date:
        yield cur
        cur = cur + timedelta(days=1)


def _run_cash(headless: bool, output_dir: Path, unit_name: str, persist_session: bool) -> int:
    email, password = _get_credentials(persist_session=persist_session)
    if (not email or not password) and not persist_session:
        print("Credenciais não informadas. Abortando.")
        return 2

    start_str, end_str = _prompt_date_range(default_days=7)

    _set_runtime_env(email, password, output_dir, headless, unit_name, persist_session)

    from espacofacial.auth import Credentials, configure_file_logging, log, log_exception, login_and_select_unit
    from espacofacial.cash import extract_cash_breakdown, navigate_to_cash, set_date_range, summarize_cash_rows_for_sheets
    from espacofacial.core import create_driver, load_config
    from espacofacial.diagnostics import capture_artifacts
    from espacofacial.sheets import upsert_cash_rows

    cfg = load_config()
    configure_file_logging(cfg.output_dir, prefix="menu_cash")
    if cfg.persist_session and cfg.chrome_user_data_dir is not None:
        log(f"Chrome profile: {cfg.chrome_user_data_dir}")
    driver = create_driver(headless=cfg.headless, user_data_dir=cfg.chrome_user_data_dir)
    try:
        creds = Credentials(cfg.email, cfg.password)
        if not login_and_select_unit(
            driver,
            base_url=cfg.base_url,
            creds=creds,
            unit_name=cfg.unit_name,
            timeout_seconds=cfg.timeout_seconds,
        ):
            # If the user chose to skip creds expecting a persisted session, prompt once and retry.
            if cfg.persist_session and (not cfg.email or not cfg.password):
                print("Sessão salva não estava logada. Informe email/senha para logar uma vez.")
                email2, password2 = _get_credentials(persist_session=False)
                if not email2 or not password2:
                    return 1
                os.environ["EF_LOGIN_EMAIL"] = email2
                os.environ["EF_LOGIN_PASSWORD"] = password2
                if not login_and_select_unit(
                    driver,
                    base_url=cfg.base_url,
                    creds=Credentials(email2, password2),
                    unit_name=cfg.unit_name,
                    timeout_seconds=cfg.timeout_seconds,
                ):
                    return 1
            else:
                return 1
        if not navigate_to_cash(driver, cfg.cash_url, timeout_seconds=cfg.timeout_seconds):
            return 1

        # Extract day-by-day for the requested period.
        start_dt = datetime.strptime(start_str, "%d/%m/%Y").date()
        end_dt = datetime.strptime(end_str, "%d/%m/%Y").date()
        all_rows = []
        day_columns: list[str] = []
        day_labels: list[str] = []
        days_with_no_receipts: set[str] = set()
        days_skipped_on_error: set[str] = set()

        for day in _daterange_days(start_dt, end_dt):
            day_label = day.strftime("%d/%m/%Y")
            day_iso = day.strftime("%Y-%m-%d")
            day_columns.append(day.strftime("%d"))
            day_labels.append(day_label)
            log(f"\n=== Caixa: {day_label} ===")

            try:
                set_date_range(driver, start_date=day_iso, end_date=day_iso)
                rows = extract_cash_breakdown(driver, start_date=day_label, end_date=day_label)
            except Exception as e:
                log_exception(f"ERROR: Cash extraction failed for {day_label} (skipping day)", e)
                if cfg.debug_on_error:
                    artifacts = capture_artifacts(
                        driver,
                        output_dir=cfg.debug_dir,
                        label=f"error_cash_{day.strftime('%Y%m%d')}",
                    )
                    if artifacts.html_path:
                        log(f"Saved debug HTML: {artifacts.html_path}")
                    if artifacts.screenshot_path:
                        log(f"Saved debug screenshot: {artifacts.screenshot_path}")
                days_skipped_on_error.add(day_label)
                continue
            non_total_rows = [r for r in rows if str(r.get("Forma de Pagamento") or "").strip().upper() != "TOTAL"]
            if not non_total_rows:
                log(f"⚠ No receivables for {day_label} (writing zeros)")
                if cfg.debug_on_error:
                    artifacts = capture_artifacts(driver, output_dir=cfg.debug_dir, label=f"no_cash_rows_{day.strftime('%Y%m%d')}")
                    if artifacts.html_path:
                        log(f"Saved debug HTML: {artifacts.html_path}")
                    if artifacts.screenshot_path:
                        log(f"Saved debug screenshot: {artifacts.screenshot_path}")
                days_with_no_receipts.add(day_label)
                continue
            all_rows.extend(rows)

        if not all_rows and not days_with_no_receipts:
            log("ERROR: No cash rows extracted for any day")
            return 1

        # Aggregate and write to Google Sheets.
        spreadsheet_id = os.getenv("EF_SHEETS_SPREADSHEET_ID", "1OBJ3RAjQqV3cQNN8xzSbRgu4leTMsSFM2X5TOnrGmSI").strip()
        worksheet_name = os.getenv("EF_SHEETS_TAB_NAME", "Caixa").strip() or "Caixa"

        per_day = summarize_cash_rows_for_sheets(all_rows)

        # Ensure every requested day gets a row (zeros) when there are no receivables.
        zero_bucket = {
            "credit": 0.0,
            "debit": 0.0,
            "cash": 0.0,
            "ecommerce": 0.0,
            "transfer": 0.0,
            "total": 0.0,
        }
        for day_label in day_labels:
            if day_label in days_skipped_on_error:
                continue
            per_day.setdefault(day_label, dict(zero_bucket))

        ordered_payload: list[dict[str, object]] = []
        for day_label in day_labels:
            vals = per_day.get(day_label)
            if not vals:
                continue
            ordered_payload.append(
                {
                    "DATE": day_label,
                    "CREDIT": float(vals["credit"]),
                    "DEBIT": float(vals["debit"]),
                    "CASH": float(vals["cash"]),
                    "ECOMMERCE": float(vals["ecommerce"]),
                    "TRANSFER": float(vals["transfer"]),
                    "TOTAL": float(vals["total"]),
                }
            )

        try:
            upsert_cash_rows(
                spreadsheet_id=spreadsheet_id,
                worksheet_name=worksheet_name,
                rows=ordered_payload,
                unit_name=str(cfg.unit_name or "").strip(),
            )
        except Exception as e:
            log_exception("ERROR: Failed to write to Google Sheets", e)
            print("\nFalha ao salvar no Google Sheets.")
            print("Config necessária:")
            print("- Defina EF_SHEETS_CREDENTIALS apontando para um JSON de credenciais (Service Account ou OAuth).")
            print("- Se usar Service Account, compartilhe a planilha com o email do service account.")
            print("- (Opcional) EF_SHEETS_SPREADSHEET_ID e EF_SHEETS_TAB_NAME.")
            return 1

        sheet_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
        print("\nDados enviados para Google Sheets:")
        print(f"- Planilha: {sheet_url}")
        print(f"- Aba: {worksheet_name}")
        return 0
    except Exception as e:
        log_exception("ERROR: Unexpected failure", e)
        if cfg.debug_on_error:
            artifacts = capture_artifacts(driver, output_dir=cfg.debug_dir, label="error_cash")
            if artifacts.html_path:
                log(f"Saved debug HTML: {artifacts.html_path}")
            if artifacts.screenshot_path:
                log(f"Saved debug screenshot: {artifacts.screenshot_path}")
        return 1
    finally:
        try:
            driver.quit()
        except Exception:
            pass


def _run_cash_clients(headless: bool, output_dir: Path, unit_name: str, persist_session: bool) -> int:
    email, password = _get_credentials(persist_session=persist_session)
    if (not email or not password) and not persist_session:
        print("Credenciais não informadas. Abortando.")
        return 2

    start_str, end_str = _prompt_date_range(default_days=7)

    _set_runtime_env(email, password, output_dir, headless, unit_name, persist_session)

    from espacofacial.auth import Credentials, configure_file_logging, log, log_exception, login_and_select_unit
    from espacofacial.cash import extract_cash_sales_payments, navigate_to_cash, set_date_range
    from espacofacial.dataframe_tools import (
        append_total_row,
        replace_zero_with_dash,
        sort_by_date_time,
        trim_empty_rows_cols,
    )
    from espacofacial.core import create_driver, load_config
    from espacofacial.diagnostics import capture_artifacts

    cfg = load_config()
    configure_file_logging(cfg.output_dir, prefix="menu_cash_clients")
    if cfg.persist_session and cfg.chrome_user_data_dir is not None:
        log(f"Chrome profile: {cfg.chrome_user_data_dir}")
    driver = create_driver(headless=cfg.headless, user_data_dir=cfg.chrome_user_data_dir)
    try:
        creds = Credentials(cfg.email, cfg.password)
        if not login_and_select_unit(
            driver,
            base_url=cfg.base_url,
            creds=creds,
            unit_name=cfg.unit_name,
            timeout_seconds=cfg.timeout_seconds,
        ):
            if cfg.persist_session and (not cfg.email or not cfg.password):
                print("Sessão salva não estava logada. Informe email/senha para logar uma vez.")
                email2, password2 = _get_credentials(persist_session=False)
                if not email2 or not password2:
                    return 1
                os.environ["EF_LOGIN_EMAIL"] = email2
                os.environ["EF_LOGIN_PASSWORD"] = password2
                if not login_and_select_unit(
                    driver,
                    base_url=cfg.base_url,
                    creds=Credentials(email2, password2),
                    unit_name=cfg.unit_name,
                    timeout_seconds=cfg.timeout_seconds,
                ):
                    return 1
            else:
                return 1
        if not navigate_to_cash(driver, cfg.cash_url, timeout_seconds=cfg.timeout_seconds):
            return 1

        start_dt = datetime.strptime(start_str, "%d/%m/%Y").date()
        end_dt = datetime.strptime(end_str, "%d/%m/%Y").date()
        start_iso = start_dt.strftime("%Y-%m-%d")
        end_iso = end_dt.strftime("%Y-%m-%d")

        log(f"\n=== Caixa (clientes): {start_str} a {end_str} ===")

        try:
            set_date_range(driver, start_date=start_iso, end_date=end_iso)
            all_rows = extract_cash_sales_payments(driver, start_date=start_str, end_date=end_str)
        except Exception as e:
            log_exception("ERROR: Sales payments extraction failed", e)
            if cfg.debug_on_error:
                artifacts = capture_artifacts(driver, output_dir=cfg.debug_dir, label="error_cash_clients")
                if artifacts.html_path:
                    log(f"Saved debug HTML: {artifacts.html_path}")
                if artifacts.screenshot_path:
                    log(f"Saved debug screenshot: {artifacts.screenshot_path}")
            return 1

        if not all_rows:
            log("ERROR: No sales/payment rows extracted for the selected period")
            return 1

        import pandas as pd  # Local import so the extra dependency only loads when needed.

        df = pd.DataFrame(all_rows)
        preferred_columns = [
            "Data",
            "Horário",
            "Cliente",
            "Valor",
            "Crédito Cliente",
            "Valor Pago",
            "Parcelas",
            "Pagamento",
            "Data Inicial",
            "Data Final",
        ]
        columns = [col for col in preferred_columns if col in df.columns]
        df = df[columns]
        df = sort_by_date_time(df, date_col="Data", time_col="Horário")
        df = append_total_row(df, label_column="Data")
        df = replace_zero_with_dash(df)
        df = trim_empty_rows_cols(df)

        start_name = datetime.strptime(start_str, "%d/%m/%Y").strftime("%Y%m%d")
        end_name = datetime.strptime(end_str, "%d/%m/%Y").strftime("%Y%m%d")
        csv_path = output_dir / f"caixa_recebimentos_clientes_{start_name}_a_{end_name}.csv"
        df.to_csv(csv_path, index=False, encoding="utf-8")

        log(f"✓ Saved CSV: {csv_path}")
        print("\nRecebimentos por cliente exportados:")
        print(f"- {csv_path}")
        return 0
    except Exception as e:
        log_exception("ERROR: Unexpected failure", e)
        if cfg.debug_on_error:
            artifacts = capture_artifacts(driver, output_dir=cfg.debug_dir, label="error_cash_clients")
            if artifacts.html_path:
                log(f"Saved debug HTML: {artifacts.html_path}")
            if artifacts.screenshot_path:
                log(f"Saved debug screenshot: {artifacts.screenshot_path}")
        return 1
    finally:
        try:
            driver.quit()
        except Exception:
            pass


def _run_cash_combined(headless: bool, output_dir: Path, unit_name: str, persist_session: bool) -> int:
    """Export caixa resumo (por pagamento) + clientes em um único XLSX."""

    started_at = datetime.now()
    email, password = _get_credentials(persist_session=persist_session)
    if (not email or not password) and not persist_session:
        print("Credenciais não informadas. Abortando.")
        _write_run_summary(
            mode="caixa",
            unit_name=unit_name,
            output_dir=output_dir,
            status="failed",
            started_at=started_at,
            ended_at=datetime.now(),
            details={"reason": "missing_credentials"},
        )
        return 2

    start_str, end_str = _prompt_date_range(default_days=7)

    _set_runtime_env(email, password, output_dir, headless, unit_name, persist_session)

    from espacofacial.auth import Credentials, configure_file_logging, log, log_exception, login_and_select_unit
    from espacofacial.cash import extract_cash_breakdown, extract_cash_sales_payments, navigate_to_cash, set_date_range
    from espacofacial.cash import _group_payment_method  # noqa: WPS450 - reuse internal formatter
    from espacofacial.dataframe_tools import (
        append_total_row,
        replace_zero_with_dash,
        sort_by_date_time,
        trim_empty_rows_cols,
    )
    from espacofacial.excel import format_workbook
    from espacofacial.core import create_driver, load_config
    from espacofacial.diagnostics import capture_artifacts

    cfg = load_config()
    configure_file_logging(cfg.output_dir, prefix="menu_cash_combined")
    if cfg.persist_session and cfg.chrome_user_data_dir is not None:
        log(f"Chrome profile: {cfg.chrome_user_data_dir}")
    driver = create_driver(headless=cfg.headless, user_data_dir=cfg.chrome_user_data_dir)
    try:
        creds = Credentials(cfg.email, cfg.password)
        if not login_and_select_unit(
            driver,
            base_url=cfg.base_url,
            creds=creds,
            unit_name=cfg.unit_name,
            timeout_seconds=cfg.timeout_seconds,
        ):
            if cfg.persist_session and (not cfg.email or not cfg.password):
                print("Sessão salva não estava logada. Informe email/senha para logar uma vez.")
                email2, password2 = _get_credentials(persist_session=False)
                if not email2 or not password2:
                    return 1
                os.environ["EF_LOGIN_EMAIL"] = email2
                os.environ["EF_LOGIN_PASSWORD"] = password2
                if not login_and_select_unit(
                    driver,
                    base_url=cfg.base_url,
                    creds=Credentials(email2, password2),
                    unit_name=cfg.unit_name,
                    timeout_seconds=cfg.timeout_seconds,
                ):
                    return 1
            else:
                return 1
        if not navigate_to_cash(driver, cfg.cash_url, timeout_seconds=cfg.timeout_seconds):
            return 1

        start_dt = datetime.strptime(start_str, "%d/%m/%Y").date()
        end_dt = datetime.strptime(end_str, "%d/%m/%Y").date()
        start_iso = start_dt.strftime("%Y-%m-%d")
        end_iso = end_dt.strftime("%Y-%m-%d")

        log(f"\n=== Caixa (combined): {start_str} a {end_str} ===")

        # 1) Clientes (tabela principal) para todo o período.
        try:
            set_date_range(driver, start_date=start_iso, end_date=end_iso)
            client_rows = extract_cash_sales_payments(driver, start_date=start_str, end_date=end_str)
        except Exception as e:
            log_exception("ERROR: Sales payments extraction failed", e)
            if cfg.debug_on_error:
                artifacts = capture_artifacts(driver, output_dir=cfg.debug_dir, label="error_cash_clients")
                if artifacts.html_path:
                    log(f"Saved debug HTML: {artifacts.html_path}")
                if artifacts.screenshot_path:
                    log(f"Saved debug screenshot: {artifacts.screenshot_path}")
            return 1

        # 2) Resumo por forma de pagamento (diário).
        payment_rows: list[dict[str, object]] = []
        for day in _daterange_days(start_dt, end_dt):
            day_label = day.strftime("%d/%m/%Y")
            day_iso = day.strftime("%Y-%m-%d")
            log(f"\n=== Caixa (pagamentos): {day_label} ===")
            try:
                set_date_range(driver, start_date=day_iso, end_date=day_iso)
                rows = extract_cash_breakdown(driver, start_date=day_label, end_date=day_label)
            except Exception as e:
                log_exception(f"ERROR: Cash breakdown failed for {day_label} (skipping day)", e)
                if cfg.debug_on_error:
                    artifacts = capture_artifacts(
                        driver,
                        output_dir=cfg.debug_dir,
                        label=f"error_cash_breakdown_{day.strftime('%Y%m%d')}",
                    )
                    if artifacts.html_path:
                        log(f"Saved debug HTML: {artifacts.html_path}")
                    if artifacts.screenshot_path:
                        log(f"Saved debug screenshot: {artifacts.screenshot_path}")
                continue
            if not rows:
                log(f"⚠ No payment methods for {day_label}")
                continue
            payment_rows.extend(rows)

        if not client_rows and not payment_rows:
            log("ERROR: No rows extracted for combined export")
            _write_run_summary(
                mode="caixa",
                unit_name=unit_name,
                output_dir=output_dir,
                status="failed",
                started_at=started_at,
                ended_at=datetime.now(),
                details={"reason": "no_rows"},
            )
            return 1

        import pandas as pd

        # Prepare clients sheet.
        df_clients = pd.DataFrame(client_rows or [])
        preferred_clients = [
            "Data",
            "Horário",
            "Cliente",
            "Status",
            "Valor",
            "Crédito Cliente",
            "Valor Pago",
            "Parcelas",
            "Pagamento",
            "Data Inicial",
            "Data Final",
        ]
        if not df_clients.empty:
            cols = [col for col in preferred_clients if col in df_clients.columns]
            df_clients = df_clients[cols]
        missing_clients = [c for c in preferred_clients if c not in df_clients.columns]

        # Prepare payments sheet.
        df_payments = pd.DataFrame(payment_rows or [])
        required_payments = ["Forma de Pagamento", "Quantidade", "Valor", "Data Inicial", "Data Final"]
        missing_payments = [c for c in required_payments if c not in df_payments.columns]
        df_payments_all = df_payments.copy()

        if missing_clients and not df_clients.empty:
            log(f"ERROR: Missing client columns: {missing_clients}")
            _write_run_summary(
                mode="caixa",
                unit_name=unit_name,
                output_dir=output_dir,
                status="failed",
                started_at=started_at,
                ended_at=datetime.now(),
                details={"reason": "missing_columns", "missing_clients": missing_clients},
            )
            return 1
        if missing_payments and not df_payments.empty:
            log(f"ERROR: Missing payment columns: {missing_payments}")
            _write_run_summary(
                mode="caixa",
                unit_name=unit_name,
                output_dir=output_dir,
                status="failed",
                started_at=started_at,
                ended_at=datetime.now(),
                details={"reason": "missing_columns", "missing_payments": missing_payments},
            )
            return 1

        # Integrity check for totals.
        discrepancies: list[dict[str, object]] = []
        if not df_payments_all.empty:
            def _to_float(val: object) -> float:
                if isinstance(val, (int, float)):
                    return float(val)
                if isinstance(val, str):
                    raw = val.replace("R$", "").replace(".", "").replace(",", ".").strip()
                    try:
                        return float(raw)
                    except Exception:
                        return 0.0
                return 0.0

            tmp = df_payments_all.copy()
            tmp["_valor_num"] = tmp["Valor"].apply(_to_float)

            for day_label in tmp["Data Inicial"].dropna().unique():
                day_rows = tmp[tmp["Data Inicial"] == day_label]
                total_rows = day_rows[day_rows["Forma de Pagamento"].astype(str).str.upper() == "TOTAL"]
                if total_rows.empty:
                    continue
                total_val = float(total_rows["_valor_num"].sum())
                sum_val = float(day_rows[day_rows["Forma de Pagamento"].astype(str).str.upper() != "TOTAL"]["_valor_num"].sum())
                if abs(total_val - sum_val) > 0.01:
                    discrepancies.append({"day": day_label, "total": total_val, "sum": sum_val})
            if discrepancies:
                log(f"WARNING: Total discrepancies found: {len(discrepancies)}")

        # Group payment methods for export (per day).
        df_payments_grouped = pd.DataFrame()
        if not df_payments_all.empty:
            tmp_group = df_payments_all.copy()
            tmp_group = tmp_group[tmp_group["Forma de Pagamento"].astype(str).str.upper() != "TOTAL"]
            if not tmp_group.empty:
                tmp_group["Forma de Pagamento"] = tmp_group["Forma de Pagamento"].apply(_group_payment_method)
                tmp_group["_valor_num"] = tmp_group["Valor"].apply(_to_float)
                if "Quantidade" in tmp_group.columns:
                    def _to_int(val: object) -> int:
                        if isinstance(val, (int, float)):
                            return int(val)
                        if isinstance(val, str):
                            raw = val.strip()
                            if not raw:
                                return 0
                            try:
                                return int(float(raw.replace(",", ".")))
                            except Exception:
                                return 0
                        return 0
                    tmp_group["_quant_num"] = tmp_group["Quantidade"].apply(_to_int)
                else:
                    tmp_group["_quant_num"] = 0

                grouped = tmp_group.groupby(
                    ["Data Inicial", "Forma de Pagamento"],
                    as_index=False,
                )[["_quant_num", "_valor_num"]].sum()
                grouped.rename(
                    columns={"_quant_num": "Quantidade", "_valor_num": "Valor"},
                    inplace=True,
                )
                df_payments_grouped = grouped

        # Build total sheet (sum of methods for the whole period).
        df_total = pd.DataFrame()
        if not df_payments_grouped.empty:
            tmp_total = df_payments_grouped.copy()
            tmp_total["_valor_num"] = tmp_total["Valor"].apply(_to_float)
            if not tmp_total.empty:
                grouped = tmp_total.groupby("Forma de Pagamento", as_index=False)["_valor_num"].sum()
                grouped.rename(columns={"_valor_num": "Valor Total"}, inplace=True)
                df_total = grouped

        # Prepare export frames (remove TOTAL row and drop date range columns).
        if not df_payments_grouped.empty:
            df_payments = df_payments_grouped.copy()

        if not df_payments.empty:
            df_payments = df_payments[df_payments["Forma de Pagamento"].astype(str).str.upper() != "TOTAL"]
            if "Valor" in df_payments.columns:
                df_payments["Valor"] = df_payments["Valor"].apply(
                    lambda v: float(v) if isinstance(v, (int, float)) else v
                )

        if not df_clients.empty:
            df_clients = df_clients.drop(columns=[c for c in ["Data Inicial", "Data Final"] if c in df_clients.columns])
        if not df_payments.empty:
            df_payments = df_payments.drop(columns=[c for c in ["Data Final"] if c in df_payments.columns])
            if "Data Inicial" in df_payments.columns:
                df_payments = df_payments.rename(columns={"Data Inicial": "Dia"})
            preferred_payments = ["Dia", "Forma de Pagamento", "Quantidade", "Valor"]
            cols = [c for c in preferred_payments if c in df_payments.columns]
            cols += [c for c in df_payments.columns if c not in cols]
            df_payments = df_payments[cols]
            df_payments = sort_by_date_time(
                df_payments,
                date_col="Dia",
                time_col=None,
                extra_sort=["Forma de Pagamento"],
            )
            df_payments = append_total_row(df_payments, label_column="Dia")
            df_payments = replace_zero_with_dash(df_payments)
            df_payments = trim_empty_rows_cols(df_payments)

        def _is_cancelled_status(val: object) -> bool:
            raw = str(val or "").strip()
            if not raw:
                return False
            normalized = "".join(
                ch
                for ch in unicodedata.normalize("NFD", raw)
                if unicodedata.category(ch) != "Mn"
            ).lower()
            return "cancel" in normalized

        df_clients_paid = pd.DataFrame()
        df_clients_cancelled = pd.DataFrame()
        if not df_clients.empty and "Status" in df_clients.columns:
            cancelled_mask = df_clients["Status"].apply(_is_cancelled_status)
            df_clients_cancelled = df_clients[cancelled_mask].copy()
            df_clients_paid = df_clients[~cancelled_mask].copy()
        elif not df_clients.empty:
            df_clients_paid = df_clients.copy()

        if not df_clients_paid.empty:
            df_clients_paid = sort_by_date_time(df_clients_paid, date_col="Data", time_col="Horário")
            df_clients_paid = append_total_row(df_clients_paid, label_column="Data")
            df_clients_paid = replace_zero_with_dash(df_clients_paid)
            df_clients_paid = trim_empty_rows_cols(df_clients_paid)
        if not df_clients_cancelled.empty:
            df_clients_cancelled = sort_by_date_time(df_clients_cancelled, date_col="Data", time_col="Horário")
            df_clients_cancelled = append_total_row(df_clients_cancelled, label_column="Data")
            df_clients_cancelled = replace_zero_with_dash(df_clients_cancelled)
            df_clients_cancelled = trim_empty_rows_cols(df_clients_cancelled)

        if not df_clients_paid.empty and "Status" in df_clients_paid.columns:
            df_clients_paid = df_clients_paid.drop(columns=["Status"])
        if not df_clients_cancelled.empty and "Status" in df_clients_cancelled.columns:
            df_clients_cancelled = df_clients_cancelled.drop(columns=["Status"])

        if not df_total.empty:
            df_total = append_total_row(df_total, label_column="Forma de Pagamento")
            df_total = replace_zero_with_dash(df_total)
            df_total = trim_empty_rows_cols(df_total)

        dry_run = os.getenv("EF_DRY_RUN", "").strip().lower() in {"1", "true", "yes", "y", "sim"}

        start_name = datetime.strptime(start_str, "%d/%m/%Y").strftime("%Y%m%d")
        end_name = datetime.strptime(end_str, "%d/%m/%Y").strftime("%Y%m%d")
        xlsx_output_dir = _unit_output_dir(output_dir, unit_name)
        xlsx_path = xlsx_output_dir / f"caixa_recebimentos_completo_{start_name}_a_{end_name}.xlsx"
        finance_delivery_path = xlsx_output_dir / f"caixa_finance_delivery_{start_name}_a_{end_name}.json"
        finance_outputs: list[str] = []

        if not dry_run:
            with pd.ExcelWriter(xlsx_path, engine="openpyxl") as writer:
                if not df_clients.empty:
                    df_clients_paid.to_excel(writer, index=False, sheet_name="Cliente")
                    df_clients_cancelled.to_excel(writer, index=False, sheet_name="Cancelado")
                if not df_payments.empty:
                    df_payments.to_excel(writer, index=False, sheet_name="Forma Pagamento")
                if not df_total.empty:
                    df_total.to_excel(writer, index=False, sheet_name="Total")
            format_workbook(xlsx_path)

            # The JSON delivery is a neutral, versioned hand-off. Finance will
            # stage it later through its authenticated import pipeline; this
            # collector never connects to D1 or posts financial movements.
            from hashlib import sha256
            from uuid import uuid4
            from espacofacial.finance_caixa import write_finance_caixa_delivery

            finance_outputs = [str(xlsx_path)]
            if client_rows:
                write_finance_caixa_delivery(
                    client_rows,
                    output_path=finance_delivery_path,
                    unit_name=unit_name,
                    period_from=start_dt,
                    period_to=end_dt,
                    execution_id=f"ef-caixa-{uuid4()}",
                    artifact_id=xlsx_path.name,
                    artifact_sha256=sha256(xlsx_path.read_bytes()).hexdigest(),
                )
                finance_outputs.append(str(finance_delivery_path))
                log(f"✓ Saved Finance delivery: {finance_delivery_path}")
            else:
                log("⚠ Caixa EF sem linhas detalhadas; resumo por pagamento não gera entrega Financeiro.")

            log(f"✓ Saved XLSX: {xlsx_path}")
            print("\nCaixa exportado (clientes + pagamentos):")
            print(f"- {xlsx_path}")
        else:
            log("DRY-RUN: skipping XLSX export")

        details = {
            "rows_clients": int(len(df_clients)),
            "rows_payments": int(len(df_payments)),
            "rows_total": int(len(df_total)) if not df_total.empty else 0,
            "dry_run": dry_run,
        }
        if discrepancies:
            details["total_discrepancies"] = discrepancies

        _write_run_summary(
            mode="caixa",
            unit_name=unit_name,
            output_dir=output_dir,
            status="success",
            started_at=started_at,
            ended_at=datetime.now(),
            details=details,
            outputs=finance_outputs,
        )
        return 0
    except Exception as e:
        log_exception("ERROR: Unexpected failure", e)
        if cfg.debug_on_error:
            artifacts = capture_artifacts(driver, output_dir=cfg.debug_dir, label="error_cash_combined")
            if artifacts.html_path:
                log(f"Saved debug HTML: {artifacts.html_path}")
            if artifacts.screenshot_path:
                log(f"Saved debug screenshot: {artifacts.screenshot_path}")
        _write_run_summary(
            mode="caixa",
            unit_name=unit_name,
            output_dir=output_dir,
            status="failed",
            started_at=started_at,
            ended_at=datetime.now(),
            details={"error": str(e)},
        )
        return 1
    finally:
        try:
            driver.quit()
        except Exception:
            pass


def _run_debug(action: str, headless: bool, output_dir: Path, unit_name: str, persist_session: bool) -> int:
    email, password = _get_credentials(persist_session=persist_session)
    if (not email or not password) and not persist_session:
        print("Credenciais não informadas. Abortando.")
        return 2

    _set_runtime_env(email, password, output_dir, headless, unit_name, persist_session)

    from espacofacial.auth import Credentials, configure_file_logging, log, log_exception, login_and_select_unit
    from espacofacial.core import create_driver, load_config
    from espacofacial.debug_tools import dump_cash, dump_reception, test_first_modal
    from espacofacial.diagnostics import capture_artifacts

    cfg = load_config()
    configure_file_logging(cfg.output_dir, prefix=f"menu_debug_{action}")
    debug_dir = cfg.output_dir / "debug"
    if cfg.persist_session and cfg.chrome_user_data_dir is not None:
        log(f"Chrome profile: {cfg.chrome_user_data_dir}")
    driver = create_driver(headless=cfg.headless, user_data_dir=cfg.chrome_user_data_dir)
    try:
        if not login_and_select_unit(
            driver,
            base_url=cfg.base_url,
            creds=Credentials(cfg.email, cfg.password),
            unit_name=cfg.unit_name,
            timeout_seconds=cfg.timeout_seconds,
        ):
            if cfg.persist_session and (not cfg.email or not cfg.password):
                print("Sessão salva não estava logada. Informe email/senha para logar uma vez.")
                email2, password2 = _get_credentials(persist_session=False)
                if not email2 or not password2:
                    return 1
                os.environ["EF_LOGIN_EMAIL"] = email2
                os.environ["EF_LOGIN_PASSWORD"] = password2
                if not login_and_select_unit(
                    driver,
                    base_url=cfg.base_url,
                    creds=Credentials(email2, password2),
                    unit_name=cfg.unit_name,
                    timeout_seconds=cfg.timeout_seconds,
                ):
                    return 1
            else:
                return 1

        if action == "reception":
            dump_reception(driver, cfg.reception_url, debug_dir)
            return 0
        if action == "cash":
            dump_cash(driver, cfg.cash_url, debug_dir)
            return 0
        if action == "modal":
            test_first_modal(driver, cfg.reception_url, debug_dir)
            return 0

        print("Ação de debug inválida.")
        return 2
    except Exception as e:
        log_exception("ERROR: Unexpected failure", e)
        if cfg.debug_on_error:
            artifacts = capture_artifacts(driver, output_dir=cfg.debug_dir, label=f"error_debug_{action}")
            if artifacts.html_path:
                log(f"Saved debug HTML: {artifacts.html_path}")
            if artifacts.screenshot_path:
                log(f"Saved debug screenshot: {artifacts.screenshot_path}")
        return 1
    finally:
        try:
            driver.quit()
        except Exception:
            pass


def _run_recorder(headless: bool, output_dir: Path, persist_session: bool) -> int:
    started_at = datetime.now()
    # Recorder must be interactive.
    if headless:
        print("Recorder precisa abrir o navegador. Forçando headless = não.")

    from espacofacial.auth import configure_file_logging, log_exception
    from espacofacial.core import create_driver, load_config
    from espacofacial.recorder import run_recorder_session

    _set_runtime_env("", "", output_dir, False, unit_name="", persist_session=persist_session)
    cfg = load_config()
    configure_file_logging(cfg.output_dir, prefix="menu_recorder")

    driver = create_driver(headless=False, user_data_dir=cfg.chrome_user_data_dir)
    try:
        result = run_recorder_session(
            driver,
            start_url=cfg.base_url,
            output_dir=cfg.debug_dir,
            label="espacofacial",
        )
        _write_run_summary(
            mode="recorder",
            unit_name="",
            output_dir=output_dir,
            status="success",
            started_at=started_at,
            ended_at=datetime.now(),
            details={"events": result.event_count},
            outputs=[str(result.json_path), str(result.screenshot_path)] if result.screenshot_path else [str(result.json_path)],
        )
        return 0
    except Exception as e:
        log_exception("ERROR: Recorder failed", e)
        _write_run_summary(
            mode="recorder",
            unit_name="",
            output_dir=output_dir,
            status="failed",
            started_at=started_at,
            ended_at=datetime.now(),
            details={"error": str(e)},
        )
        return 1
    finally:
        try:
            driver.quit()
        except Exception:
            pass


def _run_procedures(headless: bool, output_dir: Path, persist_session: bool) -> int:
    started_at = datetime.now()
    email, password = _get_credentials(persist_session=persist_session)
    if (not email or not password) and not persist_session:
        print("Credenciais não informadas. Abortando.")
        _write_run_summary(
            mode="procedures",
            unit_name="",
            output_dir=output_dir,
            status="failed",
            started_at=started_at,
            ended_at=datetime.now(),
            details={"reason": "missing_credentials"},
        )
        return 2

    _set_runtime_env(email, password, output_dir, headless, unit_name="", persist_session=persist_session)

    from espacofacial.auth import Credentials, configure_file_logging, log, log_exception
    from espacofacial.core import load_config
    from espacofacial.procedures import run_with_runtime

    cfg = load_config()
    configure_file_logging(cfg.output_dir, prefix="menu_procedures")
    if cfg.persist_session and cfg.chrome_user_data_dir is not None:
        log(f"Chrome profile: {cfg.chrome_user_data_dir}")

    try:
        records, summary = run_with_runtime(
            base_url=cfg.base_url,
            creds=Credentials(cfg.email, cfg.password),
            output_dir=cfg.output_dir,
            debug_dir=cfg.debug_dir,
            headless=cfg.headless,
            user_data_dir=cfg.chrome_user_data_dir,
            timeout_seconds=cfg.timeout_seconds,
        )
        outputs = summary.get("outputs") if isinstance(summary, dict) else None
        output_list = []
        if isinstance(outputs, dict):
            output_list = [str(path) for path in outputs.values()]
        details = {
            "units": summary.get("units", {}),
            "totals": summary.get("totals", {}),
            "rows": len(records),
        }
        _write_run_summary(
            mode="procedures",
            unit_name="",
            output_dir=output_dir,
            status="success",
            started_at=started_at,
            ended_at=datetime.now(),
            details=details,
            outputs=output_list,
        )
        return 0
    except Exception as e:
        log_exception("ERROR: Procedures export failed", e)
        _write_run_summary(
            mode="procedures",
            unit_name="",
            output_dir=output_dir,
            status="failed",
            started_at=started_at,
            ended_at=datetime.now(),
            details={"error": str(e)},
        )
        return 1


def _run_client_registration(headless: bool, output_dir: Path, persist_session: bool) -> int:
    started_at = datetime.now()
    email, password = _get_credentials(persist_session=persist_session)
    if (not email or not password) and not persist_session:
        print("Credenciais não informadas. Abortando.")
        _write_run_summary(
            mode="client_registration",
            unit_name="",
            output_dir=output_dir,
            status="failed",
            started_at=started_at,
            ended_at=datetime.now(),
            details={"reason": "missing_credentials"},
        )
        return 2

    _set_runtime_env(email, password, output_dir, headless, unit_name="", persist_session=persist_session)
    from espacofacial.auth import Credentials, configure_file_logging, log, log_exception
    from espacofacial.client_registration import run_with_runtime
    from espacofacial.core import load_config

    cfg = load_config()
    configure_file_logging(cfg.output_dir, prefix="menu_client_registration")
    try:
        records, summary = run_with_runtime(
            base_url=cfg.base_url,
            creds=Credentials(cfg.email, cfg.password),
            output_dir=cfg.output_dir,
            debug_dir=cfg.debug_dir,
            headless=cfg.headless,
            user_data_dir=cfg.chrome_user_data_dir,
            timeout_seconds=cfg.timeout_seconds,
        )
        details = {"records": len(records), "totals": summary.get("totals", {})}
        _write_run_summary(
            mode="client_registration",
            unit_name="",
            output_dir=output_dir,
            status="success",
            started_at=started_at,
            ended_at=datetime.now(),
            details=details,
            outputs=list(summary.get("outputs", {}).values()),
        )
        log(f"Client registration export completed: {len(records)} records")
        return 0
    except Exception as exc:
        log_exception("ERROR: Client registration export failed", exc)
        _write_run_summary(
            mode="client_registration",
            unit_name="",
            output_dir=output_dir,
            status="failed",
            started_at=started_at,
            ended_at=datetime.now(),
            details={"error": str(exc)},
        )
        return 1


def _run_selftest(headless: bool, output_dir: Path) -> int:
    started_at = datetime.now()
    # Self-test does not log in, but it may open Chrome.
    from espacofacial.auth import configure_file_logging, log, log_exception

    _set_runtime_env("", "", output_dir, headless, unit_name="", persist_session=False)
    try:
        configure_file_logging(output_dir, prefix="menu_selftest")
        log("Starting self-test")
    except Exception:
        pass

    try:
        import selftest

        rc = selftest.main()
        _write_run_summary(
            mode="selftest",
            unit_name="",
            output_dir=output_dir,
            status="success" if rc == 0 else "failed",
            started_at=started_at,
            ended_at=datetime.now(),
        )
        return rc
    except Exception as e:
        try:
            log_exception("ERROR: Self-test failed", e)
        except Exception:
            print(f"ERROR: Self-test failed: {e}")
        _write_run_summary(
            mode="selftest",
            unit_name="",
            output_dir=output_dir,
            status="failed",
            started_at=started_at,
            ended_at=datetime.now(),
            details={"error": str(e)},
        )
        return 1



def main() -> int:
    _load_env()

    pre_mode = os.getenv("EF_MODE", "").strip().lower()
    if pre_mode in {"booking_api", "agenda_booking_api", "reserve_api"}:
        _load_booking_env_file()

    print("=== scraper (Runner) ===")

    # Exports go into report/ by default, but can be overridden via EF_OUTPUT_DIR.
    raw_output = os.getenv("EF_OUTPUT_DIR", "").strip()
    output_dir = Path(raw_output).expanduser() if raw_output else default_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        from espacofacial.diagnostics import cleanup_debug_dir

        retention_days = int(os.getenv("EF_DEBUG_RETENTION_DAYS", "7"))
        cleaned = cleanup_debug_dir(default_debug_dir(), retention_days=retention_days)
        if cleaned:
            print(f"[cleanup] Removidos {cleaned} arquivos antigos de debug.")
    except Exception:
        pass
    headless_env = _env_flag("HEADLESS")
    if headless_env is None:
        headless = _prompt_yes_no("Rodar sem abrir o navegador (headless)?", default=False)
    else:
        headless = headless_env

    # Always persist session locally for faster automation.
    persist_session = True

    # Keep a stable Chrome profile dir, but do not rely on it staying logged-in.
    os.environ.setdefault("EF_CHROME_USER_DATA_DIR", str(default_chrome_profile_dir()))
    _maybe_print_profile_path()

    mode = os.getenv("EF_MODE", "").strip().lower()
    if not mode:
        print("EF_MODE não definido. Configure uma ação no Codex.")
        print("Valores aceitos: agenda | agenda_index | agenda_delta | caixa | procedures | client_registration | recorder | selftest | booking_api | menu")
        return 2

    unit_name = os.getenv("EF_UNIT_NAME", "").strip()
    if mode in {
        "agenda",
        "agendamentos",
        "appointments",
        "agenda_index",
        "agenda_delta",
        "caixa",
        "cash",
    }:
        unit_name = _choose_unit_from_list()
        if not unit_name:
            print("Unidade não selecionada.")
            return 2

    if mode in {"agenda", "agendamentos", "appointments", "agenda_index", "agenda_delta"}:
        agenda_mode = "full"
        if mode == "agenda_index":
            agenda_mode = "index"
        elif mode == "agenda_delta":
            agenda_mode = "delta"
        rc = _run_agenda(
            headless=headless,
            output_dir=output_dir,
            unit_name=unit_name,
            persist_session=persist_session,
            agenda_mode=agenda_mode,
        )
        _maybe_print_log_path()
        return rc
    if mode in {"caixa", "cash"}:
        rc = _run_cash_combined(headless=headless, output_dir=output_dir, unit_name=unit_name, persist_session=persist_session)
        _maybe_print_log_path()
        return rc
    if mode in {"procedures", "clientes_procedures", "client_procedures"}:
        rc = _run_procedures(headless=headless, output_dir=output_dir, persist_session=persist_session)
        _maybe_print_log_path()
        return rc
    if mode in {"client_registration", "cadastro_clientes", "clientes_cadastro"}:
        rc = _run_client_registration(headless=headless, output_dir=output_dir, persist_session=persist_session)
        _maybe_print_log_path()
        return rc
    if mode in {"recorder", "record"}:
        rc = _run_recorder(headless=headless, output_dir=output_dir, persist_session=persist_session)
        _maybe_print_log_path()
        return rc
    if mode in {"selftest"}:
        rc = _run_selftest(headless=headless, output_dir=default_debug_dir())
        _maybe_print_log_path()
        return rc
    if mode in {"booking_api", "agenda_booking_api", "reserve_api"}:
        from espacofacial.booking_server import run_booking_server

        _load_booking_env_file()
        email, password = _get_credentials(persist_session=persist_session)
        _set_runtime_env(email, password, output_dir, headless, unit_name, persist_session)
        rc = run_booking_server()
        _maybe_print_log_path()
        return rc

    if mode in {"menu", "custom"}:
        headless_env = _env_flag("HEADLESS")
        if headless_env is None:
            headless = _prompt_yes_no("Rodar sem abrir o navegador (headless)?", default=False)
        else:
            headless = headless_env
        unit_name = _choose_unit_from_list()

        print("\nO que você quer fazer?")
        print("1) Extrair agendamentos (COMPLETO)")
        print("2) Extrair agendamentos (INDEX - Data/Horário)")
        print("3) Extrair agendamentos (DELTA - somente mudanças)")
        print("4) Extrair caixa (Resumo + Clientes - XLSX)")
        print("5) Exportar procedimentos realizados dos clientes (todas as unidades)")
        print("6) Exportar cadastro dos clientes (todas as unidades)")
        print("7) Recorder: abrir navegador e gravar cliques/preenchimentos")
        print("8) Booking API (listener HTTP para reservas)")
        print("9) Self-test (verifica ambiente/Chrome/export)")
        print("10) Sair")

        choice = input("> ").strip()
        if choice == "1":
            rc = _run_agenda(
                headless=headless,
                output_dir=output_dir,
                unit_name=unit_name,
                persist_session=persist_session,
                agenda_mode="full",
            )
            _maybe_print_log_path()
            return rc
        if choice == "2":
            rc = _run_agenda(
                headless=headless,
                output_dir=output_dir,
                unit_name=unit_name,
                persist_session=persist_session,
                agenda_mode="index",
            )
            _maybe_print_log_path()
            return rc
        if choice == "3":
            rc = _run_agenda(
                headless=headless,
                output_dir=output_dir,
                unit_name=unit_name,
                persist_session=persist_session,
                agenda_mode="delta",
            )
            _maybe_print_log_path()
            return rc
        if choice == "4":
            rc = _run_cash_combined(headless=headless, output_dir=output_dir, unit_name=unit_name, persist_session=persist_session)
            _maybe_print_log_path()
            return rc
        if choice == "5":
            rc = _run_procedures(headless=headless, output_dir=output_dir, persist_session=persist_session)
            _maybe_print_log_path()
            return rc
        if choice == "6":
            rc = _run_client_registration(headless=headless, output_dir=output_dir, persist_session=persist_session)
            _maybe_print_log_path()
            return rc
        if choice == "7":
            rc = _run_recorder(headless=headless, output_dir=output_dir, persist_session=persist_session)
            _maybe_print_log_path()
            return rc
        if choice == "8":
            from espacofacial.booking_server import run_booking_server

            _load_booking_env_file()
            email, password = _get_credentials(persist_session=persist_session)
            _set_runtime_env(email, password, output_dir, headless, unit_name, persist_session)
            rc = run_booking_server()
            _maybe_print_log_path()
            return rc
        if choice == "9":
            rc = _run_selftest(headless=headless, output_dir=default_debug_dir())
            _maybe_print_log_path()
            return rc
        if choice == "10":
            print("Saindo.")
            return 0
        print("Opção inválida.")
        return 2

    print(f"EF_MODE inválido: {mode}.")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
