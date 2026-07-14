from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Iterable, cast

import gspread
from google.auth.transport.requests import Request
from google.oauth2.service_account import Credentials as ServiceAccountCredentials
from google.oauth2.credentials import Credentials as UserCredentials
from google_auth_oauthlib.flow import InstalledAppFlow  # type: ignore[import-untyped]
from gspread.utils import ValueInputOption
from gspread.utils import rowcol_to_a1

from .auth import log


_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def _default_token_path() -> Path:
    # Keep it outside the repo by default.
    return Path.home() / ".config" / "espacofacial" / "google_token.json"


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _get_gspread_client() -> gspread.Client:
    """Return an authenticated gspread client.

    Auth options:
    1) Service account JSON: set `EF_SHEETS_CREDENTIALS` to the service-account file.
       - Make sure the spreadsheet is shared with the service account email.

    2) OAuth client secrets JSON (installed app): set `EF_SHEETS_CREDENTIALS` to the OAuth client file.
       - First run will open a browser to authorize and will cache a token.
    """

    cred_path_raw = os.getenv("EF_SHEETS_CREDENTIALS", "").strip()

    project_root = Path(__file__).resolve().parents[1]
    candidates: list[Path] = []
    if cred_path_raw:
        candidates.append(Path(cred_path_raw))
    # Local-only default (git-ignored)
    candidates.append(project_root / "secrets" / "ef_service_account.json")
    # Common user-level location
    candidates.append(Path.home() / ".config" / "espacofacial" / "ef_service_account.json")

    cred_path: Path | None = None
    for p in candidates:
        pp = p.expanduser().resolve()
        if pp.exists():
            cred_path = pp
            break

    if cred_path is None:
        raise RuntimeError(
            "Missing EF_SHEETS_CREDENTIALS and no default creds file found. "
            "Set EF_SHEETS_CREDENTIALS or place the JSON at ./secrets/ef_service_account.json"
        )
    payload = _load_json(cred_path)

    # Service account
    if payload.get("type") == "service_account":
        creds = ServiceAccountCredentials.from_service_account_info(payload, scopes=_SCOPES)  # type: ignore
        return gspread.authorize(creds)

    # OAuth installed app
    token_path = Path(os.getenv("EF_SHEETS_TOKEN_PATH", str(_default_token_path()))).expanduser().resolve()
    token_path.parent.mkdir(parents=True, exist_ok=True)

    creds: Any = None
    if token_path.exists():
        try:
            creds = UserCredentials.from_authorized_user_file(str(token_path), scopes=_SCOPES)  # type: ignore
        except Exception:
            creds = None

    if creds is not None and getattr(creds, "valid", False):
        return gspread.authorize(creds)

    if creds is not None and getattr(creds, "expired", False) and getattr(creds, "refresh_token", None):
        creds.refresh(Request())
        token_path.write_text(creds.to_json(), encoding="utf-8")
        return gspread.authorize(creds)

    # Full interactive flow
    flow = InstalledAppFlow.from_client_config(payload, scopes=_SCOPES)  # type: ignore
    creds = flow.run_local_server(port=0)  # type: ignore
    token_path.write_text(creds.to_json(), encoding="utf-8")
    return gspread.authorize(creds)


def open_worksheet(*, spreadsheet_id: str, worksheet_name: str) -> gspread.Worksheet:
    client = _get_gspread_client()
    sh = client.open_by_key(spreadsheet_id)
    return sh.worksheet(worksheet_name)


def _find_row_by_date(values: list[list[str]], date_str: str, *, header_rows: int = 1) -> int | None:
    """Return 1-based sheet row index for the given date in column A, or None."""

    # values includes header rows at the top.
    start = max(0, header_rows)
    for idx, row in enumerate(values[start:], start=start + 1):
        if not row:
            continue
        if (row[0] or "").strip() == date_str:
            return idx
    return None


def _norm_header(s: str) -> str:
    s = (s or "").strip().upper()
    s = (
        s.replace("Á", "A")
        .replace("À", "A")
        .replace("Ã", "A")
        .replace("Â", "A")
        .replace("É", "E")
        .replace("Ê", "E")
        .replace("Í", "I")
        .replace("Ó", "O")
        .replace("Ô", "O")
        .replace("Õ", "O")
        .replace("Ú", "U")
        .replace("Ç", "C")
    )
    s = " ".join(s.split())
    return s


def _detect_unit_block(*, ws: gspread.Worksheet, unit_name: str) -> tuple[int, int, int]:
    """Detect the column block for the given unit.

    Returns (header_rows, start_col, end_col) where start/end are 1-based inclusive.

    Supported layouts:
    - Legacy single-unit: header row in row 1: DATA + 6 category columns
    - Multi-unit: row 1 contains unit names (merged across blocks), row 2 contains category headers.
    """

    # Read a small top-left window.
    # We expect the furthest unit block to be within A..Z.
    top = cast(list[list[str]], ws.get("A1:Z2"))
    row1 = top[0] if len(top) >= 1 else []
    row2 = top[1] if len(top) >= 2 else []

    expected_categories = ["CREDITO", "DEBITO", "DINHEIRO", "ECOMMERCE", "TRANSFERENCIA", "TOTAL"]
    unit_norm = _norm_header(unit_name)

    # Legacy header: row1 starts with DATA then categories.
    if row1 and _norm_header(row1[0]) == "DATA":
        cats = [_norm_header(c) for c in row1[1:1 + len(expected_categories)]]
        if cats == expected_categories:
            return (1, 2, 7)  # B..G

    # Multi-unit header: row2 contains the categories sequences.
    r2 = [_norm_header(c) for c in row2]
    candidates: list[int] = []
    for i in range(0, max(0, len(r2) - len(expected_categories) + 1)):
        if r2[i : i + len(expected_categories)] == expected_categories:
            candidates.append(i + 1)  # 1-based start col

    if not candidates:
        # Fallback to legacy positions if sheet doesn't have headers.
        return (1, 2, 7)

    if unit_norm:
        r1 = [_norm_header(c) for c in row1]
        for start_col in candidates:
            end_col = start_col + len(expected_categories) - 1
            # In merged-cell headers, the unit name typically appears in the first cell of the merged region.
            for j in range(start_col, min(end_col, len(r1)) + 1):
                if unit_norm and unit_norm in (r1[j - 1] or ""):
                    return (2, start_col, end_col)

    # If unit not provided or not found, pick the first block.
    start_col = candidates[0]
    return (2, start_col, start_col + len(expected_categories) - 1)


def upsert_cash_rows(
    *,
    spreadsheet_id: str,
    worksheet_name: str,
    rows: Iterable[dict[str, object]],
    unit_name: str = "",
) -> None:
    """Upsert rows into the sheet by matching DATE in column A.

    Expected keys per row:
    - DATE, CREDIT, DEBIT, CASH, ECOMMERCE, TRANSFER, TOTAL
    """

    ws = open_worksheet(spreadsheet_id=spreadsheet_id, worksheet_name=worksheet_name)

    # Detect layout and unit block.
    header_rows, start_col, end_col = _detect_unit_block(ws=ws, unit_name=unit_name)

    # Ensure header exists (legacy only). For multi-unit we assume the sheet is pre-formatted.
    header = ["DATA", "CRÉDITO", "DÉBITO", "DINHEIRO", "ECOMMERCE", "TRANSFERÊNCIA", "TOTAL"]
    existing = cast(list[list[str]], ws.get_all_values())

    def _as_float(v: object) -> float:
        if v is None:
            return 0.0
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            try:
                return float(v.strip())
            except Exception:
                return 0.0
        return 0.0
    if not existing:
        ws.append_row(header, value_input_option=ValueInputOption.user_entered)
        existing = cast(list[list[str]], ws.get_all_values())
        header_rows = 1
        start_col, end_col = 2, 7
    elif header_rows == 1 and [str(c).strip() for c in existing[0]] != header:
        # Don’t overwrite user headers; just log.
        log("⚠ Google Sheet header differs from expected; writing anyway")

    existing = cast(list[list[str]], ws.get_all_values())

    for r in rows:
        date_str = str(r.get("DATE") or "").strip()
        if not date_str:
            continue

        row_values: list[str | int | float] = [
            date_str,
            _as_float(r.get("CREDIT")),
            _as_float(r.get("DEBIT")),
            _as_float(r.get("CASH")),
            _as_float(r.get("ECOMMERCE")),
            _as_float(r.get("TRANSFER")),
            _as_float(r.get("TOTAL")),
        ]

        row_idx = _find_row_by_date(existing, date_str, header_rows=header_rows)
        if row_idx is None:
            # Append a row wide enough so values land in the correct columns.
            width = max(end_col, 7)
            padded: list[str | int | float] = [""] * width
            padded[0] = date_str
            # Place values inside unit block.
            block = row_values[1:]
            for off, v in enumerate(block):
                padded[(start_col - 1) + off] = v
            ws.append_row(padded, value_input_option=ValueInputOption.user_entered)
            log(f"✓ Sheets: appended {date_str}")
            # Keep local cache consistent for subsequent upserts.
            existing.append([str(v) for v in padded])
        else:
            # Update ONLY the unit block to avoid overwriting other unidade columns.
            block_values = row_values[1:]
            start_a1 = rowcol_to_a1(row_idx, start_col)
            end_a1 = rowcol_to_a1(row_idx, end_col)
            ws.update([block_values], range_name=f"{start_a1}:{end_a1}", value_input_option=ValueInputOption.user_entered)
            log(f"✓ Sheets: updated {date_str}")
