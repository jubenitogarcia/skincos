from __future__ import annotations

from typing import Iterable

import pandas as pd


_SUM_KEYWORDS = ("valor", "credito", "crédito")


def _is_empty_cell(val: object) -> bool:
    if val is None:
        return True
    if isinstance(val, float) and pd.isna(val):
        return True
    if isinstance(val, str) and val.strip() == "":
        return True
    return False


def trim_empty_rows_cols(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    mask = df.applymap(lambda v: not _is_empty_cell(v))
    keep_rows = mask.any(axis=1)
    keep_cols = mask.any(axis=0)
    return df.loc[keep_rows, keep_cols]


def sort_by_date_time(
    df: pd.DataFrame,
    *,
    date_col: str,
    time_col: str | None = "Horário",
    extra_sort: Iterable[str] | None = None,
) -> pd.DataFrame:
    if df.empty or date_col not in df.columns:
        return df

    date_series = df[date_col].astype(str).str.strip()
    if time_col and time_col in df.columns:
        time_series = df[time_col].astype(str).str.strip()
        dt_series = pd.to_datetime(
            date_series + " " + time_series,
            dayfirst=True,
            errors="coerce",
        )
    else:
        dt_series = pd.to_datetime(date_series, dayfirst=True, errors="coerce")

    out = df.copy()
    out["_sort_dt"] = dt_series
    sort_cols = ["_sort_dt"]
    if extra_sort:
        sort_cols.extend([c for c in extra_sort if c in out.columns])
    out = out.sort_values(by=sort_cols, ascending=True, kind="mergesort")
    out = out.drop(columns=["_sort_dt"])
    return out


def append_total_row(
    df: pd.DataFrame,
    *,
    label: str = "TOTAL",
    label_column: str | None = None,
    sum_columns: Iterable[str] | None = None,
) -> pd.DataFrame:
    if df.empty:
        return df

    out = df.copy()

    if label_column is None:
        label_column = out.columns[0]

    if label_column not in out.columns:
        label_column = out.columns[0]

    if sum_columns is None:
        sum_columns = [c for c in out.columns if any(k in c.lower() for k in _SUM_KEYWORDS)]

    row: dict[str, object] = {c: "" for c in out.columns}
    row[label_column] = label

    sum_source = out
    if label_column in out.columns:
        sum_source = out[out[label_column].astype(str).str.upper() != label.upper()]

    for c in sum_columns:
        if c not in out.columns:
            continue
        series = pd.to_numeric(sum_source[c], errors="coerce")
        if series.notna().any():
            total_val = float(series.sum())
            if series.dropna().apply(lambda v: float(v).is_integer()).all():
                total_val = int(total_val)
            row[c] = total_val

    total_df = pd.DataFrame([row], columns=out.columns)
    return pd.concat([out, total_df], ignore_index=True)


def _is_zeroish(val: object) -> bool:
    if val is None:
        return True
    if isinstance(val, (int, float)):
        return float(val) == 0.0
    if isinstance(val, str):
        raw = val.strip()
        if not raw:
            return True
        if raw == "–":
            return True
        cleaned = raw.replace("R$", "").replace(".", "").replace(",", ".").strip()
        try:
            return float(cleaned) == 0.0
        except Exception:
            return False
    return False


def replace_zero_with_dash(
    df: pd.DataFrame,
    *,
    columns: Iterable[str] | None = None,
    exclude_columns: Iterable[str] | None = None,
) -> pd.DataFrame:
    if df.empty:
        return df

    out = df.copy()
    if columns is None:
        columns = [
            c
            for c in out.columns
            if any(k in c.lower() for k in _SUM_KEYWORDS)
            or pd.api.types.is_numeric_dtype(out[c])
            or "parcelas" in c.lower()
        ]
    if exclude_columns:
        exclude_set = {c for c in exclude_columns}
        columns = [c for c in columns if c not in exclude_set]

    for c in columns:
        if c not in out.columns:
            continue
        out[c] = out[c].apply(lambda v: "–" if _is_zeroish(v) else v)
    return out
