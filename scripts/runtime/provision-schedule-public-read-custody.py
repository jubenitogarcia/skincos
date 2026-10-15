#!/usr/bin/python3 -I
"""Absent-only fixed-target Schedule custody; no credential input or rotation."""
import ctypes
import grp
import json
import os
import pwd
import re
import resource
import secrets
import stat
import sys

TARGET = "/etc/skincos/schedule-public-read/native-capabilities.json"
TARGET_NAME = "native-capabilities.json"
OPERATOR = "admin"
OPERATOR_GROUP = "skincos-operator-admin"
KEY_NAMES = (
    "SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY",
    "SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY",
    "SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY",
)


class CustodyRejected(Exception):
    """Only the fixed public error reaches stderr."""


def reject():
    raise CustodyRejected("schedule_native_custody_rejected")


def validate_actor(euid, platform, operator_gid, group_gid, legacy_admin_gid):
    if platform != "linux" or euid != 0 or group_gid <= 0 or group_gid == 106:
        reject()
    if operator_gid != group_gid or group_gid == legacy_admin_gid:
        reject()


def validate_ancestor(info, dedicated_gid, *, owner_uid=0):
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid or info.st_mode & 0o022:
        reject()
    # Do not grant or depend on the broad legacy admin group to traverse.
    if not (info.st_mode & 0o001 or info.st_gid == dedicated_gid and info.st_mode & 0o010):
        reject()


def validate_private_directory(info, dedicated_gid, *, owner_uid=0):
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid:
        reject()
    if info.st_gid != dedicated_gid or stat.S_IMODE(info.st_mode) != 0o750:
        reject()


def serialize_capabilities(values):
    if type(values) is not dict or set(values) != set(KEY_NAMES):
        reject()
    if any(type(values[name]) is not str or not re.fullmatch(r"[0-9a-f]{64}", values[name]) for name in KEY_NAMES):
        reject()
    if len(set(values.values())) != 3:
        reject()
    return bytearray((json.dumps(values, separators=(",", ":")) + "\n").encode("ascii"))


def reject_extended_acl(descriptor):
    # Mode bits alone cannot exclude named-user/group ACL readers or default
    # ACL inheritance. Do not repair an existing ACL or broaden another path.
    names = os.listxattr(descriptor)
    if "system.posix_acl_access" in names or "system.posix_acl_default" in names:
        reject()


def assert_absent(directory_fd):
    try:
        os.stat(TARGET_NAME, dir_fd=directory_fd, follow_symlinks=False)
    except FileNotFoundError:
        return
    reject()


def _write_absent_for_verified_directory(directory_fd, payload, dedicated_gid, *, owner_uid=0):
    """Atomic backend; nonroot fixture UID is used only in filesystem tests.

    The privileged entrypoint always supplies owner_uid=0 and the fixed /etc fd.
    It never accepts a directory, UID, GID, payload or secret in CLI/stdin/env.
    """
    temporary = ".native-capabilities-" + secrets.token_hex(12)
    descriptor = None
    linked = False
    own_inode = None
    try:
        validate_private_directory(os.fstat(directory_fd), dedicated_gid, owner_uid=owner_uid)
        reject_extended_acl(directory_fd)
        assert_absent(directory_fd)
        if type(payload) is not bytearray or not 1 <= len(payload) <= 8192:
            reject()
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                             0o600, dir_fd=directory_fd)
        own_inode = os.fstat(descriptor)
        reject_extended_acl(descriptor)
        if own_inode.st_uid != owner_uid or own_inode.st_nlink != 1 or not stat.S_ISREG(own_inode.st_mode):
            reject()
        position = 0
        while position < len(payload):
            written = os.write(descriptor, memoryview(payload)[position:])
            if written <= 0:
                reject()
            position += written
        os.fchown(descriptor, owner_uid, dedicated_gid)
        os.fchmod(descriptor, 0o640)
        os.fsync(descriptor)
        reject_extended_acl(descriptor)
        named = os.stat(temporary, dir_fd=directory_fd, follow_symlinks=False)
        current = os.fstat(descriptor)
        if (named.st_dev, named.st_ino) != (current.st_dev, current.st_ino):
            reject()
        if current.st_uid != owner_uid or current.st_gid != dedicated_gid or stat.S_IMODE(current.st_mode) != 0o640 or current.st_nlink != 1:
            reject()
        # linkat is an atomic no-replace publication. Unlike rename(), it
        # cannot overwrite an existing file, symlink or concurrent winner.
        os.link(temporary, TARGET_NAME, src_dir_fd=directory_fd, dst_dir_fd=directory_fd, follow_symlinks=False)
        linked = True
        os.fsync(directory_fd)
        os.unlink(temporary, dir_fd=directory_fd)
        os.fsync(directory_fd)
        final = os.stat(TARGET_NAME, dir_fd=directory_fd, follow_symlinks=False)
        if (final.st_dev, final.st_ino) != (current.st_dev, current.st_ino) or final.st_nlink != 1:
            reject()
        return {"created": True, "mode": "0640", "parentMode": "0750", "capabilityCount": 3}
    finally:
        if type(payload) is bytearray:
            payload[:] = b"\0" * len(payload)
        if descriptor is not None:
            os.close(descriptor)
        if not linked and own_inode is not None:
            try:
                named = os.stat(temporary, dir_fd=directory_fd, follow_symlinks=False)
                if (named.st_dev, named.st_ino) == (own_inode.st_dev, own_inode.st_ino):
                    os.unlink(temporary, dir_fd=directory_fd)
                    os.fsync(directory_fd)
            except FileNotFoundError:
                pass
        # After publication, errors never delete or replace the canonical
        # target. A crash may retain an own temporary link; consumers reject
        # nlink!=1 and an operator must inspect it, never rerun a rotation.


def _open_fixed_parent(dedicated_gid):
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    descriptor = os.open("/etc", flags)
    try:
        validate_ancestor(os.fstat(descriptor), dedicated_gid)
        reject_extended_acl(descriptor)
        for index, name in enumerate(("skincos", "schedule-public-read")):
            try:
                os.mkdir(name, 0o750, dir_fd=descriptor)
                created = True
            except FileExistsError:
                created = False
            child = os.open(name, flags, dir_fd=descriptor)
            try:
                if created:
                    os.fchown(child, 0, dedicated_gid)
                    os.fchmod(child, 0o750)
                    os.fsync(child)
                    os.fsync(descriptor)
                if index == 1:
                    validate_private_directory(os.fstat(child), dedicated_gid)
                else:
                    validate_ancestor(os.fstat(child), dedicated_gid)
                reject_extended_acl(child)
            except BaseException:
                os.close(child)
                raise
            os.close(descriptor)
            descriptor = child
        if os.path.realpath(os.path.dirname(TARGET)) != os.path.dirname(TARGET):
            reject()
        observed = os.stat(os.path.dirname(TARGET), follow_symlinks=False)
        opened = os.fstat(descriptor)
        if (observed.st_dev, observed.st_ino) != (opened.st_dev, opened.st_ino):
            reject()
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _protect_generator_memory():
    # Process-only protection. Never change global swap or system policy.
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_MEMLOCK, (resource.RLIM_INFINITY, resource.RLIM_INFINITY))
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(4, 0, 0, 0, 0) != 0 or libc.prctl(3, 0, 0, 0, 0) != 0:
        reject()
    if libc.mlockall(1 | 2 | 4) != 0:
        reject()


def provision_fixed_target():
    if sys.platform != "linux" or os.geteuid() != 0 or sys.argv[1:] != ["provision"]:
        reject()
    group = grp.getgrnam(OPERATOR_GROUP)
    operator = pwd.getpwnam(OPERATOR)
    try:
        legacy_gid = grp.getgrnam("admin").gr_gid
    except KeyError:
        legacy_gid = None
    validate_actor(os.geteuid(), sys.platform, operator.pw_gid, group.gr_gid, legacy_gid)
    directory_fd = _open_fixed_parent(group.gr_gid)
    try:
        assert_absent(directory_fd)
        _protect_generator_memory()
        # Credential bytes are created here only, after real actor/path/absence
        # and memory guards. They never enter argv, stdin, stdout or disk logs.
        values = {name: secrets.token_hex(32) for name in KEY_NAMES}
        payload = serialize_capabilities(values)
        values.clear()
        result = _write_absent_for_verified_directory(directory_fd, payload, group.gr_gid)
        return {"contract": "schedule-native-custody-provision/v1", "status": "created", "path": TARGET,
                "operatorGroup": OPERATOR_GROUP, "memoryLocked": True, **result}
    finally:
        os.close(directory_fd)


if __name__ == "__main__":
    try:
        result = provision_fixed_target()
        sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
    except BaseException:
        sys.stderr.write("schedule_native_custody_rejected\n")
        sys.exit(78)
