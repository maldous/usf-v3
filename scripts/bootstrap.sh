#!/usr/bin/env sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
  echo 'USF bootstrap refuses to run as root.' >&2
  exit 5
fi

umask 077
usf_bootstrap_root=$(git rev-parse --show-toplevel)
cd "$usf_bootstrap_root"

for usf_bootstrap_path in \
  bin \
  cache/graph cache/models cache/npm cache/corepack cache/pnpm-store \
  cache/prompts cache/routing cache/validation \
  catalog chains claims home inputs locks logs metrics objects runs store tmp workspaces \
  integration backups xdg/cache xdg/config xdg/data xdg/state lineage
do
  mkdir -p "$usf_bootstrap_root/.usf/$usf_bootstrap_path"
done

chmod 700 "$usf_bootstrap_root/.usf" \
  "$usf_bootstrap_root/.usf/home" \
  "$usf_bootstrap_root/.usf/inputs" \
  "$usf_bootstrap_root/.usf/locks" \
  "$usf_bootstrap_root/.usf/objects" \
  "$usf_bootstrap_root/.usf/tmp"

usf_bootstrap_lock="$usf_bootstrap_root/.usf/locks/primary-mutation.lock"
node --input-type=module - "$usf_bootstrap_lock" <<'USF_BOOTSTRAP_LOCK'
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";

const path = process.argv[2];
let created = false;
let handle;
try {
  handle = await open(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK, 0o600);
  created = true;
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  handle = await open(path, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
}
try {
  if (created) await handle.chmod(0o600);
  const opened = await handle.stat();
  const named = await lstat(path);
  const uid = process.getuid();
  if (!opened.isFile() || !named.isFile() || named.isSymbolicLink()
    || opened.uid !== uid || named.uid !== uid || opened.nlink !== 1 || named.nlink !== 1
    || (opened.mode & 0o777) !== 0o600 || (named.mode & 0o777) !== 0o600
    || opened.dev !== named.dev || opened.ino !== named.ino || await realpath(path) !== path) {
    throw new Error("USF_BOOTSTRAP_PRIMARY_LOCK_REFUSED");
  }
} finally {
  await handle.close();
}
USF_BOOTSTRAP_LOCK

if [ ! -x /usr/bin/flock ]; then
  echo 'USF bootstrap requires trusted util-linux flock.' >&2
  exit 3
fi

. "$usf_bootstrap_root/scripts/env.sh"
if [ -f "$usf_bootstrap_root/node_modules/.modules.yaml" ]; then
  /usr/bin/flock --exclusive "$usf_bootstrap_lock" corepack pnpm install --frozen-lockfile --offline 1>&2
else
  /usr/bin/flock --exclusive "$usf_bootstrap_lock" corepack pnpm install --frozen-lockfile --prefer-offline 1>&2
fi

if [ ! -f "$usf_bootstrap_root/.usf/catalog/models-dev.raw.json" ] || \
   [ ! -f "$usf_bootstrap_root/.usf/catalog/models-dev.normalized.json" ]; then
  /usr/bin/flock --exclusive "$usf_bootstrap_lock" node -- "$usf_bootstrap_root/src/cli.ts" models refresh --timeout-ms 30000 --max-bytes 33554432 1>&2
else
  /usr/bin/flock --exclusive "$usf_bootstrap_lock" node -- "$usf_bootstrap_root/src/cli.ts" models summary 1>&2
fi

/usr/bin/flock --exclusive "$usf_bootstrap_lock" node -- "$usf_bootstrap_root/src/cli.ts" query --manifest graph/manifests/self-host-provider-v3.json --iri urn:usf:profile:v3-self-host:3 >/dev/null
"$usf_bootstrap_root/scripts/verify-contained.sh" >/dev/null
printf '%s\n' '{"schema":"urn:usf:init:1","status":"ok","runtimeRoot":".usf","providerContacted":false}'
