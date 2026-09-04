import sys
import tempfile
import uuid
from pathlib import Path


AGENT_ZERO_ROOT = Path(__file__).resolve().parents[1]
CORE_ROOT = AGENT_ZERO_ROOT / "apps" / "agent_zero_core"
if str(CORE_ROOT) not in sys.path:
    sys.path.insert(0, str(CORE_ROOT))

from python.helpers import files


def test_safe_child_path_accepts_legacy_safe_identifier():
    path = files.get_safe_child_path("tmp/chats", "legacy.chat_1-2026")

    assert Path(path).parent == Path(files.get_abs_path("tmp/chats")).resolve()


def test_safe_child_path_rejects_empty_and_traversal_identifiers():
    for value in ("", ".", "..", "../../outside", "/tmp/outside", r"C:\\outside", "chat/name"):
        try:
            files.get_safe_child_path("tmp/chats", value)
        except ValueError:
            continue
        raise AssertionError(f"unsafe component was accepted: {value!r}")


def test_delete_dir_rejects_outside_base_without_touching_the_target():
    with tempfile.TemporaryDirectory() as outside:
        marker = Path(outside) / "keep.txt"
        marker.write_text("keep", encoding="utf-8")

        try:
            files.delete_dir(outside)
        except ValueError:
            pass
        else:
            raise AssertionError("outside deletion was accepted")

        assert marker.read_text(encoding="utf-8") == "keep"


def test_delete_dir_removes_a_base_contained_target():
    relative = f"tmp/files-safety-{uuid.uuid4().hex}"
    target = Path(files.get_abs_path(relative))
    target.mkdir(parents=True)
    (target / "temporary.txt").write_text("temporary", encoding="utf-8")

    files.delete_dir(str(target))

    assert not target.exists()


def test_chat_remove_validates_context_before_mutating_state():
    source = (CORE_ROOT / "python" / "api" / "chat_remove.py").read_text(encoding="utf-8")

    assert source.index("persist_chat.get_chat_folder_path(ctxid)") < source.index(
        "AgentContext.get(ctxid)"
    )
