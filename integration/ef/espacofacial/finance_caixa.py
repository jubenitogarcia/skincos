"""Versioned, file-only delivery from the Espaço Facial Caixa collector.

The collector owns browser extraction and emits this neutral envelope. It does
not know Finance scopes, credentials, D1, or ledger rules. Finance consumes the
file later through its authenticated staging endpoint.
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Iterable
from uuid import uuid4

CONTRACT_VERSION = "ef-caixa/v1"


def _minor(value: object) -> int:
    raw = str(value if value is not None else "0").strip().replace("R$", "").replace(" ", "")
    if not raw or raw in {"-", "–"}:
        return 0
    if "," in raw and "." in raw:
        raw = raw.replace(".", "").replace(",", ".")
    elif "," in raw:
        raw = raw.replace(",", ".")
    try:
        amount = Decimal(raw).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except InvalidOperation as exc:
        raise ValueError(f"Valor Caixa EF inválido: {value!r}") from exc
    if amount < 0:
        raise ValueError("O coletor Caixa EF não exporta pagamentos negativos; estornos exigem revisão.")
    return int(amount * 100)


def _iso_date(value: object) -> str:
    raw = str(value or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return raw
    parts = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", raw)
    if not parts:
        raise ValueError(f"Data Caixa EF inválida: {value!r}")
    return f"{parts.group(3)}-{parts.group(2).zfill(2)}-{parts.group(1).zfill(2)}"


def _slug(value: str) -> str:
    normalized = "".join(ch for ch in unicodedata.normalize("NFD", value or "") if unicodedata.category(ch) != "Mn")
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", normalized.lower()))


def _external_id(record: dict[str, Any]) -> str:
    stable = "|".join(str(record.get(key) or "") for key in ("occurredOn", "occurredAt", "clientName", "paidAmountMinor", "paymentMethod", "status", "currency"))
    return "ef-caixa:" + hashlib.sha256(stable.encode("utf-8")).hexdigest()[:32]


def build_finance_caixa_delivery(rows: Iterable[dict[str, Any]], *, unit_name: str, period_from: date, period_to: date, execution_id: str | None = None, artifact_id: str | None = None, artifact_sha256: str | None = None) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    for row in rows:
        paid = _minor(row.get("Valor Pago"))
        status = str(row.get("Status") or "confirmed").strip() or "confirmed"
        # Zero-value canceled/credit rows are still emitted as evidence, but
        # Finance cannot stage a zero monetary movement and will show them as review.
        if paid <= 0:
            paid = _minor(row.get("Valor")) or _minor(row.get("Crédito Cliente"))
            status = f"review:{status or 'zero_payment'}"
        record: dict[str, Any] = {
            "occurredOn": _iso_date(row.get("Data")),
            "occurredAt": str(row.get("Horário") or "").strip() or None,
            "clientName": str(row.get("Cliente") or "Cliente não identificado").strip(),
            "status": status,
            "grossAmountMinor": _minor(row.get("Valor")) or None,
            "clientCreditMinor": _minor(row.get("Crédito Cliente")),
            "paidAmountMinor": paid,
            "installmentCount": max(1, int(row.get("Parcelas") or 1)),
            "paymentMethod": str(row.get("Pagamento") or "Não informado").strip() or "Não informado",
            "paymentMethodRaw": str(row.get("Pagamento Raw") or row.get("Pagamento") or "").strip() or None,
            "currency": "BRL",
        }
        record["externalId"] = _external_id(record)
        records.append(record)
    if not records:
        raise ValueError("A entrega Caixa EF requer ao menos um recebimento por cliente.")
    return {
        "contractVersion": CONTRACT_VERSION,
        "source": {"system": "integration/ef", "executionId": execution_id or str(uuid4()), "artifactId": artifact_id, "artifactSha256": artifact_sha256},
        "unit": {"slug": _slug(unit_name), "name": unit_name},
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "records": records,
    }


def write_finance_caixa_delivery(rows: Iterable[dict[str, Any]], *, output_path: Path, unit_name: str, period_from: date, period_to: date, execution_id: str | None = None, artifact_id: str | None = None, artifact_sha256: str | None = None) -> Path:
    delivery = build_finance_caixa_delivery(rows, unit_name=unit_name, period_from=period_from, period_to=period_to, execution_id=execution_id, artifact_id=artifact_id, artifact_sha256=artifact_sha256)
    output_path.write_text(json.dumps(delivery, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path
