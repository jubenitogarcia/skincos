from __future__ import annotations

import unittest

from espacofacial.booking import BookingRequest


class BookingRequestTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
