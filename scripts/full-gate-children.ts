import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { resolve } from "node:path";
import type { Readable } from "node:stream";

export interface GateChildOwner {
  spawn(executable: string, args: readonly string[], options: SpawnOptions): ChildProcess;
  abort(reason?: string): void;
  close(): Promise<void>;
  readonly interrupted: boolean;
}

/**
 * A guardian exit is not a drain witness. Each lane has a private acknowledgement
 * pipe which the worker closes before exec. Missing/invalid acknowledgement
 * poisons close(), so the runner cannot clear its durable admission fence.
 */
export function createGateChildOwner(terminationGraceMilliseconds = 5000): GateChildOwner {
  if (process.platform !== "linux" || !Number.isInteger(terminationGraceMilliseconds)
    || terminationGraceMilliseconds < 1 || terminationGraceMilliseconds > 5000)
    throw new Error("FULL_GATE_TREE_OWNERSHIP_UNAVAILABLE");
  const active = new Set<ChildProcess>();
  const waiters = new Set<() => void>();
  let aborted = false, interruption = false, unconfirmed = false;
  const abort = (_reason?: string) => {
    aborted = true;
    for (const child of active)
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  };
  const onSignal = () => { interruption = true; abort("FULL_GATE_INTERRUPTED"); };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return {
    abort,
    get interrupted() { return interruption; },
    spawn(executable, args, options) {
      if (aborted) throw new Error("FULL_GATE_CANCELLED");
      const stdio = options.stdio ?? ["ignore", "pipe", "pipe"];
      if (!Array.isArray(stdio) || stdio.length < 3) throw new Error("FULL_GATE_TREE_STDIO_INVALID");
      const ipc = stdio.indexOf("ipc");
      const drainFd = stdio.length;
      const child = spawn("/usr/bin/python3", [
        "-B", resolve(import.meta.dirname, "full-gate-process-tree.py"),
        "--parent-pid", String(process.pid),
        "--grace-ms", String(terminationGraceMilliseconds),
        "--drain-fd", String(drainFd),
        ...(ipc < 0 ? [] : ["--ipc-fd", String(ipc)]),
        "--", executable, ...args,
      ], { ...options, stdio: [...stdio, "pipe"], detached: true });
      active.add(child);
      const proof = child.stdio[drainFd] as Readable | null | undefined;
      let acknowledgement = "", invalid = false, proofEnded = proof == null, exited = false;
      const confirmed = () => !invalid && acknowledgement === "FULL_GATE_TREE_DRAINED\n";
      const noticeLostGuardian = () => {
        if (!exited || !proofEnded || confirmed()) return;
        unconfirmed = true;
        abort("FULL_GATE_TREE_DRAIN_UNCONFIRMED");
        // A surviving worker can hold stdout/IPC open after guardian death.
        // Closing our pipes settles transport, NOT ownership. The durable
        // fence remains; no numeric-PID fallback attempts to invent a drain.
        for (const stream of child.stdio) stream?.destroy();
        if (child.connected) {
          try { child.disconnect(); } catch { /* transport already closed */ }
        }
      };
      proof?.on("data", (bytes: Buffer) => {
        if (acknowledgement.length + bytes.length > 64) invalid = true;
        else acknowledgement += bytes.toString("ascii");
      });
      proof?.once("error", () => { invalid = true; proofEnded = true; noticeLostGuardian(); });
      proof?.once("end", () => { proofEnded = true; noticeLostGuardian(); });
      proof?.once("close", () => { proofEnded = true; noticeLostGuardian(); });
      child.once("error", () => {
        exited = true;
        invalid = true;
        abort("FULL_GATE_CHILD_ERROR");
        noticeLostGuardian();
      });
      child.once("exit", (code, signal) => {
        exited = true;
        if (code !== 0 || signal !== null) abort("FULL_GATE_CHILD_FAILED");
        noticeLostGuardian();
      });
      child.once("close", () => {
        if (!confirmed()) {
          unconfirmed = true;
          abort("FULL_GATE_TREE_DRAIN_UNCONFIRMED");
        }
        active.delete(child);
        if (active.size === 0) {
          for (const settle of waiters) settle();
          waiters.clear();
        }
      });
      return child;
    },
    async close() {
      if (active.size !== 0) {
        abort("FULL_GATE_DRAIN");
        await new Promise<void>(accept => waiters.add(accept));
      }
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      if (unconfirmed) throw Object.assign(new Error("FULL_GATE_TREE_DRAIN_UNCONFIRMED"), {
        code: "FULL_GATE_TREE_DRAIN_UNCONFIRMED",
      });
    },
  };
}
