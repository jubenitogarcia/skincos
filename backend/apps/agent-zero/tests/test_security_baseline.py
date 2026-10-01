import hashlib
import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path
from unittest.mock import patch


AGENT_ZERO_ROOT = Path(__file__).resolve().parents[1]
CORE_ROOT = AGENT_ZERO_ROOT / "apps" / "agent_zero_core"


def _module_from_path(name: str, path: Path, modules: dict[str, types.ModuleType]):
    with patch.dict(sys.modules, modules):
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader
        spec.loader.exec_module(module)
        return module


def _knowledge_import_module():
    document_loaders = types.ModuleType("langchain_community.document_loaders")
    for name in ("CSVLoader", "PyPDFLoader", "TextLoader", "UnstructuredHTMLLoader"):
        setattr(document_loaders, name, object)

    langchain_community = types.ModuleType("langchain_community")
    langchain_community.document_loaders = document_loaders
    helpers = types.ModuleType("python.helpers")
    log = types.ModuleType("python.helpers.log")
    log.LogItem = object
    print_style = types.ModuleType("python.helpers.print_style")
    print_style.PrintStyle = object
    python = types.ModuleType("python")
    python.helpers = helpers
    helpers.log = log
    helpers.print_style = print_style

    return _module_from_path(
        "security_baseline_knowledge_import",
        CORE_ROOT / "python" / "helpers" / "knowledge_import.py",
        {
            "langchain_community": langchain_community,
            "langchain_community.document_loaders": document_loaders,
            "python": python,
            "python.helpers": helpers,
            "python.helpers.log": log,
            "python.helpers.print_style": print_style,
        },
    )


def _shell_ssh_module(events: list[object]):
    paramiko = types.ModuleType("paramiko")

    class RejectPolicy:
        pass

    class SSHClient:
        def __init__(self):
            events.append("created")

        def load_system_host_keys(self):
            events.append("system-host-keys")

        def set_missing_host_key_policy(self, policy):
            events.append(policy)

    paramiko.SSHClient = SSHClient
    paramiko.RejectPolicy = RejectPolicy

    helpers = types.ModuleType("python.helpers")
    log = types.ModuleType("python.helpers.log")
    log.Log = object
    print_style = types.ModuleType("python.helpers.print_style")
    print_style.PrintStyle = object
    strings = types.ModuleType("python.helpers.strings")
    strings.calculate_valid_match_lengths = lambda *args, **kwargs: (0, 0)
    python = types.ModuleType("python")
    python.helpers = helpers
    helpers.log = log
    helpers.print_style = print_style
    helpers.strings = strings

    return _module_from_path(
        "security_baseline_shell_ssh",
        CORE_ROOT / "python" / "helpers" / "shell_ssh.py",
        {
            "paramiko": paramiko,
            "python": python,
            "python.helpers": helpers,
            "python.helpers.log": log,
            "python.helpers.print_style": print_style,
            "python.helpers.strings": strings,
        },
    ), RejectPolicy


def _files_module():
    helpers = types.ModuleType("python.helpers")
    strings = types.ModuleType("python.helpers.strings")
    strings.sanitize_string = lambda value: value
    python = types.ModuleType("python")
    python.helpers = helpers
    helpers.strings = strings
    return _module_from_path(
        "security_baseline_files",
        CORE_ROOT / "python" / "helpers" / "files.py",
        {
            "python": python,
            "python.helpers": helpers,
            "python.helpers.strings": strings,
        },
    )


def test_knowledge_checksum_uses_sha256():
    knowledge_import = _knowledge_import_module()
    content = b"security baseline"

    with tempfile.NamedTemporaryFile() as handle:
        handle.write(content)
        handle.flush()
        assert knowledge_import.calculate_checksum(handle.name) == hashlib.sha256(content).hexdigest()


def test_ssh_session_requires_a_known_host_key():
    events: list[object] = []
    shell_ssh, reject_policy = _shell_ssh_module(events)

    shell_ssh.SSHInteractiveSession(object(), "host.example", 22, "user", "password")

    assert events[0:2] == ["created", "system-host-keys"]
    assert isinstance(events[2], reject_policy)


def test_delete_dir_fallback_keeps_permissions_owner_only_and_confines_path():
    files = _files_module()
    with tempfile.TemporaryDirectory() as temp_dir:
        target = os.path.join(temp_dir, "chat")
        nested = os.path.join(target, "nested")
        os.makedirs(nested)
        with open(os.path.join(nested, "message.json"), "w", encoding="utf-8") as handle:
            handle.write("{}")

        original_rmtree = files.shutil.rmtree
        calls = 0

        def fail_then_delete(path, ignore_errors=False):
            nonlocal calls
            calls += 1
            if calls == 1:
                return None
            return original_rmtree(path, ignore_errors=ignore_errors)

        with patch.object(files, "get_base_dir", return_value=temp_dir), patch.object(
            files.shutil, "rmtree", side_effect=fail_then_delete
        ), patch.object(files.os, "chmod", wraps=os.chmod) as chmod:
            files.delete_dir("chat")

        assert not os.path.exists(target)
        assert {call.args[1] for call in chmod.call_args_list} == {0o600, 0o700}

        outside = os.path.join(os.path.dirname(temp_dir), "outside")
        try:
            files.delete_dir(outside)
        except ValueError as exc:
            assert "outside" in str(exc)
        else:
            raise AssertionError("delete_dir accepted a path outside its root")
