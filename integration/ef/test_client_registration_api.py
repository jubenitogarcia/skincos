from __future__ import annotations

import unittest

from espacofacial.client_registration_api import _contains_unit_id


class ClientRegistrationApiTests(unittest.TestCase):
    def test_finds_nested_unit_reference(self) -> None:
        value = [{"_units": {"id": "unit-1"}}]
        self.assertTrue(_contains_unit_id(value, "unit-1"))
        self.assertFalse(_contains_unit_id(value, "unit-2"))


if __name__ == "__main__":
    unittest.main()
