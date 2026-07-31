from __future__ import annotations

import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

GATE_PATH = Path(__file__).resolve().parents[1] / "skincos-supervisor-gate.py"
SPEC = importlib.util.spec_from_file_location("skincos_supervisor_gate", GATE_PATH)
assert SPEC and SPEC.loader
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)


class GateFixture(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.repo = self.base / "repo"
        self.runtime = self.repo / ".codex" / "runtime" / "supervisor"
        self.shared = self.base / "shared"
        self.expected_skill = self.repo / "skills" / "skincos-project-orchestrator"
        self.installed_skill = self.base / "installed" / "skincos-project-orchestrator"
        (self.repo / ".codex").mkdir(parents=True)
        self.write_config()
        self.write_skill(self.expected_skill, "same")
        self.write_skill(self.installed_skill, "same")
        self.now = 1_800_000_000.0

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_config(self, **overrides: object) -> None:
        config = dict(gate.DEFAULT_CONFIG)
        config.update(overrides)
        path = self.repo / ".codex" / "supervisor.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(config), encoding="utf-8")

    @staticmethod
    def write_skill(root: Path, content: str) -> None:
        (root / "references").mkdir(parents=True, exist_ok=True)
        (root / "SKILL.md").write_text(f"skill {content}\n", encoding="utf-8")
        for name in (
            "execution-loop.md",
            "authorization-boundaries.md",
            "evidence-model.md",
            "supervisor-cycle.md",
        ):
            (root / "references" / name).write_text(f"{name} {content}\n", encoding="utf-8")

    @staticmethod
    def contract(status: str = "continue", **overrides: object) -> dict[str, object]:
        values: dict[str, object] = {
            "schema_version": 1,
            "orchestration_status": status,
            "objective_status": "in_progress",
            "session_id": None,
            "completed_item": "checked-state",
            "next_item": "run-safe-validation",
            "progress_made": True,
            "human_blocker": None,
            "credential_blocker": None,
            "production_authorization_required": False,
            "evidence_refs": ["local:test"],
        }
        if status == "complete":
            values["objective_status"] = "complete"
            values["next_item"] = None
        values.update(overrides)
        return values

    @staticmethod
    def message(contract: dict[str, object]) -> str:
        return (
            "Cycle result.\n"
            f"{gate.MARKER_BEGIN}\n"
            f"{json.dumps(contract, ensure_ascii=False)}\n"
            f"{gate.MARKER_END}\n"
        )

    def payload(
        self,
        contract: dict[str, object] | None = None,
        *,
        session_id: str = "session-1",
        turn_id: str = "turn-1",
        stop_hook_active: bool = False,
        message: str | None = None,
    ) -> dict[str, object]:
        return {
            "hook_event_name": "Stop",
            "session_id": session_id,
            "turn_id": turn_id,
            "cwd": str(self.repo),
            "transcript_path": str(self.base / "transcript.jsonl"),
            "stop_hook_active": stop_hook_active,
            "last_assistant_message": message if message is not None else self.message(contract or self.contract()),
        }

    def run_gate(
        self,
        payload: dict[str, object],
        *,
        now: float | None = None,
        installed_skill: Path | None | bool = True,
    ) -> dict[str, object]:
        if installed_skill is True:
            selected: str | None = str(self.installed_skill)
        elif installed_skill is False:
            selected = str(self.base / "missing-skill")
        else:
            selected = None
        return gate.process(
            payload,
            self.repo,
            self.runtime,
            self.shared,
            selected,
            self.now if now is None else now,
            os.getpid(),
            socket.gethostname(),
        )

    def snapshot_path(self, session_id: str = "session-1") -> Path:
        return self.runtime / "snapshots" / f"{gate.digest(session_id)}.json"

    def read_snapshot(self, session_id: str = "session-1") -> dict[str, object]:
        return json.loads(self.snapshot_path(session_id).read_text(encoding="utf-8"))

    def test_continue_blocks_and_invokes_supervisor_cycle(self) -> None:
        result = self.run_gate(self.payload())
        self.assertEqual(result["decision"], "block")
        self.assertIn("$skincos-project-orchestrator supervisor-cycle", result["reason"])
        self.assertIn('"cycle": 1', result["reason"])

    def test_compact_session_snapshot_persists_and_reaches_continuation_prompt(self) -> None:
        contract = self.contract(
            session_snapshot={
                "authorization_source": "issue:942-user-mission",
                "issue": 942,
                "branch_worktree": {
                    "branch": "codex/admin/codex-autonomy-baseline",
                    "worktree": "C:/CodexShared/Worktrees/skincos/admin/codex-autonomy-baseline",
                },
                "checkpoint": "checkpoint:before-supervisor-change",
                "remote_fingerprint": "remote:main-16cace3",
                "blocker_fingerprint": "blocker:initial",
                "valid_evidence_refs": ["ci:baseline-green", "artifact:baseline"],
            }
        )
        result = self.run_gate(self.payload(contract))
        self.assertEqual(result["decision"], "block")
        snapshot = self.read_snapshot()
        self.assertEqual(snapshot["authorization_source"], "issue:942-user-mission")
        self.assertEqual(snapshot["issue"], "942")
        self.assertEqual(
            snapshot["branch_worktree"],
            {
                "branch": "codex/admin/codex-autonomy-baseline",
                "worktree": "C:/CodexShared/Worktrees/skincos/admin/codex-autonomy-baseline",
            },
        )
        self.assertEqual(snapshot["checkpoint"], "checkpoint:before-supervisor-change")
        self.assertEqual(snapshot["remote_fingerprint"], "remote:main-16cace3")
        self.assertEqual(snapshot["valid_evidence_refs"], ["artifact:baseline", "ci:baseline-green"])
        self.assertIn("issue:942-user-mission", result["reason"])
        self.assertIn("remote:main-16cace3", result["reason"])

    def test_continued_snapshot_preserves_omitted_context_after_measurable_progress(self) -> None:
        self.write_config(cooldown_seconds=0)
        initial = self.contract(
            session_snapshot={
                "authorization_source": "issue:942-user-mission",
                "issue": "#942",
                "branch": "codex/admin/codex-autonomy-baseline",
                "worktree": "C:/CodexShared/Worktrees/skincos/admin/codex-autonomy-baseline",
                "checkpoint": "checkpoint:before-change",
                "remote_fingerprint": "remote:main-before",
                "valid_evidence_refs": ["artifact:before"],
            }
        )
        first = self.run_gate(self.payload(initial, turn_id="root-1"))
        self.assertEqual(first["decision"], "block")
        progressed = self.contract(
            completed_item="commit:supervisor-snapshot",
            evidence_refs=["commit:supervisor-snapshot"],
        )
        second = self.run_gate(
            self.payload(progressed, turn_id="auto-2", stop_hook_active=True),
            now=self.now + 10,
        )
        self.assertEqual(second["decision"], "block")
        snapshot = self.read_snapshot()
        self.assertEqual(snapshot["authorization_source"], "issue:942-user-mission")
        self.assertEqual(snapshot["issue"], "#942")
        self.assertEqual(snapshot["branch_worktree"]["branch"], "codex/admin/codex-autonomy-baseline")
        self.assertEqual(snapshot["checkpoint"], "checkpoint:before-change")
        self.assertEqual(snapshot["remote_fingerprint"], "remote:main-before")
        self.assertEqual(snapshot["valid_evidence_refs"], ["artifact:before"])

    def test_claimed_progress_without_changed_fingerprint_does_not_repeat_work(self) -> None:
        self.write_config(cooldown_seconds=0)
        contract = self.contract(
            session_snapshot={
                "remote_fingerprint": "remote:main-unchanged",
                "valid_evidence_refs": ["artifact:unchanged"],
            }
        )
        first = self.run_gate(self.payload(contract, turn_id="root-1"))
        self.assertEqual(first["decision"], "block")
        repeated = self.run_gate(
            self.payload(contract, turn_id="auto-2", stop_hook_active=True),
            now=self.now + 10,
        )
        self.assertTrue(repeated["continue"])
        self.assertIn("measurable progress fingerprint did not change", repeated["stopReason"])
        self.assertIn("unchanged work will not be repeated", repeated["stopReason"])

    def test_root_continue_without_measurable_progress_is_not_eligible(self) -> None:
        result = self.run_gate(
            self.payload(self.contract(progress_made=False), turn_id="root-without-progress")
        )
        self.assertTrue(result["continue"])
        self.assertIn("continue without progress has no prior session snapshot", result["stopReason"])

    def test_changed_or_resolved_blocker_allows_one_non_progress_continuation(self) -> None:
        self.write_config(cooldown_seconds=0)
        initial = self.contract(session_snapshot={"blocker_fingerprint": "blocker:ci-running"})
        first = self.run_gate(self.payload(initial, turn_id="root-1"))
        self.assertEqual(first["decision"], "block")
        resolved = self.contract(
            progress_made=False,
            session_snapshot={"blocker_fingerprint": None},
        )
        second = self.run_gate(
            self.payload(resolved, turn_id="auto-2", stop_hook_active=True),
            now=self.now + 10,
        )
        self.assertEqual(second["decision"], "block")
        self.assertIsNone(self.read_snapshot()["blocker_fingerprint"])
        repeated = self.run_gate(
            self.payload(resolved, turn_id="auto-3", stop_hook_active=True),
            now=self.now + 20,
        )
        self.assertTrue(repeated["continue"])
        self.assertIn("blocker fingerprint did not change", repeated["stopReason"])

    def test_corrupt_session_snapshot_stops_active_continuation_without_overwrite(self) -> None:
        self.write_config(cooldown_seconds=0)
        first = self.run_gate(self.payload(turn_id="root-1"))
        self.assertEqual(first["decision"], "block")
        path = self.snapshot_path()
        path.write_text("{bad", encoding="utf-8")

        result = self.run_gate(
            self.payload(turn_id="auto-2", stop_hook_active=True),
            now=self.now + 10,
        )

        self.assertTrue(result["continue"])
        self.assertIn("session snapshot is corrupt", result["stopReason"])
        self.assertEqual(path.read_text(encoding="utf-8"), "{bad")

    def test_complete_allows_terminal_stop(self) -> None:
        result = self.run_gate(self.payload(self.contract("complete")))
        self.assertTrue(result["continue"])
        self.assertIn("terminal state: complete", result["stopReason"])

    def test_complete_requires_evidence(self) -> None:
        result = self.run_gate(self.payload(self.contract("complete", evidence_refs=[])))
        self.assertTrue(result["continue"])
        self.assertIn("requires at least one evidence", result["stopReason"])

    def test_human_blocked_requires_and_preserves_specific_decision(self) -> None:
        contract = self.contract(
            "human_blocked",
            objective_status="blocked",
            next_item=None,
            human_blocker="Approve the exact project hook hash in Codex App.",
        )
        result = self.run_gate(self.payload(contract))
        self.assertTrue(result["continue"])
        self.assertIn("human_blocked", result["stopReason"])

    def test_credential_blocked_is_terminal(self) -> None:
        contract = self.contract(
            "credential_blocked",
            objective_status="blocked",
            next_item=None,
            credential_blocker="GitHub authentication is unavailable.",
        )
        result = self.run_gate(self.payload(contract))
        self.assertTrue(result["continue"])
        self.assertIn("credential_blocked", result["stopReason"])

    def test_production_authorization_is_terminal(self) -> None:
        contract = self.contract(
            "production_authorization_required",
            objective_status="blocked",
            next_item=None,
            production_authorization_required=True,
        )
        result = self.run_gate(self.payload(contract))
        self.assertTrue(result["continue"])
        self.assertIn("production_authorization_required", result["stopReason"])

    def test_cycle_budget_exhaustion_and_explicit_root_reset(self) -> None:
        self.write_config(max_cycles=1, cooldown_seconds=0)
        first = self.run_gate(self.payload(turn_id="root-1"), now=self.now)
        self.assertEqual(first["decision"], "block")
        second = self.run_gate(
            self.payload(turn_id="auto-2", stop_hook_active=True),
            now=self.now + 10,
        )
        self.assertTrue(second["continue"])
        self.assertIn("budget exhausted", second["stopReason"])
        reset = self.run_gate(
            self.payload(turn_id="root-2", stop_hook_active=False),
            now=self.now + 20,
        )
        self.assertEqual(reset["decision"], "block")

    def test_duplicate_event_never_continues_twice(self) -> None:
        payload = self.payload()
        first = self.run_gate(payload)
        second = self.run_gate(payload)
        self.assertEqual(first["decision"], "block")
        self.assertTrue(second["continue"])
        self.assertIn("duplicate", second["stopReason"])

    def test_live_session_lock_stops_concurrent_supervisor(self) -> None:
        session_key = gate.digest("session-1")
        path = self.shared / "session-locks" / f"{session_key}.lock"
        path.parent.mkdir(parents=True)
        path.write_text(
            json.dumps(
                {
                    "pid": os.getpid(),
                    "hostname": socket.gethostname(),
                    "created_at_epoch": self.now,
                }
            ),
            encoding="utf-8",
        )
        result = self.run_gate(self.payload())
        self.assertTrue(result["continue"])
        self.assertIn("currently controls", result["stopReason"])

    def test_validated_orphan_lock_is_quarantined(self) -> None:
        session_key = gate.digest("session-1")
        path = self.shared / "session-locks" / f"{session_key}.lock"
        path.parent.mkdir(parents=True)
        path.write_text(
            json.dumps(
                {
                    "pid": 2_000_000_000,
                    "hostname": socket.gethostname(),
                    "created_at_epoch": self.now - 100,
                }
            ),
            encoding="utf-8",
        )
        result = self.run_gate(self.payload())
        self.assertEqual(result["decision"], "block")
        self.assertTrue(list(path.parent.glob(f"{path.name}.orphaned.*")))

    def test_stop_hook_active_without_mission_cannot_recurse(self) -> None:
        result = self.run_gate(self.payload(stop_hook_active=True))
        self.assertTrue(result["continue"])
        self.assertIn("no recoverable mission", result["stopReason"])

    def test_invalid_json_fails_safely(self) -> None:
        message = f"{gate.MARKER_BEGIN}\n{{not-json}}\n{gate.MARKER_END}"
        result = self.run_gate(self.payload(message=message))
        self.assertTrue(result["continue"])
        self.assertIn("invalid JSON", result["stopReason"])

    def test_missing_structured_block_fails_safely(self) -> None:
        result = self.run_gate(self.payload(message="Done!"))
        self.assertTrue(result["continue"])
        self.assertIn("was not found", result["stopReason"])

    def test_unmarked_json_example_never_activates_continuation(self) -> None:
        message = f"Example only:\n```json\n{json.dumps(self.contract())}\n```"
        result = self.run_gate(self.payload(message=message))
        self.assertTrue(result["continue"])
        self.assertIn("was not found", result["stopReason"])

    def test_internal_error_is_converted_to_safe_allow(self) -> None:
        env = dict(os.environ)
        env["SKINCOS_SUPERVISOR_TEST_FORCE_ERROR"] = "1"
        process = subprocess.run(
            [
                sys.executable,
                str(GATE_PATH),
                "--repo-root",
                str(self.repo),
                "--runtime-root",
                str(self.runtime),
                "--shared-runtime-root",
                str(self.shared),
                "--skill-root",
                str(self.installed_skill),
            ],
            input=json.dumps(self.payload()),
            capture_output=True,
            text=True,
            env=env,
            check=True,
        )
        result = json.loads(process.stdout)
        self.assertTrue(result["continue"])
        self.assertIn("internal error", result["stopReason"])

    def test_utf8_bom_from_windows_transport_is_accepted(self) -> None:
        process = subprocess.run(
            [
                sys.executable,
                str(GATE_PATH),
                "--repo-root",
                str(self.repo),
                "--runtime-root",
                str(self.runtime),
                "--shared-runtime-root",
                str(self.shared),
                "--skill-root",
                str(self.installed_skill),
            ],
            input="\ufeff" + json.dumps(self.payload(message="No structured contract.")),
            capture_output=True,
            text=True,
            check=True,
        )
        result = json.loads(process.stdout)
        self.assertTrue(result["continue"])
        self.assertNotIn("internal error", result["stopReason"])

    def test_missing_installed_skill_fails_safely(self) -> None:
        result = self.run_gate(self.payload(), installed_skill=False)
        self.assertTrue(result["continue"])
        self.assertIn("was not found", result["stopReason"])

    def test_installed_skill_must_match_project_version(self) -> None:
        self.write_skill(self.installed_skill, "different")
        result = self.run_gate(self.payload())
        self.assertTrue(result["continue"])
        self.assertIn("differs from the project version", result["stopReason"])

    def test_two_matching_gate_instances_produce_at_most_one_continuation(self) -> None:
        payload = self.payload()
        barrier = threading.Barrier(2)

        def invoke() -> dict[str, object]:
            barrier.wait()
            return self.run_gate(payload)

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: invoke(), range(2)))
        self.assertEqual(sum(result.get("decision") == "block" for result in results), 1)
        self.assertEqual(sum(result.get("continue") is True for result in results), 1)

    def test_target_lease_prevents_two_sessions_from_same_milestone(self) -> None:
        first = self.run_gate(self.payload(session_id="session-1", turn_id="turn-1"))
        second = self.run_gate(
            self.payload(session_id="session-2", turn_id="turn-2"),
            now=self.now + 10,
        )
        self.assertEqual(first["decision"], "block")
        self.assertTrue(second["continue"])
        self.assertIn("leased by another", second["stopReason"])

    def test_corrupt_target_lease_is_not_overwritten(self) -> None:
        target_key = gate.target_identity("run-safe-validation")
        path = self.shared / "target-leases" / f"{target_key}.json"
        path.parent.mkdir(parents=True)
        path.write_text("{bad", encoding="utf-8")
        result = self.run_gate(self.payload())
        self.assertTrue(result["continue"])
        self.assertIn("unreadable metadata", result["stopReason"])
        self.assertEqual(path.read_text(encoding="utf-8"), "{bad")

    def test_corrupt_mission_state_stops_even_on_new_root(self) -> None:
        session_key = gate.digest("session-1")
        path = self.runtime / "missions" / f"{session_key}.json"
        path.parent.mkdir(parents=True)
        path.write_text("{bad", encoding="utf-8")
        result = self.run_gate(self.payload())
        self.assertTrue(result["continue"])
        self.assertIn("mission state is corrupt", result["stopReason"])
        self.assertEqual(path.read_text(encoding="utf-8"), "{bad")

    def test_cooldown_prevents_overlapping_generated_turn(self) -> None:
        first = self.run_gate(self.payload(turn_id="root-1"), now=self.now)
        second = self.run_gate(
            self.payload(turn_id="auto-2", stop_hook_active=True),
            now=self.now + 1,
        )
        self.assertEqual(first["decision"], "block")
        self.assertTrue(second["continue"])
        self.assertIn("cooldown", second["stopReason"])

    def test_remaining_structured_terminal_statuses_finish_normally(self) -> None:
        for index, status in enumerate(("cycle_budget_exhausted", "safety_stop", "error")):
            with self.subTest(status=status):
                result = self.run_gate(
                    self.payload(
                        self.contract(
                            status,
                            objective_status="in_progress",
                            next_item=None,
                            progress_made=False,
                        ),
                        session_id=f"terminal-{index}",
                        turn_id=f"terminal-turn-{index}",
                    ),
                    now=self.now + index,
                )
                self.assertTrue(result["continue"])
                self.assertIn(f"terminal state: {status}", result["stopReason"])

    def test_continue_prompt_cannot_expand_to_production(self) -> None:
        result = self.run_gate(self.payload())
        self.assertEqual(result["decision"], "block")
        self.assertIn("Never mutate production", result["reason"])
        self.assertNotIn("wrangler deploy", result["reason"])
        self.assertNotIn("migration apply", result["reason"])

    def test_corrupt_control_state_fails_safely(self) -> None:
        self.runtime.mkdir(parents=True)
        (self.runtime / "control.json").write_text("{bad", encoding="utf-8")
        result = self.run_gate(self.payload())
        self.assertTrue(result["continue"])
        self.assertIn("control state is corrupt", result["stopReason"])

    def test_wsl_converts_windows_gitdir_path(self) -> None:
        converted = gate.parse_windows_path_for_posix(
            r"C:\CodexShared\Projetos\skincos\.git\worktrees\example"
        )
        if os.name == "nt":
            self.assertTrue(str(converted).lower().startswith("c:"))
        else:
            self.assertEqual(str(converted), "/mnt/c/CodexShared/Projetos/skincos/.git/worktrees/example")


if __name__ == "__main__":
    unittest.main(verbosity=2)
