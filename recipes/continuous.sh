#!/usr/bin/env sh
# Transparent foreground bridge only: state and scheduling remain in explicit
# USF artefacts, and ordinary Unix supervision owns backgrounding or restart.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
exec "$root/bin/usf" start \
  --profile urn:usf:profile:v3-self-host:1 \
  --manifest graph/manifests/self-host.json \
  --through check
