from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from espacofacial.client_registration import (
    ClientRegistrationRecord,
    _format_address,
    _load_checkpoint,
    _max_clients_per_unit,
    _max_pages,
    write_outputs,
)


class ClientRegistrationExportTests(unittest.TestCase):
    def test_limits_accept_positive_integers_only(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "EF_CLIENT_REGISTRATION_MAX_PAGES": "2",
                "EF_CLIENT_REGISTRATION_MAX_CLIENTS_PER_UNIT": "0",
            },
            clear=False,
        ):
            self.assertEqual(_max_pages(), 2)
            self.assertIsNone(_max_clients_per_unit())

    def test_address_keeps_only_available_parts(self) -> None:
        self.assertEqual(
            _format_address(
                {
                    "logradouro": "Avenida Vicente Monteggia",
                    "numero": "2000",
                    "cidade": "Porto Alegre",
                    "estado": "RS",
                    "cep": "91740-290",
                }
            ),
            "Avenida Vicente Monteggia 2000, Porto Alegre, RS, 91740-290",
        )

    def test_writes_auditable_csv_xlsx_and_summary(self) -> None:
        record = ClientRegistrationRecord(
            unidade="BarraShoppingSul",
            cliente="Cliente de teste",
            cliente_id="client-123",
            pagina_lista=1,
            telefone="(51) 9 9999-9999",
            telefones="(51) 9 9999-9999",
            email="teste@example.com",
            emails="teste@example.com",
            data_nascimento="1996-11-10",
            sexo="Feminino",
            cpf="",
            profissao="Estagiário",
            origem="influencer",
            cep="91740-290",
            logradouro="Avenida Vicente Monteggia",
            numero="2000",
            complemento="",
            bairro="Cavalhada",
            cidade="Porto Alegre",
            estado="RS",
            endereco_completo="Avenida Vicente Monteggia 2000, Cavalhada, Porto Alegre, RS, 91740-290",
            url_cliente="https://app.espacofacial.com.br/client-single-new/client-123/",
            extraido_em="2026-07-21T17:00:00",
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            outputs = write_outputs(Path(temp_dir), [record], {"totals": {"records_exported": 1}})
            frame = pd.read_csv(outputs["csv"], dtype=str, keep_default_na=False)
            self.assertEqual(frame.to_dict("records")[0]["Cliente ID"], "client-123")
            self.assertTrue(Path(outputs["xlsx"]).exists())
            summary = json.loads(Path(outputs["summary"]).read_text(encoding="utf-8"))
            self.assertEqual(summary["totals"]["records_exported"], 1)
            resumed = _load_checkpoint(Path(temp_dir))
            self.assertEqual(len(resumed), 1)
            self.assertEqual(next(iter(resumed.values())).cliente_id, "client-123")


if __name__ == "__main__":
    unittest.main()
