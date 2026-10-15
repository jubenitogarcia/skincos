"""Synthetic filesystem tests only: no privileged CLI, /etc or real keys."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

SOURCE = Path(__file__).resolve().parents[1] / "runtime/provision-schedule-public-read-custody.py"
SPEC = importlib.util.spec_from_file_location("schedule_custody", SOURCE)
custody = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(custody)


def synthetic():
    return {name: letter * 64 for name, letter in zip(custody.KEY_NAMES, "abc")}


def metadata(mode=0o750, uid=0, gid=2048, kind=stat.S_IFDIR):
    return SimpleNamespace(st_mode=kind | mode, st_uid=uid, st_gid=gid)


class CustodySecurityTests(unittest.TestCase):
    def test_real_root_linux_and_dedicated_primary_group_are_required(self):
        custody.validate_actor(0, "linux", 2048, 2048, 106)
        for args in ((1000, "linux", 2048, 2048, 106), (0, "win32", 2048, 2048, 106),
                     (0, "linux", 106, 106, 106), (0, "linux", 0, 0, 106),
                     (0, "linux", 106, 2048, 106), (0, "linux", 2048, 2048, 2048)):
            with self.subTest(args=args), self.assertRaises(custody.CustodyRejected):
                custody.validate_actor(*args)

    def test_parent_rejects_symlinks_foreign_owners_modes_and_broad_group(self):
        custody.validate_private_directory(metadata(), 2048)
        for item in (metadata(kind=stat.S_IFLNK), metadata(uid=1000), metadata(mode=0o770),
                     metadata(mode=0o755), metadata(mode=0o700), metadata(gid=106)):
            with self.subTest(item=item), self.assertRaises(custody.CustodyRejected):
                custody.validate_private_directory(item, 2048)

    def test_ancestors_cannot_be_foreign_writable_or_require_legacy_group(self):
        custody.validate_ancestor(metadata(mode=0o755, gid=0), 2048)
        custody.validate_ancestor(metadata(), 2048)
        for item in (metadata(mode=0o775), metadata(mode=0o757), metadata(uid=1000),
                     metadata(kind=stat.S_IFLNK), metadata(gid=106)):
            with self.subTest(item=item), self.assertRaises(custody.CustodyRejected):
                custody.validate_ancestor(item, 2048)

    def test_exact_three_distinct_lowercase_hex_capabilities_only(self):
        payload = custody.serialize_capabilities(synthetic())
        self.assertEqual(set(json.loads(payload)), set(custody.KEY_NAMES))
        deltas = []
        for replacement in ("A" * 64, "a" * 63, "a" * 65, "z" * 64, None):
            value = synthetic(); value[custody.KEY_NAMES[0]] = replacement; deltas.append(value)
        value = synthetic(); value[custody.KEY_NAMES[0]] = value[custody.KEY_NAMES[1]]; deltas.append(value)
        value = synthetic(); value["EXTRA"] = "d" * 64; deltas.append(value)
        value = synthetic(); del value[custody.KEY_NAMES[0]]; deltas.append(value)
        for value in deltas:
            with self.subTest(keys=list(value)), self.assertRaises(custody.CustodyRejected):
                custody.serialize_capabilities(value)

    def test_named_access_or_inherited_acl_and_unknown_acl_state_fail_closed(self):
        for names in (["system.posix_acl_access"], ["system.posix_acl_default"]):
            with mock.patch.object(custody.os, "listxattr", return_value=names), self.assertRaises(custody.CustodyRejected):
                custody.reject_extended_acl(self.fd)
        with mock.patch.object(custody.os, "listxattr", side_effect=OSError("fixture-acl-unavailable")), self.assertRaises(OSError):
            custody.reject_extended_acl(self.fd)

    def setUp(self):
        self.sandbox = tempfile.TemporaryDirectory(prefix="schedule-custody-synthetic-")
        self.parent = Path(self.sandbox.name) / "private"
        self.parent.mkdir(mode=0o750)
        os.chmod(self.parent, 0o750)
        self.fd = os.open(self.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)

    def tearDown(self):
        os.close(self.fd)
        self.sandbox.cleanup()

    def write_fixture(self, payload=None):
        return custody._write_absent_for_verified_directory(self.fd, payload if payload is not None else custody.serialize_capabilities(synthetic()),
                                                            os.getgid(), owner_uid=os.getuid())

    def test_atomic_real_filesystem_publication_is_private_and_wipes_buffer(self):
        payload = custody.serialize_capabilities(synthetic())
        with mock.patch.object(custody.secrets, "token_hex", return_value="fixture-temp-nonce") as entropy:
            result = self.write_fixture(payload)
        self.assertEqual(result["capabilityCount"], 3)
        entropy.assert_called_once_with(12)  # filename nonce; NEVER a key-generation call
        info = (self.parent / custody.TARGET_NAME).stat()
        self.assertEqual(stat.S_IMODE(info.st_mode), 0o640)
        self.assertEqual((info.st_uid, info.st_gid, info.st_nlink), (os.getuid(), os.getgid(), 1))
        self.assertEqual(json.loads((self.parent / custody.TARGET_NAME).read_bytes()), synthetic())
        self.assertEqual(set(payload), {0})
        self.assertEqual(os.listdir(self.parent), [custody.TARGET_NAME])

    def test_default_backend_never_treats_an_admin_owned_fixture_as_root(self):
        self.assertNotEqual(os.geteuid(), 0, "tests must execute as the native admin")
        with self.assertRaises(custody.CustodyRejected):
            custody._write_absent_for_verified_directory(self.fd, custody.serialize_capabilities(synthetic()), os.getgid())
        self.assertEqual(os.listdir(self.parent), [])

    def test_existing_regular_file_or_symlink_is_never_read_or_replaced(self):
        target = self.parent / custody.TARGET_NAME
        for symlink in (False, True):
            if symlink:
                target.symlink_to(self.parent / "nonexistent")
            else:
                target.write_bytes(b"fixture-existing-record")
            before = target.lstat()
            payload = custody.serialize_capabilities(synthetic())
            with self.assertRaises(custody.CustodyRejected):
                self.write_fixture(payload)
            after = target.lstat()
            self.assertEqual((before.st_ino, before.st_mode), (after.st_ino, after.st_mode))
            self.assertEqual(set(payload), {0})
            target.unlink()

    def test_concurrent_winner_cannot_be_overwritten_by_atomic_link(self):
        real_link = os.link
        target = self.parent / custody.TARGET_NAME
        def winner(*args, **kwargs):
            target.write_bytes(b"fixture-concurrent-winner")
            return real_link(*args, **kwargs)
        with mock.patch.object(custody.os, "link", side_effect=winner), self.assertRaises(FileExistsError):
            self.write_fixture()
        self.assertEqual(target.read_bytes(), b"fixture-concurrent-winner")
        self.assertEqual(os.listdir(self.parent), [custody.TARGET_NAME])

    def test_prepublication_durability_failure_leaves_no_target_and_wipes_buffer(self):
        real_fsync = os.fsync
        payload = custody.serialize_capabilities(synthetic())
        def unavailable(fd):
            if fd != self.fd:
                raise OSError("fixture-fsync-failure")
            return real_fsync(fd)
        with mock.patch.object(custody.os, "fsync", side_effect=unavailable), self.assertRaises(OSError):
            self.write_fixture(payload)
        self.assertEqual(os.listdir(self.parent), [])
        self.assertEqual(set(payload), {0})

    def test_postpublication_failure_never_deletes_the_canonical_target(self):
        real_fsync = os.fsync
        def unavailable(fd):
            if fd == self.fd:
                raise OSError("fixture-directory-fsync-failure")
            return real_fsync(fd)
        with mock.patch.object(custody.os, "fsync", side_effect=unavailable), self.assertRaises(OSError):
            self.write_fixture()
        target = self.parent / custody.TARGET_NAME
        self.assertTrue(target.is_file())
        self.assertEqual(target.stat().st_nlink, 2)
        with self.assertRaises(custody.CustodyRejected):
            self.write_fixture()
        self.assertEqual(json.loads(target.read_bytes()), synthetic())


if __name__ == "__main__":
    unittest.main()
