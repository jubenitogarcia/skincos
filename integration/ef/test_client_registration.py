from __future__ import annotations

import json
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from espacofacial.client_registration import (
    ClientRegistrationRecord,
    SessionRecycleRequested,
    _format_address,
    _load_checkpoint,
    _max_clients_per_unit,
    _max_pages,
    _completed_unit_can_be_skipped,
    _mark_source_coverage_termination,
    _prepare_summary,
    _prepare_source_coverage_unit,
    _prepare_unit_summary,
    _refresh_source_coverage,
    run_with_runtime,
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
            summary_input = _prepare_summary(
                {},
                None,
                unit_names=["BarraShoppingSul"],
                page_limit=None,
                client_limit=None,
            )
            summary_input["totals"]["records_exported"] = 1
            outputs = write_outputs(Path(temp_dir), [record], summary_input)
            frame = pd.read_csv(outputs["csv"], dtype=str, keep_default_na=False)
            self.assertEqual(frame.to_dict("records")[0]["Cliente ID"], "client-123")
            self.assertTrue(Path(outputs["xlsx"]).exists())
            summary = json.loads(Path(outputs["summary"]).read_text(encoding="utf-8"))
            self.assertEqual(summary["totals"]["records_exported"], 1)
            self.assertEqual(summary["sourceCoverage"]["sourceArtifact"]["version"], 1)
            self.assertEqual(summary["sourceCoverage"]["sourceArtifact"]["csvRowCount"], 1)
            self.assertEqual(
                summary["sourceCoverage"]["sourceArtifact"]["csvSha256"],
                f"sha256:{sha256(Path(outputs['csv']).read_bytes()).hexdigest()}",
            )
            resumed = _load_checkpoint(Path(temp_dir))
            self.assertEqual(len(resumed), 1)
            self.assertEqual(next(iter(resumed.values())).cliente_id, "client-123")

    def test_summary_counters_survive_a_controlled_session_recycle(self) -> None:
        summary = _prepare_summary(
            {},
            None,
            unit_names=["BarraShoppingSul"],
            page_limit=None,
            client_limit=None,
        )
        unit = _prepare_unit_summary(summary, unit_name="BarraShoppingSul", resumed_records=0)
        summary["totals"].update({
            "units_processed": 1,
            "pages_processed": 3,
            "clients_attempted": 40,
            "clients_processed": 39,
            "records_exported": 39,
            "client_errors": 1,
        })
        unit.update({
            "completed": True,
            "pages_processed": 3,
            "clients_attempted": 40,
            "clients_processed": 39,
            "records_exported": 39,
            "client_errors": 1,
        })

        resumed = _prepare_summary({}, summary)
        resumed_unit = _prepare_unit_summary(resumed, unit_name="BarraShoppingSul", resumed_records=39)

        self.assertIs(resumed, summary)
        self.assertEqual(resumed["totals"]["records_exported"], 39)
        self.assertEqual(resumed["totals"]["client_errors"], 1)
        self.assertEqual(resumed["totals"]["units_processed"], 1)
        self.assertEqual(resumed_unit["resumed_records"], 0)
        self.assertTrue(resumed_unit["completed"])

    def test_source_coverage_marks_only_visible_fresh_unbounded_traversal(self) -> None:
        summary = _prepare_summary(
            {},
            None,
            unit_names=["BarraShoppingSul", "Novo Hamburgo"],
            page_limit=None,
            client_limit=None,
        )
        summary["sourceCoverage"]["launchMode"] = "fresh"
        for unit_name in summary["sourceCoverage"]["unitsRequested"]:
            unit_coverage = _prepare_source_coverage_unit(summary, unit_name=unit_name, resumed_records=0)
            unit_coverage.update({"pagesProcessed": 2, "lastPageProcessed": 2, "maxPageObserved": 2})
            _mark_source_coverage_termination(unit_coverage, "pagination_exhausted")
        summary["sourceCoverage"]["executionState"] = "completed"
        summary["sourceCoverage"]["finalized"] = True
        _refresh_source_coverage(summary)

        coverage = summary["sourceCoverage"]
        self.assertTrue(coverage["freshUnboundedNoErrorVisibleTraversal"])
        self.assertEqual(coverage["traversalOutcome"], "visible_pagination_exhausted")
        self.assertFalse(coverage["snapshotComplete"])
        self.assertFalse(coverage["absenceIsRetirementEvidence"])
        self.assertEqual(coverage["allHistoricalSemantics"], "not_proven")

    def test_source_coverage_distinguishes_resumed_limited_checkpoint(self) -> None:
        checkpoint = {("BarraShoppingSul", "client-123"): object()}
        summary = _prepare_summary(
            checkpoint,
            None,
            unit_names=["BarraShoppingSul"],
            page_limit=1,
            client_limit=None,
        )
        unit_coverage = _prepare_source_coverage_unit(summary, unit_name="BarraShoppingSul", resumed_records=1)
        _mark_source_coverage_termination(unit_coverage, "page_limit")
        summary["sourceCoverage"]["executionState"] = "completed"
        summary["sourceCoverage"]["finalized"] = True
        _refresh_source_coverage(summary)

        coverage = summary["sourceCoverage"]
        self.assertTrue(coverage["checkpoint"]["resumed"])
        self.assertEqual(coverage["checkpoint"]["initialRecords"], 1)
        self.assertFalse(coverage["sourceTraversalUnbounded"])
        self.assertEqual(coverage["traversalOutcome"], "limited")
        self.assertFalse(coverage["freshUnboundedNoErrorVisibleTraversal"])
        self.assertFalse(coverage["snapshotComplete"])

    def test_completed_clean_visible_unit_is_not_replayed_after_a_session_recycle(self) -> None:
        summary = _prepare_summary(
            {},
            None,
            unit_names=["BarraShoppingSul"],
            page_limit=None,
            client_limit=None,
        )
        outcome = _prepare_source_coverage_unit(summary, unit_name="BarraShoppingSul", resumed_records=0)
        _mark_source_coverage_termination(outcome, "pagination_exhausted")

        self.assertTrue(_completed_unit_can_be_skipped(summary, "BarraShoppingSul"))

        outcome["clientErrors"] = 1
        self.assertFalse(_completed_unit_can_be_skipped(summary, "BarraShoppingSul"))
        outcome["clientErrors"] = 0
        _mark_source_coverage_termination(outcome, "page_limit")
        self.assertFalse(_completed_unit_can_be_skipped(summary, "BarraShoppingSul"))
        _mark_source_coverage_termination(outcome, "client_limit")
        self.assertFalse(_completed_unit_can_be_skipped(summary, "BarraShoppingSul"))
        outcome["termination"] = "in_progress"
        outcome["traversalFinalized"] = False
        self.assertFalse(_completed_unit_can_be_skipped(summary, "BarraShoppingSul"))
        _mark_source_coverage_termination(outcome, "pagination_exhausted")
        summary["sourceCoverage"]["executionState"] = "completed"
        summary["sourceCoverage"]["finalized"] = True
        self.assertFalse(_completed_unit_can_be_skipped(summary, "BarraShoppingSul"))

    def test_runtime_passes_cumulative_summary_after_controlled_recycle(self) -> None:
        class Driver:
            def __init__(self) -> None:
                self.quit_calls = 0

            def quit(self) -> None:
                self.quit_calls += 1

        first_driver = Driver()
        second_driver = Driver()
        cumulative = _prepare_summary({}, None)
        recycle = SessionRecycleRequested("checkpointed", summary=cumulative)
        with patch("espacofacial.core.create_driver", side_effect=[first_driver, second_driver]), \
             patch("espacofacial.client_registration.run_client_registration_export", side_effect=[recycle, ([], cumulative)]) as exporter, \
             patch("espacofacial.client_registration.time.sleep"):
            records, summary = run_with_runtime(
                base_url="https://example.invalid",
                creds=object(),
                output_dir=Path("/tmp/output"),
                debug_dir=Path("/tmp/debug"),
                headless=True,
                user_data_dir=None,
                timeout_seconds=1,
            )

        self.assertEqual(records, [])
        self.assertIs(summary, cumulative)
        self.assertEqual(exporter.call_args_list[0].kwargs["cumulative_summary"], {})
        self.assertIs(exporter.call_args_list[1].kwargs["cumulative_summary"], cumulative)
        self.assertEqual(first_driver.quit_calls, 1)
        self.assertEqual(second_driver.quit_calls, 1)


if __name__ == "__main__":
    unittest.main()
