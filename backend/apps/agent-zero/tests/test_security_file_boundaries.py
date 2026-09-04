import hashlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
CORE_ROOT = ROOT / "apps" / "agent_zero_core"
sys.path.insert(0, str(CORE_ROOT))

from python.helpers.chat_paths import (
    list_chat_context_ids,
    migrate_legacy_chat_json,
    read_chat_json,
    remove_chat_directory,
    resolve_chat_directory,
    write_chat_json,
)
from python.helpers.checksums import calculate_sha256
from python.helpers import files as file_helpers


class ChatPathSafetyTests(unittest.TestCase):
    def test_resolve_chat_directory_keeps_safe_context_within_chat_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            chat_root = Path(temp_dir) / "tmp" / "chats"
            chat_root.mkdir(parents=True)

            resolved = resolve_chat_directory(str(chat_root), "legacy/session-42")

            self.assertEqual(resolved, str(chat_root / "legacy" / "session-42"))

    def test_resolve_chat_directory_rejects_escaping_context_ids(self):
        context_ids = [
            "",
            "../outside",
            "nested/../outside",
            "/var/tmp/outside",
            r"C:\outside",
            r"\\server\share",
        ]
        with tempfile.TemporaryDirectory() as temp_dir:
            chat_root = Path(temp_dir) / "tmp" / "chats"
            chat_root.mkdir(parents=True)

            for context_id in context_ids:
                with self.subTest(context_id=context_id):
                    with self.assertRaises(ValueError):
                        resolve_chat_directory(str(chat_root), context_id)

    def test_resolve_chat_directory_rejects_symlinked_context_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            chat_root = Path(temp_dir) / "tmp" / "chats"
            outside = Path(temp_dir) / "outside"
            chat_root.mkdir(parents=True)
            outside.mkdir()
            try:
                os.symlink(outside, chat_root / "linked")
            except OSError as error:
                self.skipTest(f"symlink unavailable: {error}")

            with self.assertRaises(ValueError):
                resolve_chat_directory(str(chat_root), "linked")

    def test_resolve_chat_directory_rejects_a_symlinked_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            outside = Path(temp_dir) / "outside"
            root_link = Path(temp_dir) / "chats"
            outside.mkdir()
            try:
                os.symlink(outside, root_link)
            except OSError as error:
                self.skipTest(f"symlink unavailable: {error}")

            with self.assertRaises(ValueError):
                resolve_chat_directory(str(root_link), "safe")

    def test_descriptor_backed_write_never_follows_a_context_symlink(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            chat_root = Path(temp_dir) / "tmp" / "chats"
            outside = Path(temp_dir) / "outside"
            chat_root.mkdir(parents=True)
            outside.mkdir()
            try:
                os.symlink(outside, chat_root / "race")
            except OSError as error:
                self.skipTest(f"symlink unavailable: {error}")

            with self.assertRaises(OSError):
                write_chat_json(str(chat_root), "race", '{"id":"race"}')

            self.assertFalse((outside / "chat.json").exists())

    def test_descriptor_backed_write_rechecks_after_a_path_reference(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            chat_root = Path(temp_dir) / "tmp" / "chats"
            outside = Path(temp_dir) / "outside"
            chat_root.mkdir(parents=True)
            outside.mkdir()

            resolve_chat_directory(str(chat_root), "race")
            try:
                os.symlink(outside, chat_root / "race")
            except OSError as error:
                self.skipTest(f"symlink unavailable: {error}")

            with self.assertRaises(OSError):
                write_chat_json(str(chat_root), "race", '{"id":"race"}')

            self.assertFalse((outside / "chat.json").exists())

    def test_descriptor_backed_store_reads_writes_and_removes_a_regular_chat(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            chat_root = Path(temp_dir) / "tmp" / "chats"
            chat_root.mkdir(parents=True)

            write_chat_json(str(chat_root), "session-42", '{"id":"session-42"}')

            self.assertEqual(
                read_chat_json(str(chat_root), "session-42"), '{"id":"session-42"}'
            )
            self.assertEqual(list_chat_context_ids(str(chat_root)), ["session-42"])
            self.assertTrue(remove_chat_directory(str(chat_root), "session-42"))
            self.assertFalse((chat_root / "session-42").exists())

    def test_descriptor_backed_store_rejects_a_symlinked_chat_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            chat_root = Path(temp_dir) / "tmp" / "chats"
            outside = Path(temp_dir) / "outside"
            context_dir = chat_root / "session-42"
            chat_root.mkdir(parents=True)
            context_dir.mkdir()
            outside.mkdir()
            outside_file = outside / "chat.json"
            outside_file.write_text("outside", encoding="utf-8")
            try:
                os.symlink(outside_file, context_dir / "chat.json")
            except OSError as error:
                self.skipTest(f"symlink unavailable: {error}")

            with self.assertRaises(OSError):
                write_chat_json(str(chat_root), "session-42", '{"id":"session-42"}')
            with self.assertRaises(OSError):
                read_chat_json(str(chat_root), "session-42")

            self.assertEqual(outside_file.read_text(encoding="utf-8"), "outside")

    def test_legacy_migration_refuses_a_symlink_source(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            chat_root = Path(temp_dir) / "tmp" / "chats"
            outside = Path(temp_dir) / "outside"
            chat_root.mkdir(parents=True)
            outside.mkdir()
            outside_file = outside / "legacy.json"
            outside_file.write_text('{"id":"outside"}', encoding="utf-8")
            try:
                os.symlink(outside_file, chat_root / "legacy.json")
            except OSError as error:
                self.skipTest(f"symlink unavailable: {error}")

            with self.assertRaises(ValueError):
                migrate_legacy_chat_json(str(chat_root), "legacy.json")

            self.assertFalse((chat_root / "legacy" / "chat.json").exists())
            self.assertEqual(outside_file.read_text(encoding="utf-8"), '{"id":"outside"}')

    def test_legacy_migration_preserves_regular_chat_content(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            chat_root = Path(temp_dir) / "tmp" / "chats"
            chat_root.mkdir(parents=True)
            (chat_root / "legacy.json").write_text('{"id":"legacy"}', encoding="utf-8")

            migrate_legacy_chat_json(str(chat_root), "legacy.json")

            self.assertFalse((chat_root / "legacy.json").exists())
            self.assertEqual(read_chat_json(str(chat_root), "legacy"), '{"id":"legacy"}')

    def test_secure_removal_refuses_a_symlinked_context(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            chat_root = Path(temp_dir) / "tmp" / "chats"
            outside = Path(temp_dir) / "outside"
            chat_root.mkdir(parents=True)
            outside.mkdir()
            try:
                os.symlink(outside, chat_root / "linked")
            except OSError as error:
                self.skipTest(f"symlink unavailable: {error}")

            with self.assertRaises(ValueError):
                remove_chat_directory(str(chat_root), "linked")

            self.assertTrue(outside.exists())

    def test_ssh_execution_requires_pinned_host_keys(self):
        shell_source = (
            CORE_ROOT / "python" / "helpers" / "shell_ssh.py"
        ).read_text(encoding="utf-8")
        config_source = (ROOT / "agent.py").read_text(encoding="utf-8")
        initialize_source = (ROOT / "initialize.py").read_text(encoding="utf-8")
        tool_source = (
            CORE_ROOT / "python" / "tools" / "code_execution_tool.py"
        ).read_text(encoding="utf-8")

        self.assertIn("load_host_keys(known_hosts_path)", shell_source)
        self.assertIn("paramiko.RejectPolicy()", shell_source)
        self.assertNotIn("AutoAddPolicy", shell_source)
        self.assertIn('code_exec_ssh_known_hosts: str = ""', config_source)
        self.assertIn("not _os.path.isfile(", initialize_source)
        self.assertIn("code_exec_ssh_known_hosts", tool_source)

    def test_calculate_sha256_matches_standard_library_for_binary_content(self):
        payload = b"skincos\x00security\xff"
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "knowledge.bin"
            source.write_bytes(payload)

            self.assertEqual(
                calculate_sha256(str(source)), hashlib.sha256(payload).hexdigest()
            )

    def test_delete_dir_fallback_keeps_permissions_owner_only(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "chat"
            nested = target / "nested"
            nested.mkdir(parents=True)
            (nested / "message.json").write_text("{}", encoding="utf-8")

            original_rmtree = file_helpers.shutil.rmtree
            calls = 0

            def fail_then_delete(path, ignore_errors=False):
                nonlocal calls
                calls += 1
                if calls == 1:
                    return None
                return original_rmtree(path, ignore_errors=ignore_errors)

            with patch.object(
                file_helpers.shutil, "rmtree", side_effect=fail_then_delete
            ), patch.object(file_helpers.os, "chmod", wraps=os.chmod) as chmod:
                file_helpers.delete_dir(str(target))

            self.assertFalse(target.exists())
            self.assertEqual(
                {call.args[1] for call in chmod.call_args_list},
                {0o600, 0o700},
            )
