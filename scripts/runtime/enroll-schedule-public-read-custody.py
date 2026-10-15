#!/usr/bin/python3 -I
"""Fixed infrastructure receiver for the reviewed Schedule-only generator."""
import base64
import hashlib
import json
import os
import re
import sys

CONTRACT = "schedule-native-custody-enrollment/v1"
HELPER_SHA256 = "15c7b3c9b2914c68a72ca37b71914fe68be7339a455b00024a3c5985bf22de12"
MAX_INPUT_BYTES = 32768
MAX_HELPER_BYTES = 16384
HELPER_NAME = "/verified-source/provision-schedule-public-read-custody.py"


class EnrollmentRejected(Exception):
    pass


def reject():
    raise EnrollmentRejected("schedule_native_enrollment_rejected")


def unique_object(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            reject()
        result[name] = value
    return result


def verify_payload(raw, expected_sha, expected_tree):
    # Copy the bounded public input before validation. The execution boundary
    # uses exactly these immutable bytes, never a path that can change later.
    if type(raw) not in (bytes, bytearray) or not 1 <= len(raw) <= MAX_INPUT_BYTES:
        reject()
    raw = bytes(raw)
    if (type(expected_sha) is not str or type(expected_tree) is not str
            or not re.fullmatch(r"[0-9a-f]{40}", expected_sha) or not re.fullmatch(r"[0-9a-f]{40}", expected_tree)):
        reject()
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
    except (UnicodeError, ValueError):
        reject()
    if type(value) is not dict or set(value) != {"contract", "sourceSha", "sourceTree", "helperBase64"}:
        reject()
    if value["contract"] != CONTRACT or value["sourceSha"] != expected_sha or value["sourceTree"] != expected_tree:
        reject()
    encoded = value["helperBase64"]
    if type(encoded) is not str or not encoded.isascii() or not 1 <= len(encoded) <= 21848:
        reject()
    try:
        helper = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        reject()
    if not 1 <= len(helper) <= MAX_HELPER_BYTES or base64.b64encode(helper).decode("ascii") != encoded:
        reject()
    if hashlib.sha256(helper).hexdigest() != HELPER_SHA256:
        reject()
    return helper


def enroll():
    # This is the real OS identity, not a caller-supplied UID or test adapter.
    if sys.platform != "linux" or os.geteuid() != 0 or len(sys.argv) != 4 or sys.argv[1] != "enroll":
        reject()
    expected_sha, expected_tree = sys.argv[2:]
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    helper = verify_payload(raw, expected_sha, expected_tree)
    namespace = {"__name__": "_verified_schedule_custody", "__file__": HELPER_NAME}
    exec(compile(helper, HELPER_NAME, "exec"), namespace)
    # The reviewed generator receives its single literal operation. No source
    # file is reopened and no supplied target, command or secret reaches it.
    sys.argv = [HELPER_NAME, "provision"]
    result = namespace["provision_fixed_target"]()
    if (type(result) is not dict or result.get("contract") != "schedule-native-custody-provision/v1"
            or result.get("status") != "created" or result.get("path") != namespace["TARGET"]
            or result.get("operatorGroup") != "skincos-operator-admin" or result.get("memoryLocked") is not True
            or result.get("created") is not True or result.get("mode") != "0640"
            or result.get("parentMode") != "0750" or result.get("capabilityCount") != 3
            or len(result) != 9):
        reject()
    return {"contract": CONTRACT, "status": "created", "sourceSha": expected_sha, "sourceTree": expected_tree,
            "path": result["path"], "operatorGroup": result["operatorGroup"], "memoryLocked": True,
            "capabilityCount": 3, "mode": "0640", "parentMode": "0750"}


if __name__ == "__main__":
    try:
        sys.stdout.write(json.dumps(enroll(), separators=(",", ":")) + "\n")
    except BaseException:
        sys.stderr.write("schedule_native_enrollment_rejected\n")
        sys.exit(78)
