"""Synthetic receiver/security tests as native admin; no elevated operation."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "schedule_enrollment", ROOT / "scripts/runtime/enroll-schedule-public-read-custody.py")
ENROLLMENT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENROLLMENT)
HELPER = (ROOT / "scripts/runtime/provision-schedule-public-read-custody.py").read_bytes().replace(b"\r\n", b"\n")
SOURCE = "a" * 40
TREE = "b" * 40


def payload(**changes):
    value = {"contract": ENROLLMENT.CONTRACT, "sourceSha": SOURCE, "sourceTree": TREE,
             "helperBase64": base64.b64encode(HELPER).decode("ascii")}
    value.update(changes)
    return json.dumps(value, separators=(",", ":")).encode()


class EnrollmentSecurityTests(unittest.TestCase):
    def test_reviewed_public_source_is_exact_and_immutable(self):
        self.assertEqual(hashlib.sha256(HELPER).hexdigest(), ENROLLMENT.HELPER_SHA256)
        original = bytearray(payload())
        verified = ENROLLMENT.verify_payload(original, SOURCE, TREE)
        original[:] = b"x" * len(original)
        self.assertIs(type(verified), bytes)
        self.assertEqual(verified, HELPER)

    def test_source_and_tree_must_match_the_approved_invocation(self):
        for changes in ({"sourceSha": "c" * 40}, {"sourceTree": "d" * 40}, {"contract": "other/v1"}):
            with self.subTest(changes=list(changes)):
                with self.assertRaises(ENROLLMENT.EnrollmentRejected):
                    ENROLLMENT.verify_payload(payload(**changes), SOURCE, TREE)
        for source, tree in ((None, TREE), (SOURCE, 1), ("A" * 40, TREE), (SOURCE, "b" * 39)):
            with self.assertRaises(ENROLLMENT.EnrollmentRejected):
                ENROLLMENT.verify_payload(payload(), source, tree)

    def test_no_command_target_secret_or_identity_fields_are_accepted(self):
        for name in ("target", "command", "argv", "euid", "gid", "secret", "helperSha256", "environment"):
            with self.subTest(name=name):
                with self.assertRaises(ENROLLMENT.EnrollmentRejected):
                    ENROLLMENT.verify_payload(payload(**{name: "synthetic"}), SOURCE, TREE)

    def test_duplicate_fields_and_invalid_json_encoding_fail_closed(self):
        for raw in (payload()[:-1] + b',"sourceSha":"' + SOURCE.encode() + b'"}',
                    b"\xef\xbb\xbf" + payload(), b"\xff", b"[]", b"null", b"{}"):
            with self.assertRaises(ENROLLMENT.EnrollmentRejected):
                ENROLLMENT.verify_payload(raw, SOURCE, TREE)

    def test_tampered_source_cannot_be_executed_by_rehashing_its_input(self):
        changed = HELPER.replace(b"TARGET =", b"OTHER_TARGET =", 1)
        for helper in (changed, b"print('synthetic-arbitrary-program')", HELPER + b"\n"):
            with self.assertRaises(ENROLLMENT.EnrollmentRejected):
                ENROLLMENT.verify_payload(payload(helperBase64=base64.b64encode(helper).decode()), SOURCE, TREE)

    def test_base64_must_be_bounded_canonical_and_strict(self):
        encoded = base64.b64encode(HELPER).decode()
        for candidate in (encoded + "\n", "%%%", "", "a" * 21849, 1, encoded + "="):
            with self.assertRaises(ENROLLMENT.EnrollmentRejected):
                ENROLLMENT.verify_payload(payload(helperBase64=candidate), SOURCE, TREE)
        with self.assertRaises(ENROLLMENT.EnrollmentRejected):
            ENROLLMENT.verify_payload(b"x" * (ENROLLMENT.MAX_INPUT_BYTES + 1), SOURCE, TREE)

    def test_real_native_admin_cannot_trigger_root_generator(self):
        self.assertEqual(sys.platform, "linux")
        self.assertNotEqual(os.geteuid(), 0)
        # OS identity is not mocked. No stdin is touched before rejection;
        # no source compile, generator, memory guard or /etc write can run.
        with mock.patch.object(ENROLLMENT.sys, "argv", ["receiver", "enroll", SOURCE, TREE]):
            with mock.patch.object(ENROLLMENT.sys, "stdin") as stream:
                with mock.patch("builtins.compile", side_effect=AssertionError("must not compile")):
                    with self.assertRaises(ENROLLMENT.EnrollmentRejected):
                        ENROLLMENT.enroll()
                stream.buffer.read.assert_not_called()


if __name__ == "__main__":
    unittest.main()
