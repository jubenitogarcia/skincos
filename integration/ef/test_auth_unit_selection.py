from __future__ import annotations

import unittest

from espacofacial.auth import _select_unit_if_needed


class _DriverWithoutUnitSelector:
    def find_elements(self, *_args, **_kwargs):
        return []


class UnitSelectionTests(unittest.TestCase):
    def test_missing_unit_selector_fails_closed(self) -> None:
        self.assertFalse(
            _select_unit_if_needed(
                _DriverWithoutUnitSelector(),
                "Novo Hamburgo",
                timeout_seconds=0,
            )
        )


if __name__ == "__main__":
    unittest.main()
