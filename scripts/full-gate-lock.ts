import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

export class FullGateLockError extends Error {
  readonly code: string;
  readonly exitCode: number;
  constructor(code: string, exitCode: number) {
    super(code === "FULL_GATE_ALREADY_RUNNING"
      ? "Another full gate owns this repository. Observe that run instead of launching another."
      : code === "FULL_GATE_DRAIN_UNCONFIRMED"
        ? "A prior gate has no confirmed process-tree drain. Admission is fenced pending explicit, positively evidenced recovery."
        : "The full-gate execution lock is unavailable; no tests were started.");
    this.name = "FullGateLockError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export type FullGateLock = (() => void) & {
  readonly descriptor: number;
  /** Call only after every spawned guardian explicitly acknowledged kernel-proven drain. */
  confirmDrained(): void;
};

function syncDirectory(directory: string): void {
  const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

/**
 * The kernel flock covers live holders; a durable fence covers lost guardians
 * and controllers. Every admission writes and fsyncs its fence BEFORE any lane
 * can launch. Release without positive drain confirmation never removes it.
 * Never unlink execution.lock, infer recovery from PID absence/time, or clear a
 * previous fence automatically. Recovery needs separately authorized positive
 * ownership/drain evidence; this helper intentionally supplies no force-clear.
 * This guard neither accepts evidence nor controls USF stewardship.
 */
export function acquireFullGateLock(repositoryRoot: string): FullGateLock {
  let descriptor: number | undefined;
  let fenceDescriptor: number | undefined;
  try {
    let directory = realpathSync(repositoryRoot);
    for (const segment of [".usf", "logs", "full-gate"]) {
      directory = resolve(directory, segment);
      try { mkdirSync(directory, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const metadata = lstatSync(directory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()
        || metadata.uid !== process.getuid?.() || (metadata.mode & 0o022) !== 0) {
        throw new FullGateLockError("FULL_GATE_LOCK_UNAVAILABLE", 1);
      }
    }
    const path = resolve(directory, "execution.lock");
    descriptor = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== process.getuid?.()
      || (opened.mode & 0o077) !== 0) throw new FullGateLockError("FULL_GATE_LOCK_UNAVAILABLE", 1);
    const executable = ["/usr/bin/flock", "/bin/flock"].find(existsSync);
    if (executable === undefined) throw new FullGateLockError("FULL_GATE_LOCK_UNAVAILABLE", 1);
    const result = spawnSync(executable, ["--exclusive", "--nonblock", "--conflict-exit-code", "75", "3"], {
      stdio: ["ignore", "ignore", "pipe", descriptor],
      env: { PATH: "/usr/bin:/bin", LANG: "C" },
      timeout: 5000,
    });
    if (result.status === 75) throw new FullGateLockError("FULL_GATE_ALREADY_RUNNING", 75);
    if (result.error || result.signal || result.status !== 0) throw new FullGateLockError("FULL_GATE_LOCK_UNAVAILABLE", 1);
    const current = lstatSync(path);
    if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1
      || current.dev !== opened.dev || current.ino !== opened.ino) {
      throw new FullGateLockError("FULL_GATE_LOCK_UNAVAILABLE", 1);
    }
    const fencePath = resolve(directory, "execution.pending.json");
    try {
      fenceDescriptor = openSync(fencePath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new FullGateLockError("FULL_GATE_DRAIN_UNCONFIRMED", 75);
      throw error;
    }
    const fenceBytes = JSON.stringify({
      schema: "urn:usf:full-gate-admission-fence:1",
      reasonCode: "FULL_GATE_DRAIN_UNCONFIRMED",
      executionId: randomUUID(),
      ownerPid: process.pid,
      createdAt: new Date().toISOString(),
    }) + "\n";
    writeFileSync(fenceDescriptor, fenceBytes);
    fsyncSync(fenceDescriptor);
    syncDirectory(directory);
    const fenceIdentity = fstatSync(fenceDescriptor);
    let held: number | undefined = descriptor;
    let confirmed = false;
    const release = () => {
      if (held === undefined) return;
      const closing = held;
      held = undefined;
      try {
        if (confirmed) {
          const currentFence = lstatSync(fencePath);
          if (!currentFence.isFile() || currentFence.isSymbolicLink() || currentFence.nlink !== 1
            || currentFence.dev !== fenceIdentity.dev || currentFence.ino !== fenceIdentity.ino
            || readFileSync(fencePath, "utf8") !== fenceBytes)
            throw new FullGateLockError("FULL_GATE_LOCK_UNAVAILABLE", 1);
          unlinkSync(fencePath);
          syncDirectory(directory);
        }
      } finally {
        try { closeSync(fenceDescriptor!); } finally { closeSync(closing); }
      }
    };
    return Object.assign(release, {
      descriptor,
      confirmDrained() {
        if (held === undefined) throw new FullGateLockError("FULL_GATE_DRAIN_UNCONFIRMED", 75);
        confirmed = true;
      },
    });
  } catch (error) {
    if (fenceDescriptor !== undefined) closeSync(fenceDescriptor);
    if (descriptor !== undefined) closeSync(descriptor);
    if (error instanceof FullGateLockError) throw error;
    throw new FullGateLockError("FULL_GATE_LOCK_UNAVAILABLE", 1);
  }
}
