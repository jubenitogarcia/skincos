import ntpath
import os
import re
import shutil
import stat
from contextlib import contextmanager
from typing import Iterator


CHAT_FILE_NAME = "chat.json"


def _require_secure_directory_operations() -> None:
    required_operations = (os.open, os.mkdir, os.stat, os.unlink)
    if (
        os.name != "posix"
        or not hasattr(os, "O_DIRECTORY")
        or not hasattr(os, "O_NOFOLLOW")
        or any(operation not in os.supports_dir_fd for operation in required_operations)
    ):
        raise OSError("secure persisted chats require POSIX descriptor operations")


def _directory_flags() -> int:
    return (
        os.O_RDONLY
        | os.O_DIRECTORY
        | os.O_NOFOLLOW
        | getattr(os, "O_CLOEXEC", 0)
    )


def _file_flags(flags: int) -> int:
    return flags | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)


def _context_components(context_id: str) -> list[str]:
    if not isinstance(context_id, str) or not context_id or "\x00" in context_id:
        raise ValueError("invalid chat context id")

    if (
        os.path.isabs(context_id)
        or ntpath.isabs(context_id)
        or ntpath.splitdrive(context_id)[0]
    ):
        raise ValueError("chat context id must be relative")

    components = re.split(r"[\\/]", context_id)
    if any(component in {"", ".", ".."} for component in components):
        raise ValueError("chat context id contains an unsafe path component")
    return components


def _absolute_components(path: str) -> list[str]:
    if not isinstance(path, str) or not path or not os.path.isabs(path):
        raise ValueError("chat root must be an absolute path")

    normalized = os.path.normpath(path)
    return [component for component in normalized.split(os.sep) if component]


def _open_directory_at(parent_fd: int, component: str, create: bool) -> int:
    try:
        return os.open(component, _directory_flags(), dir_fd=parent_fd)
    except FileNotFoundError:
        if not create:
            raise
        try:
            os.mkdir(component, mode=0o700, dir_fd=parent_fd)
        except FileExistsError:
            # A concurrent writer may have won the create race. Re-open below with
            # O_NOFOLLOW so a replacement symlink still fails closed.
            pass
        return os.open(component, _directory_flags(), dir_fd=parent_fd)


def _open_chat_root(chat_root: str, create: bool) -> int:
    """Open every root component from / without following a symlink."""
    _require_secure_directory_operations()
    components = _absolute_components(chat_root)
    root_fd = os.open(os.path.sep, _directory_flags())
    try:
        for component in components:
            child_fd = _open_directory_at(root_fd, component, create=create)
            os.close(root_fd)
            root_fd = child_fd
        return root_fd
    except Exception:
        os.close(root_fd)
        raise


@contextmanager
def _open_context_from_root(
    root_fd: int, components: list[str], create: bool
) -> Iterator[int]:
    context_fd = os.dup(root_fd)
    try:
        for component in components:
            child_fd = _open_directory_at(context_fd, component, create=create)
            os.close(context_fd)
            context_fd = child_fd
        yield context_fd
    finally:
        os.close(context_fd)


@contextmanager
def _open_chat_context(
    chat_root: str, context_id: str, create: bool
) -> Iterator[tuple[int, int]]:
    components = _context_components(context_id)
    root_fd = _open_chat_root(chat_root, create=create)
    try:
        with _open_context_from_root(root_fd, components, create=create) as context_fd:
            yield root_fd, context_fd
    finally:
        os.close(root_fd)


def _validate_existing_context_path(root_fd: int, components: list[str]) -> None:
    """Reject existing symlinks while preserving path-only compatibility."""
    context_fd = os.dup(root_fd)
    try:
        for component in components:
            try:
                child_fd = _open_directory_at(context_fd, component, create=False)
            except FileNotFoundError:
                return
            os.close(context_fd)
            context_fd = child_fd
    finally:
        os.close(context_fd)


def resolve_chat_directory(chat_root: str, context_id: str) -> str:
    """Validate a chat-directory reference without following existing links.

    Persisted chat I/O must use the descriptor-backed functions below; a returned
    string cannot remain race-safe after this function returns.
    """
    components = _context_components(context_id)
    try:
        root_fd = _open_chat_root(chat_root, create=False)
    except FileNotFoundError:
        return os.path.join(os.path.abspath(chat_root), *components)
    except OSError as error:
        raise ValueError("chat root contains an unsafe symlink") from error
    try:
        _validate_existing_context_path(root_fd, components)
    except OSError as error:
        raise ValueError("chat context directory contains an unsafe symlink") from error
    finally:
        os.close(root_fd)

    return os.path.join(os.path.abspath(chat_root), *components)


def _open_chat_file(context_fd: int, flags: int) -> int:
    return os.open(CHAT_FILE_NAME, _file_flags(flags), 0o600, dir_fd=context_fd)


def write_chat_json(chat_root: str, context_id: str, content: str) -> None:
    if not isinstance(content, str):
        raise TypeError("persisted chat content must be text")

    with _open_chat_context(chat_root, context_id, create=True) as (_, context_fd):
        file_fd = _open_chat_file(context_fd, os.O_WRONLY | os.O_CREAT | os.O_TRUNC)
        try:
            os.fchmod(file_fd, 0o600)
            with os.fdopen(file_fd, "w", encoding="utf-8") as file:
                file_fd = -1
                file.write(content)
        finally:
            if file_fd != -1:
                os.close(file_fd)


def read_chat_json(chat_root: str, context_id: str) -> str:
    with _open_chat_context(chat_root, context_id, create=False) as (_, context_fd):
        file_fd = _open_chat_file(context_fd, os.O_RDONLY)
        try:
            with os.fdopen(file_fd, "r", encoding="utf-8") as file:
                file_fd = -1
                return file.read()
        finally:
            if file_fd != -1:
                os.close(file_fd)


def list_chat_context_ids(chat_root: str) -> list[str]:
    try:
        root_fd = _open_chat_root(chat_root, create=False)
    except FileNotFoundError:
        return []

    try:
        context_ids = []
        for entry in os.listdir(root_fd):
            try:
                components = _context_components(entry)
                with _open_context_from_root(root_fd, components, create=False):
                    context_ids.append(entry)
            except (FileNotFoundError, NotADirectoryError, OSError, ValueError):
                # Existing symlinks, files, and concurrent removals are not chats.
                continue
        return context_ids
    finally:
        os.close(root_fd)


def _legacy_context_id(filename: str) -> str:
    if os.path.basename(filename) != filename or not filename.endswith(".json"):
        raise ValueError("legacy chat filename must be a direct .json file")
    context_id = filename.removesuffix(".json")
    components = _context_components(context_id)
    if len(components) != 1:
        raise ValueError("legacy chat filename must name one context directory")
    return context_id


def list_legacy_chat_jsons(chat_root: str) -> list[str]:
    try:
        root_fd = _open_chat_root(chat_root, create=False)
    except FileNotFoundError:
        return []

    try:
        return [entry for entry in os.listdir(root_fd) if entry.endswith(".json")]
    finally:
        os.close(root_fd)


def _copy_file_descriptor(source_fd: int, destination_fd: int) -> None:
    while chunk := os.read(source_fd, 64 * 1024):
        view = memoryview(chunk)
        while view:
            view = view[os.write(destination_fd, view) :]


def migrate_legacy_chat_json(chat_root: str, filename: str) -> None:
    """Copy one legacy direct chat file without accepting a symlink source."""
    context_id = _legacy_context_id(filename)
    root_fd = _open_chat_root(chat_root, create=False)
    source_fd = -1
    try:
        try:
            source_fd = os.open(filename, _file_flags(os.O_RDONLY), dir_fd=root_fd)
        except OSError as error:
            raise ValueError("legacy chat source is unsafe") from error

        source_stat = os.fstat(source_fd)
        if not stat.S_ISREG(source_stat.st_mode):
            raise ValueError("legacy chat source must be a regular file")

        with _open_context_from_root(
            root_fd, _context_components(context_id), create=True
        ) as context_fd:
            destination_fd = _open_chat_file(
                context_fd, os.O_WRONLY | os.O_CREAT | os.O_TRUNC
            )
            try:
                os.fchmod(destination_fd, 0o600)
                _copy_file_descriptor(source_fd, destination_fd)
            finally:
                os.close(destination_fd)

        try:
            current_stat = os.stat(filename, dir_fd=root_fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        if (current_stat.st_dev, current_stat.st_ino) == (
            source_stat.st_dev,
            source_stat.st_ino,
        ):
            os.unlink(filename, dir_fd=root_fd)
    finally:
        if source_fd != -1:
            os.close(source_fd)
        os.close(root_fd)


def remove_chat_directory(chat_root: str, context_id: str) -> bool:
    """Remove one context via a parent descriptor without following links."""
    if not getattr(shutil.rmtree, "avoids_symlink_attacks", False):
        raise OSError("secure chat deletion is unavailable on this platform")

    components = _context_components(context_id)
    try:
        root_fd = _open_chat_root(chat_root, create=False)
    except FileNotFoundError:
        return False

    parent_fd = os.dup(root_fd)
    try:
        for component in components[:-1]:
            child_fd = _open_directory_at(parent_fd, component, create=False)
            os.close(parent_fd)
            parent_fd = child_fd

        try:
            target_stat = os.stat(
                components[-1], dir_fd=parent_fd, follow_symlinks=False
            )
        except FileNotFoundError:
            return False
        if not stat.S_ISDIR(target_stat.st_mode):
            raise ValueError("chat context directory is unsafe")

        shutil.rmtree(components[-1], dir_fd=parent_fd)
        return True
    finally:
        os.close(parent_fd)
        os.close(root_fd)
