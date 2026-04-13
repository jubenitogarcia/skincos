from __future__ import annotations

import unittest
from datetime import date
from unittest.mock import patch

from espacofacial.booking import BookingRequest
from espacofacial.appointments import (
    _collapse_repeated_phrase,
    _extract_event_info,
    _find_value_by_label_in_text,
    _is_invalid_field_value,
    parse_duration_minutes_from_time_text,
)
from scraper_final import _resolve_date_filter


class BookingRequestTests(unittest.TestCase):
    def test_extracts_duration_from_time_range(self) -> None:
        self.assertEqual(parse_duration_minutes_from_time_text("13:00 - 13:30"), 30)
        self.assertEqual(parse_duration_minutes_from_time_text("17:40 - 18:00"), 20)
        self.assertIsNone(parse_duration_minutes_from_time_text("18:00"))

    def test_extract_event_info_two_parts_maps_second_to_injector_when_not_type(self) -> None:
        row = _extract_event_info("Letícia Marques Kovalski - Viviane Mondin", "17:40 - 18:00")
        self.assertEqual(row["Cliente"], "Letícia Marques Kovalski")
        self.assertEqual(row["Tipo de Agendamento"], "")
        self.assertEqual(row["Profissional"], "Viviane Mondin")

    def test_extract_event_info_two_parts_maps_second_to_type_when_known_type(self) -> None:
        row = _extract_event_info("Bianca Vicente de Camargo - Avaliação", "10:00 - 10:30")
        self.assertEqual(row["Cliente"], "Bianca Vicente de Camargo")
        self.assertEqual(row["Tipo de Agendamento"], "Avaliação")
        self.assertEqual(row["Profissional"], "")

    def test_extract_event_info_three_parts_accepts_type_professional_swap(self) -> None:
        row = _extract_event_info("Bianca Vicente de Camargo - Marina Pereira Lima - Avaliação", "10:00 - 10:30")
        self.assertEqual(row["Cliente"], "Bianca Vicente de Camargo")
        self.assertEqual(row["Tipo de Agendamento"], "Avaliação")
        self.assertEqual(row["Profissional"], "Marina Pereira Lima")

    def test_collapse_repeated_phrase(self) -> None:
        self.assertEqual(_collapse_repeated_phrase("Agendado Agendado"), "Agendado")
        self.assertEqual(_collapse_repeated_phrase("Confirmado Confirmado"), "Confirmado")
        self.assertEqual(_collapse_repeated_phrase("Atendido"), "Atendido")

    def test_invalid_field_value_rejects_internal_id_and_labels(self) -> None:
        self.assertTrue(_is_invalid_field_value("1773348000000"))
        self.assertTrue(_is_invalid_field_value("Tipo de Agendamento", blocked_labels=["Tipo de Agendamento"]))
        self.assertTrue(_is_invalid_field_value("Injetor Marina Pereira Lima", blocked_labels=["Injetor"]))
        self.assertFalse(_is_invalid_field_value("Avaliação", blocked_labels=["Tipo de Agendamento"]))

    def test_find_value_by_label_in_text_supports_same_line_without_colon(self) -> None:
        text = "\n".join(
            [
                "Nome do cliente Bianca Vicente de Camargo",
                "Tipo do agendamento Avaliação",
                "Injetor Marina Pereira Lima",
            ]
        )
        self.assertEqual(
            _find_value_by_label_in_text(text, labels=["Tipo de Agendamento", "Tipo de agendamento", "Tipo do agendamento"]),
            "Avaliação",
        )

    def test_parses_portuguese_payload(self) -> None:
        request = BookingRequest.from_payload(
            {
                "unidade": "BarraShoppingSul",
                "cliente": "Maria Silva",
                "data": "2026-03-08",
                "horario": "13:00 - 13:30",
                "servico": "Revisão",
                "profissional": "Gabriela Menegat",
                "observacoes": "Confirmado pelo site",
            }
        )
        self.assertEqual(request.unit_name, "BarraShoppingSul")
        self.assertEqual(request.client_name, "Maria Silva")
        self.assertEqual(request.appointment_date, "08/03/2026")
        self.assertEqual(request.start_time, "13:00")
        self.assertEqual(request.end_time, "13:30")
        self.assertEqual(request.service_name, "Revisão")

    def test_requires_minimum_fields(self) -> None:
        with self.assertRaises(ValueError):
            BookingRequest.from_payload({"cliente": "Sem horario"})

    def test_builds_end_time_from_duration(self) -> None:
        request = BookingRequest.from_payload(
            {
                "unit": "Novo Hamburgo",
                "clientName": "Ana Pereira",
                "appointmentDate": "08/03/2026",
                "startTime": "09:15",
                "durationMinutes": 45,
                "serviceName": "Avaliação",
            }
        )
        self.assertEqual(request.end_time, "10:00")

    def test_parses_website_webhook_payload(self) -> None:
        request = BookingRequest.from_payload(
            {
                "event": "booking.created",
                "dryRun": True,
                "booking": {
                    "unitSlug": "barrashoppingsul",
                    "doctorName": "Gabriela Menegat",
                    "durationMinutes": 30,
                    "service": {"id": "avaliacao", "name": "Avaliação"},
                    "startAtMs": 1772971200000,
                    "endAtMs": 1772973000000,
                    "patientName": "Maria Silva",
                    "whatsapp": "51999999999",
                    "cpf": "12345678900",
                    "notes": "Lead vindo do site",
                },
            }
        )
        self.assertEqual(request.unit_name, "BarraShoppingSul")
        self.assertEqual(request.client_name, "Maria Silva")
        self.assertEqual(request.appointment_date, "08/03/2026")
        self.assertEqual(request.start_time, "09:00")
        self.assertEqual(request.end_time, "09:30")
        self.assertEqual(request.service_name, "Avaliação")
        self.assertEqual(request.professional_name, "Gabriela Menegat")
        self.assertTrue(request.dry_run)

    def test_merges_selected_services_into_candidates(self) -> None:
        request = BookingRequest.from_payload(
            {
                "event": "booking.created",
                "booking": {
                    "unitSlug": "novohamburgo",
                    "durationMinutes": 30,
                    "includes": {"procedimento": True},
                    "service": {"id": "procedimento", "name": "Procedimento"},
                    "selectedServices": [
                        {"id": "toxina", "name": "Toxina botulínica"},
                        {"id": "preenchimento", "name": "Preenchimento labial"},
                    ],
                    "startAtMs": 1773316800000,
                    "endAtMs": 1773318600000,
                    "patientName": "Maria Silva",
                },
            }
        )
        self.assertEqual(request.appointment_type, "Procedimento")
        self.assertEqual(request.service_name, "Procedimento")
        self.assertEqual(request.service_candidates, ("Toxina botulínica", "Preenchimento labial"))

    def test_parses_procedure_name(self) -> None:
        request = BookingRequest.from_payload(
            {
                "unitName": "BarraShoppingSul",
                "clientName": "Carla Souza",
                "appointmentDate": "08/03/2026",
                "startTime": "10:00",
                "endTime": "10:30",
                "procedureName": "Procedimento",
                "serviceName": "Toxina botulínica",
            }
        )
        self.assertEqual(request.procedure_name, "Procedimento")
        self.assertEqual(request.service_name, "Toxina botulínica")

    def test_week_window_uses_current_week_plus_next_three(self) -> None:
        rows = [
            {"Data": "09/03/2026"},
            {"Data": "10/03/2026"},
            {"Data": "15/03/2026"},
            {"Data": "05/04/2026"},
            {"Data": "06/04/2026"},
        ]
        with patch.dict("os.environ", {"EF_INDEX_WEEK_WINDOW_WEEKS": "4"}, clear=False):
            fn, label = _resolve_date_filter(date(2026, 3, 11))
        self.assertIsNotNone(fn)
        self.assertEqual(label, "current week + next 3 weeks")
        filtered = fn(rows) if fn else []
        self.assertEqual([row["Data"] for row in filtered], ["09/03/2026", "10/03/2026", "15/03/2026", "05/04/2026"])


if __name__ == "__main__":
    unittest.main()
