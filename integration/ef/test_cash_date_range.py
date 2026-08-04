from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from run_scraper import _prompt_date_range


class CashDateRangeTests(unittest.TestCase):
    def test_explicit_cash_dates_override_automatic_previous_month(self) -> None:
        with patch.dict(
            os.environ,
            {
                "EF_CASH_START_DATE": "01/06/2026",
                "EF_CASH_END_DATE": "30/06/2026",
                "EF_DATE_RANGE_MODE": "prev_month",
            },
            clear=False,
        ):
            self.assertEqual(_prompt_date_range(), ("01/06/2026", "30/06/2026"))

    def test_rejects_incomplete_explicit_cash_range(self) -> None:
        with patch.dict(os.environ, {"EF_CASH_START_DATE": "01/06/2026"}, clear=True):
            with self.assertRaisesRegex(ValueError, "devem ser definidos juntos"):
                _prompt_date_range()


if __name__ == "__main__":
    unittest.main()
