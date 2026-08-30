#!/usr/bin/env sh
# Transparent bridge only: state and scheduling remain in explicit USF artefacts.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
if "$root/bin/usf" watch --through check; then
  exit 0
else
  status=$?
fi
echo "usf watch --through check is unavailable; install the CLI watch command before running continuous composition." >&2
exit "$status"
