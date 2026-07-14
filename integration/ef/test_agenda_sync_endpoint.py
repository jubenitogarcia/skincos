from __future__ import annotations

import unittest

from agenda_sync_endpoint import AgendaSyncEndpointError, normalize_agenda_sync_endpoint


class AgendaSyncEndpointTests(unittest.TestCase):
    def test_accepts_the_canonical_production_endpoint(self) -> None:
        self.assertEqual(
            normalize_agenda_sync_endpoint("https://espacofacial.com/api/agenda/sync"),
            "https://espacofacial.com/api/agenda/sync",
        )

    def test_accepts_explicitly_allowed_staging_host(self) -> None:
        self.assertEqual(
            normalize_agenda_sync_endpoint(
                "https://agenda-staging.skincos.com.br/api/agenda/sync",
                allowed_hosts="agenda-staging.skincos.com.br",
            ),
            "https://agenda-staging.skincos.com.br/api/agenda/sync",
        )

    def test_rejects_untrusted_endpoint_variants(self) -> None:
        for endpoint in (
            "http://espacofacial.com/api/agenda/sync",
            "https://127.0.0.1/api/agenda/sync",
            "https://[::1]/api/agenda/sync",
            "https://attacker.example/api/agenda/sync",
            "https://user:pass@espacofacial.com/api/agenda/sync",
            "https://espacofacial.com/api/agenda/sync?next=https://attacker.example",
            "https://espacofacial.com/api/agenda/sync#fragment",
            "https://espacofacial.com/api/agenda",
            "https://espacofacial.com:8443/api/agenda/sync",
        ):
            with self.subTest(endpoint=endpoint):
                with self.assertRaises(AgendaSyncEndpointError):
                    normalize_agenda_sync_endpoint(endpoint)

    def test_rejects_invalid_allowed_host_configuration(self) -> None:
        with self.assertRaises(AgendaSyncEndpointError):
            normalize_agenda_sync_endpoint(
                "https://agenda-staging.skincos.com.br/api/agenda/sync",
                allowed_hosts="https://agenda-staging.skincos.com.br",
            )


if __name__ == "__main__":
    unittest.main()
