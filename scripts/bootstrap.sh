#!/usr/bin/env sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
  echo 'USF bootstrap refuses to run as root.' >&2
  exit 5
fi

umask 077
usf_bootstrap_root=$(git rev-parse --show-toplevel)

for usf_bootstrap_path in \
  bin \
  cache/graph cache/models cache/npm cache/corepack cache/pnpm-store \
  cache/prompts cache/routing cache/validation \
  catalog chains claims home logs metrics objects runs store tmp workspaces \
  integration backups xdg/cache xdg/config xdg/data xdg/state lineage
do
  mkdir -p "$usf_bootstrap_root/.usf/$usf_bootstrap_path"
done

chmod 700 "$usf_bootstrap_root/.usf" \
  "$usf_bootstrap_root/.usf/home" \
  "$usf_bootstrap_root/.usf/objects" \
  "$usf_bootstrap_root/.usf/tmp"

"$usf_bootstrap_root/scripts/verify-contained.sh" >/dev/null
printf '%s\n' '{"schema":"urn:usf:init:1","status":"ok","runtimeRoot":".usf","providerContacted":false}'
