"""Confined fixture-process launcher for USF fixture validation (wire v1).

Invoked by the TypeScript fixture validator inside the existing bwrap
isolation (user/PID/network namespaces, read-only tool/view/dependency
mounts, scratch-only write, cleared environment) as:

    /usr/bin/python3.12 -I -S -B \
        <execution-view>/src/realisation/fixture-process-launcher.py \
        --fixture-process-v1 '<strict JSON>'

Behaviour, in order, all fail-closed:

  1. Reject any malformed, oversized, duplicate-key, unknown-field or
     out-of-grammar wire payload before any privileged work.
  2. Authenticate the three fixed host tools (node, git, flock) by
     opening each O_RDONLY|O_NOFOLLOW|O_CLOEXEC, requiring fstat
     identity of a regular file with nlink 1, uid 65534 (host root as
     mapped inside the current bwrap 0.9.0 user namespace -- explicitly
     NOT this process's own euid), permission bits exactly 0755, and a
     bounded raw SHA-256 of the opened descriptor's bytes matching the
     declared digest.  The user-namespace identity is separately
     proven by reading a bounded /proc/self/uid_map and requiring
     exactly the measured mapping `1000 0 1`; no environment marker is
     ever accepted as evidence.
  3. Install a Landlock ruleset (kernel ABI >= 4) restricting native
     EXECUTE to exactly those three already-opened inodes.  No rule is
     ever added for Python, a shell, a loader, or any directory.
  4. Set PR_SET_NO_NEW_PRIVS, enforce the ruleset, close every file
     descriptor other than stdio and the verified Node descriptor, then
     replace this process with the verified Node inode via fd-execve on
     the still-open verified descriptor (re-fstat-compared against the
     pre-hash identity snapshot), so no path is re-resolved between
     hashing and execution.  Only the fixed, individually validated
     environment keys required by the fixtures are propagated.

Every refusal prints one fixed bounded code to stderr and exits
non-zero.  There is no fallback mode and no permission-widening path.
This launcher is only reachable through the separately selected
confined-fixture-process mode; it does not alter the default
no-child-process validation mode.
"""

import ctypes
import hashlib
import json
import os
import re
import stat
import struct
import sys

WIRE_SWITCH = "--fixture-process-v1"
WIRE_VERSION = 1
MAX_WIRE_BYTES = 32768
MAX_ARG_BYTES = 4096
MAX_FS_PATH_BYTES = 4000
MIN_NODE_ARGS = 7
MAX_NODE_ARGS = 24
MAX_TEST_TARGETS = 8
MAX_FS_READ_FLAGS = 10
MAX_TOOL_BYTES = 1 << 29
HASH_CHUNK_BYTES = 1 << 20
DIGEST_TEXT_LEN = 71

CALLER_UID = 1000
TOOL_UID = 65534
TOOL_MODE = 0o755

UID_MAP_PATH = "/proc/self/uid_map"
UID_MAP_MAX_BYTES = 256
EXPECTED_UID_MAP = (CALLER_UID, 0, 1)

MAX_ENUMERATED_FDS = 4096

REQUIRED_LOCALE = "C.UTF-8"
REQUIRED_PATH = "/usr/bin"
HOME_SUFFIX = "/.usf-empty-home"
PROVIDER_HOME_SUFFIX = "/.usf/provider-home"
ENVIRONMENT_KEYS = (
    "HOME",
    "LANG",
    "LC_ALL",
    "NODE_PATH",
    "PATH",
    "TMPDIR",
    "USF_BWRAP_NETWORK",
    "USF_PROVIDER_HOME",
    "USF_REPOSITORY_ROOT",
)

TOOL_PATHS = ("/usr/bin/node", "/usr/bin/git", "/usr/bin/flock")
NODE_ARGV0 = "/usr/bin/node"

SUPPORTED_MACHINES = frozenset({"x86_64", "aarch64"})

LANDLOCK_MIN_ABI = 4
LANDLOCK_MAX_DECLARED_ABI = 64
SYS_LANDLOCK_CREATE_RULESET = 444
SYS_LANDLOCK_ADD_RULE = 445
SYS_LANDLOCK_RESTRICT_SELF = 446
LANDLOCK_CREATE_RULESET_VERSION = 1
LANDLOCK_ACCESS_FS_EXECUTE = 1
LANDLOCK_RULE_PATH_BENEATH = 1
PR_SET_NO_NEW_PRIVS = 38

WIRE_KEYS = frozenset({"version", "minimumLandlockAbi", "executables", "nodeArguments"})
EXEC_KEYS = frozenset({"path", "digest"})

REFUSE_USAGE = "USF-FIXTURE-LAUNCH-REFUSED-01-USAGE"
REFUSE_WIRE = "USF-FIXTURE-LAUNCH-REFUSED-02-WIRE"
REFUSE_PLATFORM = "USF-FIXTURE-LAUNCH-REFUSED-03-PLATFORM"
REFUSE_IDENTITY = "USF-FIXTURE-LAUNCH-REFUSED-04-TOOL-IDENTITY"
REFUSE_LANDLOCK = "USF-FIXTURE-LAUNCH-REFUSED-05-LANDLOCK"
REFUSE_EXEC = "USF-FIXTURE-LAUNCH-REFUSED-06-EXEC"
REFUSE_INTERNAL = "USF-FIXTURE-LAUNCH-REFUSED-07-INTERNAL"
REFUSE_ENVIRONMENT = "USF-FIXTURE-LAUNCH-REFUSED-08-ENVIRONMENT"

_DIGEST_RE = re.compile(r"\Asha256:[0-9a-f]{64}\Z")
_ABS_PATH_RE = re.compile(r"\A/[A-Za-z0-9._/-]+\Z")
_TEST_TARGET_RE = re.compile(r"\A[A-Za-z0-9_][A-Za-z0-9._/-]*\.test\.ts\Z")
_NAME_PATTERN_RE = re.compile(r"\A[A-Za-z0-9._-]{1,128}\Z")
_DECIMAL_FIELD_RE = re.compile(r"\A(?:0|[1-9][0-9]{0,9})\Z")
_NETWORK_MARKER_RE = re.compile(r"\A[a-z][a-z0-9-]{0,63}\Z")

FS_READ_PREFIX = "--allow-fs-read="
FS_WRITE_PREFIX = "--allow-fs-write="
NAME_PATTERN_PREFIX = "--test-name-pattern="


def _refuse(code):
    try:
        sys.stderr.write(code + "\n")
        sys.stderr.flush()
    except Exception:
        pass
    os._exit(1)


def _reject_duplicate_keys(pairs):
    seen = set()
    result = {}
    for key, value in pairs:
        if key in seen:
            raise ValueError("duplicate object key")
        seen.add(key)
        result[key] = value
    return result


def _wire_string(value, max_length):
    if type(value) is not str:
        return None
    if not value or len(value) > max_length:
        return None
    for character in value:
        code_point = ord(character)
        if code_point < 0x20 or code_point > 0x7E:
            return None
    return value


def _safe_segments(path, absolute):
    parts = path.split("/")
    if absolute:
        if not parts or parts[0] != "":
            return False
        parts = parts[1:]
    if not parts:
        return False
    for segment in parts:
        if segment in ("", ".", ".."):
            return False
    return True


def _valid_fs_flag(argument, prefix):
    if not argument.startswith(prefix):
        return False
    value = argument[len(prefix):]
    if not value or len(value) > MAX_FS_PATH_BYTES:
        return False
    if "," in value or "*" in value or "?" in value:
        return False
    if _ABS_PATH_RE.match(value) is None:
        return False
    return _safe_segments(value, absolute=True)


def _validate_node_arguments(arguments):
    if type(arguments) is not list:
        _refuse(REFUSE_WIRE)
    if not (MIN_NODE_ARGS <= len(arguments) <= MAX_NODE_ARGS):
        _refuse(REFUSE_WIRE)
    checked = []
    for item in arguments:
        text = _wire_string(item, MAX_ARG_BYTES)
        if text is None:
            _refuse(REFUSE_WIRE)
        checked.append(text)
    if checked[0] != "--permission":
        _refuse(REFUSE_WIRE)
    if checked[1] != "--allow-child-process":
        _refuse(REFUSE_WIRE)
    index = 2
    read_values = []
    write_values = []
    while index < len(checked) and checked[index] != "--test":
        argument = checked[index]
        if argument.startswith(FS_READ_PREFIX):
            if not _valid_fs_flag(argument, FS_READ_PREFIX):
                _refuse(REFUSE_WIRE)
            read_values.append(argument[len(FS_READ_PREFIX):])
        elif argument.startswith(FS_WRITE_PREFIX):
            if not _valid_fs_flag(argument, FS_WRITE_PREFIX):
                _refuse(REFUSE_WIRE)
            write_values.append(argument[len(FS_WRITE_PREFIX):])
        else:
            _refuse(REFUSE_WIRE)
        index += 1
    if not (1 <= len(read_values) <= MAX_FS_READ_FLAGS):
        _refuse(REFUSE_WIRE)
    if len(write_values) != 1:
        _refuse(REFUSE_WIRE)
    if len(set(read_values)) != len(read_values):
        _refuse(REFUSE_WIRE)
    if write_values[0] in read_values:
        _refuse(REFUSE_WIRE)
    if index >= len(checked) or checked[index] != "--test":
        _refuse(REFUSE_WIRE)
    index += 1
    if index >= len(checked) or checked[index] != "--test-isolation=none":
        _refuse(REFUSE_WIRE)
    index += 1
    if index < len(checked) and checked[index].startswith(NAME_PATTERN_PREFIX):
        pattern = checked[index][len(NAME_PATTERN_PREFIX):]
        if _NAME_PATTERN_RE.match(pattern) is None:
            _refuse(REFUSE_WIRE)
        index += 1
    targets = checked[index:]
    if not (1 <= len(targets) <= MAX_TEST_TARGETS):
        _refuse(REFUSE_WIRE)
    if len(set(targets)) != len(targets):
        _refuse(REFUSE_WIRE)
    for target in targets:
        if _TEST_TARGET_RE.match(target) is None:
            _refuse(REFUSE_WIRE)
        if not _safe_segments(target, absolute=False):
            _refuse(REFUSE_WIRE)
    return checked, tuple(read_values), write_values[0]


def _parse_wire(payload):
    try:
        raw = payload.encode("utf-8", "strict")
    except UnicodeEncodeError:
        _refuse(REFUSE_WIRE)
    if len(raw) > MAX_WIRE_BYTES or b"\x00" in raw:
        _refuse(REFUSE_WIRE)
    try:
        document = json.loads(payload, object_pairs_hook=_reject_duplicate_keys)
    except (ValueError, RecursionError):
        _refuse(REFUSE_WIRE)
    if type(document) is not dict or frozenset(document) != WIRE_KEYS:
        _refuse(REFUSE_WIRE)
    version = document["version"]
    if type(version) is not int or version != WIRE_VERSION:
        _refuse(REFUSE_WIRE)
    minimum_abi = document["minimumLandlockAbi"]
    if type(minimum_abi) is not int:
        _refuse(REFUSE_WIRE)
    if not (LANDLOCK_MIN_ABI <= minimum_abi <= LANDLOCK_MAX_DECLARED_ABI):
        _refuse(REFUSE_WIRE)
    executables = document["executables"]
    if type(executables) is not list or len(executables) != len(TOOL_PATHS):
        _refuse(REFUSE_WIRE)
    digests = []
    for expected_path, entry in zip(TOOL_PATHS, executables):
        if type(entry) is not dict or frozenset(entry) != EXEC_KEYS:
            _refuse(REFUSE_WIRE)
        path = _wire_string(entry["path"], MAX_ARG_BYTES)
        digest = _wire_string(entry["digest"], DIGEST_TEXT_LEN)
        if path is None or digest is None:
            _refuse(REFUSE_WIRE)
        if path != expected_path or _DIGEST_RE.match(digest) is None:
            _refuse(REFUSE_WIRE)
        digests.append(digest[len("sha256:"):])
    node_arguments, fs_read_values, fs_write_value = _validate_node_arguments(
        document["nodeArguments"]
    )
    return minimum_abi, digests, node_arguments, fs_read_values, fs_write_value


def _read_uid_map():
    try:
        fd = os.open(UID_MAP_PATH, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except OSError:
        _refuse(REFUSE_PLATFORM)
    data = b""
    while len(data) <= UID_MAP_MAX_BYTES:
        try:
            chunk = os.read(fd, UID_MAP_MAX_BYTES + 1)
        except OSError:
            _refuse(REFUSE_PLATFORM)
        if not chunk:
            break
        data += chunk
    try:
        os.close(fd)
    except OSError:
        _refuse(REFUSE_PLATFORM)
    if not data or len(data) > UID_MAP_MAX_BYTES:
        _refuse(REFUSE_PLATFORM)
    return data


def _authenticate_namespace():
    # Explicit check of the measured bwrap 0.9.0 mapping, not a general
    # portable UID inference: exactly one entry mapping in-namespace uid
    # 1000 to host uid 0 with length 1.  No environment marker and no
    # caller-supplied override is ever accepted as namespace evidence.
    raw = _read_uid_map()
    try:
        text = raw.decode("ascii", "strict")
    except UnicodeDecodeError:
        _refuse(REFUSE_PLATFORM)
    lines = [line for line in text.split("\n") if line.strip()]
    if len(lines) != 1:
        _refuse(REFUSE_PLATFORM)
    fields = lines[0].split()
    if len(fields) != 3:
        _refuse(REFUSE_PLATFORM)
    values = []
    for field in fields:
        if _DECIMAL_FIELD_RE.match(field) is None:
            _refuse(REFUSE_PLATFORM)
        values.append(int(field))
    if tuple(values) != EXPECTED_UID_MAP:
        _refuse(REFUSE_PLATFORM)
    if TOOL_UID == CALLER_UID:
        _refuse(REFUSE_PLATFORM)


def _authenticate_platform():
    if not sys.platform.startswith("linux"):
        _refuse(REFUSE_PLATFORM)
    try:
        uname = os.uname()
    except OSError:
        _refuse(REFUSE_PLATFORM)
    if uname.sysname != "Linux" or uname.machine not in SUPPORTED_MACHINES:
        _refuse(REFUSE_PLATFORM)
    flags = sys.flags
    if flags.isolated != 1 or flags.no_site != 1 or flags.dont_write_bytecode != 1:
        _refuse(REFUSE_PLATFORM)
    if os.execve not in os.supports_fd:
        _refuse(REFUSE_PLATFORM)
    if os.getuid() != CALLER_UID or os.geteuid() != CALLER_UID:
        _refuse(REFUSE_PLATFORM)
    if os.geteuid() == TOOL_UID:
        _refuse(REFUSE_PLATFORM)
    _authenticate_namespace()


def _open_verified_tool(path, digest_hex):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except OSError:
        _refuse(REFUSE_IDENTITY)
    try:
        info = os.fstat(fd)
    except OSError:
        _refuse(REFUSE_IDENTITY)
    if not stat.S_ISREG(info.st_mode):
        _refuse(REFUSE_IDENTITY)
    if info.st_nlink != 1:
        _refuse(REFUSE_IDENTITY)
    if info.st_uid != TOOL_UID:
        _refuse(REFUSE_IDENTITY)
    if stat.S_IMODE(info.st_mode) != TOOL_MODE:
        _refuse(REFUSE_IDENTITY)
    if not (0 < info.st_size <= MAX_TOOL_BYTES):
        _refuse(REFUSE_IDENTITY)
    hasher = hashlib.sha256()
    total = 0
    while True:
        try:
            chunk = os.read(fd, HASH_CHUNK_BYTES)
        except OSError:
            _refuse(REFUSE_IDENTITY)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_TOOL_BYTES:
            _refuse(REFUSE_IDENTITY)
        hasher.update(chunk)
    if total != info.st_size:
        _refuse(REFUSE_IDENTITY)
    if hasher.hexdigest() != digest_hex:
        _refuse(REFUSE_IDENTITY)
    try:
        after = os.fstat(fd)
    except OSError:
        _refuse(REFUSE_IDENTITY)
    if (
        after.st_dev != info.st_dev
        or after.st_ino != info.st_ino
        or after.st_size != info.st_size
        or after.st_uid != info.st_uid
        or after.st_mode != info.st_mode
        or after.st_nlink != info.st_nlink
        or after.st_mtime_ns != info.st_mtime_ns
        or after.st_ctime_ns != info.st_ctime_ns
    ):
        _refuse(REFUSE_IDENTITY)
    try:
        os.lseek(fd, 0, os.SEEK_SET)
    except OSError:
        _refuse(REFUSE_IDENTITY)
    return fd


def _load_libc():
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        syscall_fn = libc.syscall
        prctl_fn = libc.prctl
    except (OSError, AttributeError):
        _refuse(REFUSE_LANDLOCK)
    syscall_fn.restype = ctypes.c_long
    prctl_fn.restype = ctypes.c_int
    prctl_fn.argtypes = [
        ctypes.c_int,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_ulong,
    ]
    return syscall_fn, prctl_fn


def _raw_syscall(syscall_fn, number, arg1, arg2, arg3, arg4=0):
    ctypes.set_errno(0)
    result = syscall_fn(
        ctypes.c_long(number),
        ctypes.c_long(arg1),
        ctypes.c_long(arg2),
        ctypes.c_long(arg3),
        ctypes.c_long(arg4),
    )
    return int(result)


def _apply_landlock(minimum_abi, tool_fds):
    syscall_fn, prctl_fn = _load_libc()
    required_abi = minimum_abi if minimum_abi > LANDLOCK_MIN_ABI else LANDLOCK_MIN_ABI
    abi = _raw_syscall(
        syscall_fn,
        SYS_LANDLOCK_CREATE_RULESET,
        0,
        0,
        LANDLOCK_CREATE_RULESET_VERSION,
    )
    if abi < required_abi:
        _refuse(REFUSE_LANDLOCK)
    ruleset_attr = struct.pack("=Q", LANDLOCK_ACCESS_FS_EXECUTE)
    attr_buffer = ctypes.create_string_buffer(ruleset_attr, len(ruleset_attr))
    ruleset_fd = _raw_syscall(
        syscall_fn,
        SYS_LANDLOCK_CREATE_RULESET,
        ctypes.addressof(attr_buffer),
        len(ruleset_attr),
        0,
    )
    if ruleset_fd < 0:
        _refuse(REFUSE_LANDLOCK)
    for tool_fd in tool_fds:
        rule = struct.pack("=Qi", LANDLOCK_ACCESS_FS_EXECUTE, tool_fd)
        rule_buffer = ctypes.create_string_buffer(rule, len(rule))
        added = _raw_syscall(
            syscall_fn,
            SYS_LANDLOCK_ADD_RULE,
            ruleset_fd,
            LANDLOCK_RULE_PATH_BENEATH,
            ctypes.addressof(rule_buffer),
            0,
        )
        if added != 0:
            _refuse(REFUSE_LANDLOCK)
    for extra_fd in tool_fds[1:]:
        try:
            os.close(extra_fd)
        except OSError:
            _refuse(REFUSE_LANDLOCK)
    if prctl_fn(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        _refuse(REFUSE_LANDLOCK)
    if _raw_syscall(syscall_fn, SYS_LANDLOCK_RESTRICT_SELF, ruleset_fd, 0, 0) != 0:
        _refuse(REFUSE_LANDLOCK)
    try:
        os.close(ruleset_fd)
    except OSError:
        _refuse(REFUSE_LANDLOCK)


def _validated_environment_value(name):
    value = os.environ.get(name)
    text = _wire_string(value, MAX_FS_PATH_BYTES)
    if text is None:
        _refuse(REFUSE_ENVIRONMENT)
    return text


def _build_environment(fs_read_values, fs_write_value):
    root = os.getcwd()
    if len(root) > MAX_FS_PATH_BYTES:
        _refuse(REFUSE_ENVIRONMENT)
    if _ABS_PATH_RE.match(root) is None or not _safe_segments(root, absolute=True):
        _refuse(REFUSE_ENVIRONMENT)
    environment = {}
    for key in ENVIRONMENT_KEYS:
        environment[key] = _validated_environment_value(key)
    if environment["LANG"] != REQUIRED_LOCALE:
        _refuse(REFUSE_ENVIRONMENT)
    if environment["LC_ALL"] != REQUIRED_LOCALE:
        _refuse(REFUSE_ENVIRONMENT)
    if environment["PATH"] != REQUIRED_PATH:
        _refuse(REFUSE_ENVIRONMENT)
    if environment["USF_REPOSITORY_ROOT"] != root:
        _refuse(REFUSE_ENVIRONMENT)
    if environment["HOME"] != root + HOME_SUFFIX:
        _refuse(REFUSE_ENVIRONMENT)
    if environment["USF_PROVIDER_HOME"] != root + PROVIDER_HOME_SUFFIX:
        _refuse(REFUSE_ENVIRONMENT)
    tmpdir = environment["TMPDIR"]
    if tmpdir != fs_write_value or not tmpdir.startswith(root + "/"):
        _refuse(REFUSE_ENVIRONMENT)
    if environment["NODE_PATH"] not in fs_read_values:
        _refuse(REFUSE_ENVIRONMENT)
    # USF_BWRAP_NETWORK is informative only: its shape is validated, but
    # it is never treated as evidence of isolation or authority for trust.
    if _NETWORK_MARKER_RE.match(environment["USF_BWRAP_NETWORK"]) is None:
        _refuse(REFUSE_ENVIRONMENT)
    return environment


def _close_extraneous_fds(keep_fd):
    keep = frozenset((0, 1, 2, keep_fd))
    try:
        entries = os.listdir("/proc/self/fd")
    except OSError:
        _refuse(REFUSE_EXEC)
    if len(entries) > MAX_ENUMERATED_FDS:
        _refuse(REFUSE_EXEC)
    descriptors = []
    for entry in entries:
        if _DECIMAL_FIELD_RE.match(entry) is None:
            _refuse(REFUSE_EXEC)
        descriptors.append(int(entry))
    for descriptor in descriptors:
        if descriptor in keep:
            continue
        try:
            os.close(descriptor)
        except OSError:
            # The descriptor listdir used to enumerate /proc/self/fd is
            # already closed by the time the listing is acted on.
            pass


def _launch(node_fd, argv, environment):
    _close_extraneous_fds(node_fd)
    try:
        os.execve(node_fd, argv, environment)
    except OSError:
        _refuse(REFUSE_EXEC)
    _refuse(REFUSE_EXEC)


def _main():
    if len(sys.argv) != 3 or sys.argv[1] != WIRE_SWITCH:
        _refuse(REFUSE_USAGE)
    parsed = _parse_wire(sys.argv[2])
    minimum_abi, digests, node_arguments, fs_read_values, fs_write_value = parsed
    _authenticate_platform()
    environment = _build_environment(fs_read_values, fs_write_value)
    tool_fds = []
    for tool_path, digest_hex in zip(TOOL_PATHS, digests):
        tool_fds.append(_open_verified_tool(tool_path, digest_hex))
    argv = [NODE_ARGV0] + list(node_arguments)
    _apply_landlock(minimum_abi, tool_fds)
    _launch(tool_fds[0], argv, environment)


if __name__ == "__main__":
    try:
        _main()
    except BaseException:
        _refuse(REFUSE_INTERNAL)
    _refuse(REFUSE_INTERNAL)
