from __future__ import annotations

import unittest
from unittest.mock import patch

from scraper_final import _fetch_agenda_api_rows, _post_agenda_sync_payload


class _Response:
    def __init__(self, *, status: int = 200, body: bytes = b'{"appointments": [], "has_more": false}') -> None:
        self.status = status
        self._body = body

    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self) -> bytes:
        return self._body


class AgendaSyncTransportTests(unittest.TestCase):
    def test_post_rejects_untrusted_endpoint_before_network_io(self) -> None:
        with patch("scraper_final.urllib.request.urlopen") as urlopen:
            self.assertFalse(
                _post_agenda_sync_payload(
                    payload={"unit": "barrashoppingsul", "added": [], "removed": []},
                    endpoint="https://127.0.0.1/api/agenda/sync",
                    token="secret-not-used",
                )
            )
        urlopen.assert_not_called()

    def test_post_uses_reconstructed_canonical_endpoint(self) -> None:
        with patch("scraper_final.urllib.request.urlopen", return_value=_Response()) as urlopen:
            self.assertTrue(
                _post_agenda_sync_payload(
                    payload={"unit": "barrashoppingsul", "added": [], "removed": []},
                    endpoint="https://ESPACOFACIAL.COM:443/api/agenda/sync",
                    token="secret-not-used",
                )
            )
        self.assertEqual(urlopen.call_args.args[0].full_url, "https://espacofacial.com/api/agenda/sync")

    def test_audit_rejects_untrusted_endpoint_before_network_io(self) -> None:
        with patch("scraper_final.urllib.request.urlopen") as urlopen:
            self.assertEqual(
                _fetch_agenda_api_rows(
                    unit_slug="barrashoppingsul",
                    date_from="2026-07-01",
                    date_to="2026-07-02",
                    endpoint="https://attacker.example/api/agenda/sync",
                    token="secret-not-used",
                ),
                [],
            )
        urlopen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
