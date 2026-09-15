#!/usr/bin/python3
"""Own one test lane; acknowledge drain only after the kernel has no children."""
import argparse
import ctypes
import json
import os
import signal
import sys
import time

PR_SET_PDEATHSIG = 1
PR_SET_CHILD_SUBREAPER = 36
requested_signal = None
DRAIN_ACKNOWLEDGEMENT = b"FULL_GATE_TREE_DRAINED\n"


def diagnostic(status, reason, **details):
    # Diagnostics must never unwind the lifetime/ownership loop. In particular,
    # a dead controller can close stderr while a survivor still needs draining.
    try:
        payload = {"schema": "urn:usf:full-gate-process-tree:1",
                   "status": status, "reasonCode": reason, **details}
        os.write(2, (json.dumps(payload) + "\n").encode("ascii"))
    except (OSError, ValueError):
        pass


def acknowledge_drain(descriptor):
    if descriptor is not None:
        try:
            os.write(descriptor, DRAIN_ACKNOWLEDGEMENT)
        except OSError:
            # Drain is established, but a missing acknowledgement must leave
            # the controller's durable admission fence unresolved.
            pass


def requested(number, _frame):
    global requested_signal
    requested_signal = requested_signal or number


def process_identity(pid):
    try:
        with open("/proc/%d/stat" % pid, encoding="ascii") as stream:
            fields = stream.read().rsplit(") ", 1)[1].split()
        return fields[19], fields[0], int(fields[1])
    except (FileNotFoundError, ProcessLookupError):
        return None


def children(pid):
    result = set()
    try:
        tasks = os.listdir("/proc/%d/task" % pid)
    except (FileNotFoundError, ProcessLookupError):
        return result
    for task in tasks:
        try:
            with open("/proc/%d/task/%s/children" % (pid, task), encoding="ascii") as stream:
                result.update(int(value) for value in stream.read().split())
        except (FileNotFoundError, ProcessLookupError):
            pass
    return result


def bind_owned_child(pid):
    # A numeric enumeration is only a candidate. Open the handle FIRST, then
    # verify the live process is our direct, unreaped child. This single-threaded
    # guardian does not reap between opening and verifying. Such a child cannot
    # be PID-reused until we reap it, and subsequent signals use only its pidfd.
    # A reused unrelated PID fails the parent check, even if both identity reads
    # would have agreed on the unrelated replacement's start time.
    try:
        descriptor = os.pidfd_open(pid)
    except ProcessLookupError:
        return None
    try:
        identity = process_identity(pid)
        if identity is None or identity[2] != os.getpid() or identity[1] in ("Z", "X"):
            os.close(descriptor)
            return None
        return (pid, identity[0]), descriptor
    except BaseException:
        os.close(descriptor)
        raise


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--parent-pid", type=int, required=True)
    parser.add_argument("--ipc-fd", type=int)
    parser.add_argument("--drain-fd", type=int)
    parser.add_argument("--grace-ms", type=int, default=5000)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or not 1 <= args.grace_ms <= 5000:
        raise RuntimeError("FULL_GATE_TREE_ARGUMENTS_INVALID")
    if args.drain_fd is not None and (args.drain_fd <= 2 or args.drain_fd == args.ipc_fd):
        raise RuntimeError("FULL_GATE_TREE_DRAIN_CHANNEL_INVALID")
    if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        raise RuntimeError("FULL_GATE_TREE_OWNERSHIP_UNAVAILABLE")
    libc = ctypes.CDLL(None, use_errno=True)
    signal.signal(signal.SIGTERM, requested)
    signal.signal(signal.SIGINT, requested)
    if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        raise RuntimeError("FULL_GATE_SUBREAPER_UNAVAILABLE")
    if libc.prctl(PR_SET_PDEATHSIG, signal.SIGTERM, 0, 0, 0) != 0:
        raise RuntimeError("FULL_GATE_PARENT_DEATH_SIGNAL_UNAVAILABLE")
    if os.getppid() != args.parent_pid or requested_signal is not None:
        # No worker has been forked, so there is no owned tree to drain.
        acknowledge_drain(args.drain_fd)
        return 143

    worker = os.fork()
    if worker == 0:
        try:
            os.setsid()
            # Neither the lock nor the private drain channel enters the worker,
            # native launcher or confined policy. Only existing Node IPC passes.
            for value in os.listdir("/proc/self/fd"):
                fd = int(value)
                if fd > 2 and fd != args.ipc_fd:
                    try:
                        os.close(fd)
                    except OSError:
                        pass
            environment = dict(os.environ)
            if args.ipc_fd is None:
                environment.pop("NODE_CHANNEL_FD", None)
                environment.pop("NODE_CHANNEL_SERIALIZATION_MODE", None)
            else:
                os.set_inheritable(args.ipc_fd, True)
                environment["NODE_CHANNEL_FD"] = str(args.ipc_fd)
                environment["NODE_CHANNEL_SERIALIZATION_MODE"] = "json"
            os.execvpe(command[0], command, environment)
        except BaseException:
            os._exit(127)

    worker_status = None
    interrupted = False
    lingering = False
    drain_started = None
    blocked_reported = False
    owned = {}
    failure = False
    drained = False
    try:
        while True:
            try:
                no_children = False
                while True:
                    try:
                        pid, status = os.waitpid(-1, os.WNOHANG)
                    except ChildProcessError:
                        no_children = True
                        break
                    if pid == 0:
                        break
                    for key in list(owned):
                        if key[0] == pid:
                            os.close(owned.pop(key)[0])
                    if pid == worker:
                        worker_status = os.waitstatus_to_exitcode(status)
                if requested_signal is not None:
                    interrupted = True
                # Drain one adopted generation at a time. Killing an owned
                # parent brings detached/double-forked descendants to this
                # subreaper; never chase and signal an unbound numeric PID.
                current = children(os.getpid())
                if worker_status is not None or interrupted or failure:
                    if drain_started is None:
                        drain_started = time.monotonic()
                        lingering = bool(current) and worker_status is not None
                    if no_children:
                        # ECHILD after reaping, not /proc absence or elapsed
                        # time, establishes that the subreaper's tree is empty.
                        drained = True
                        break
                    for pid in current:
                        bound = bind_owned_child(pid)
                        if bound is not None:
                            key, descriptor = bound
                            if key in owned:
                                os.close(descriptor)
                            else:
                                owned[key] = [descriptor, None]
                    elapsed = time.monotonic() - drain_started
                    target_signal = signal.SIGTERM if elapsed < args.grace_ms / 1000 else signal.SIGKILL
                    for descriptor_and_signal in owned.values():
                        if descriptor_and_signal[1] != target_signal:
                            try:
                                signal.pidfd_send_signal(descriptor_and_signal[0], target_signal)
                                descriptor_and_signal[1] = target_signal
                            except ProcessLookupError:
                                pass
                    if elapsed > args.grace_ms / 1000 + 1 and not blocked_reported:
                        # A genuinely uninterruptible survivor retains both the
                        # guardian's kernel lock and the durable admission fence.
                        diagnostic("blocked", "FULL_GATE_TREE_DRAIN_BLOCKED", survivorCount=len(current))
                        blocked_reported = True
            except (OSError, ValueError, IndexError):
                failure = True
                if not blocked_reported:
                    diagnostic("blocked", "FULL_GATE_TREE_OBSERVATION_FAILED")
                    blocked_reported = True
            time.sleep(0.01 if drain_started is not None else 0.02)
    finally:
        for descriptor, _ in owned.values():
            os.close(descriptor)
    if drained:
        acknowledge_drain(args.drain_fd)
    if interrupted:
        return 128 + requested_signal
    if lingering or blocked_reported or failure:
        diagnostic("failed", "FULL_GATE_DESCENDANTS_OUTLIVED_WORKER")
        return 1
    return worker_status if worker_status is not None and worker_status >= 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BaseException as error:
        if isinstance(error, SystemExit):
            raise
        diagnostic("failed", "FULL_GATE_TREE_OWNERSHIP_UNAVAILABLE", errorType=type(error).__name__)
        sys.exit(1)
