from datetime import date
from pathlib import Path
import json
import tempfile
import unittest

from espacofacial.finance_caixa import CONTRACT_VERSION, build_finance_caixa_delivery, write_finance_caixa_delivery


class FinanceCaixaContractTests(unittest.TestCase):
    def test_builds_minor_units_and_stable_record_identity(self):
        rows = [{"Data": "03/07/2026", "Horário": "10:30", "Cliente": "Ana Silva", "Status": "Confirmado", "Valor": "R$ 1.200,00", "Crédito Cliente": "R$ 0,00", "Valor Pago": "R$ 600,00", "Parcelas": 2, "Pagamento": "Cartão de Crédito"}]
        first = build_finance_caixa_delivery(rows, unit_name="Novo Hamburgo", period_from=date(2026, 7, 1), period_to=date(2026, 7, 31), execution_id="run-1")
        second = build_finance_caixa_delivery(rows, unit_name="Novo Hamburgo", period_from=date(2026, 7, 1), period_to=date(2026, 7, 31), execution_id="run-2")
        self.assertEqual(first["contractVersion"], CONTRACT_VERSION)
        self.assertEqual(first["unit"]["slug"], "novo-hamburgo")
        self.assertEqual(first["records"][0]["paidAmountMinor"], 60000)
        self.assertEqual(first["records"][0]["externalId"], second["records"][0]["externalId"])

    def test_zero_cancelled_row_is_evidence_for_review(self):
        delivery = build_finance_caixa_delivery([{"Data": "03/07/2026", "Cliente": "Ana", "Status": "Cancelado", "Valor": "R$ 0,00", "Valor Pago": "R$ 0,00", "Pagamento": "PIX"}], unit_name="BarraShoppingSul", period_from=date(2026, 7, 3), period_to=date(2026, 7, 3), execution_id="run-1")
        self.assertTrue(delivery["records"][0]["status"].startswith("review:"))
        self.assertGreaterEqual(delivery["records"][0]["paidAmountMinor"], 0)

    def test_writes_json_delivery(self):
        with tempfile.TemporaryDirectory() as directory:
            path = write_finance_caixa_delivery([{"Data": "03/07/2026", "Cliente": "Ana", "Valor Pago": "10,00", "Pagamento": "PIX"}], output_path=Path(directory) / "delivery.json", unit_name="Novo Hamburgo", period_from=date(2026, 7, 3), period_to=date(2026, 7, 3), execution_id="run-1")
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["contractVersion"], CONTRACT_VERSION)
