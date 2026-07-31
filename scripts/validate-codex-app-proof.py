#!/usr/bin/env python3
"""Validate the evidence package for a real Codex App continuity proof.

This is deliberately a strict acceptance check.  A single completed turn, even
with a valid ``continue`` contract, is not proof that the Stop hook ran.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def validate_proof(evidence: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    turns = evidence.get("turns_observed")
    if not isinstance(turns, dict):
        return ["turns_observed is missing"]
    if turns.get("turn_started") != 2:
        errors.append("exactly two turn.started events are required")
    if turns.get("turn_completed") != 2:
        errors.append("exactly two turn.completed events are required")
    if turns.get("automatic_second_turn") is not True:
        errors.append("automatic_second_turn must be true")
    if turns.get("manual_second_prompt") is not False:
        errors.append("manual_second_prompt must be false")

    hook = evidence.get("hook_observation")
    if not isinstance(hook, dict):
        errors.append("hook_observation is missing")
    else:
        if hook.get("new_block_and_continue_event") is not True:
            errors.append("a block_and_continue event is required")
        if not isinstance(hook.get("app_thread_hook_items"), int) or hook["app_thread_hook_items"] < 1:
            errors.append("the App thread must contain a Stop-hook observation")

    first_contract = evidence.get("contract")
    if not isinstance(first_contract, dict) or first_contract.get("first_status") != "continue":
        errors.append("the first turn must emit a continue contract")

    cycle = evidence.get("supervisor_cycle")
    if not isinstance(cycle, dict) or cycle.get("executed") is not True:
        errors.append("the real supervisor-cycle execution is required")

    terminal = evidence.get("terminal_contract")
    if not isinstance(terminal, dict) or terminal.get("status") != "complete":
        errors.append("a terminal complete contract is required")

    artifact = evidence.get("artifact")
    if not isinstance(artifact, dict) or artifact.get("removed") is not True:
        errors.append("the synthetic artifact must be removed")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path, help="sanitized JSON evidence package")
    args = parser.parse_args()
    try:
        evidence = json.loads(args.evidence.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"valid": False, "errors": [f"cannot read evidence: {exc}"]}))
        return 2
    if not isinstance(evidence, dict):
        print(json.dumps({"valid": False, "errors": ["evidence must be a JSON object"]}))
        return 2
    errors = validate_proof(evidence)
    result = {"valid": not errors, "errors": errors}
    print(json.dumps(result, sort_keys=True))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
