from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "validate-codex-app-proof.py"
SPEC = importlib.util.spec_from_file_location("validate_codex_app_proof", SCRIPT)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def valid_evidence() -> dict[str, object]:
    return {
        "turns_observed": {
            "turn_started": 2,
            "turn_completed": 2,
            "automatic_second_turn": True,
            "manual_second_prompt": False,
        },
        "hook_observation": {
            "new_block_and_continue_event": True,
            "app_thread_hook_items": 1,
        },
        "contract": {"first_status": "continue"},
        "supervisor_cycle": {"executed": True},
        "terminal_contract": {"status": "complete"},
        "artifact": {"removed": True},
    }


class ValidateCodexAppProofTest(unittest.TestCase):
    def test_accepts_two_turn_hook_proof(self) -> None:
        self.assertEqual(module.validate_proof(valid_evidence()), [])

    def test_rejects_single_turn_even_with_continue_contract(self) -> None:
        evidence = valid_evidence()
        evidence["turns_observed"] = {
            "turn_started": 1,
            "turn_completed": 1,
            "automatic_second_turn": False,
            "manual_second_prompt": False,
        }
        errors = module.validate_proof(evidence)
        self.assertIn("exactly two turn.started events are required", errors)
        self.assertIn("automatic_second_turn must be true", errors)

    def test_rejects_missing_hook_event(self) -> None:
        evidence = valid_evidence()
        evidence["hook_observation"] = {
            "new_block_and_continue_event": False,
            "app_thread_hook_items": 0,
        }
        errors = module.validate_proof(evidence)
        self.assertIn("a block_and_continue event is required", errors)
        self.assertIn("the App thread must contain a Stop-hook observation", errors)

    def test_rejects_missing_cycle_or_terminal_contract(self) -> None:
        evidence = valid_evidence()
        evidence.pop("supervisor_cycle")
        evidence.pop("terminal_contract")
        errors = module.validate_proof(evidence)
        self.assertIn("the real supervisor-cycle execution is required", errors)
        self.assertIn("a terminal complete contract is required", errors)


if __name__ == "__main__":
    unittest.main()
