#!/usr/bin/env sh
set -eu

usf_verify_root=$(git rev-parse --show-toplevel)
usf_verify_runtime="$usf_verify_root/.usf"

case "$usf_verify_runtime" in
  "$usf_verify_root"/.usf) ;;
  *) echo 'Runtime root is not repository-contained.' >&2; exit 5 ;;
esac

if [ -L "$usf_verify_runtime" ]; then
  echo '.usf must not be a symlink.' >&2
  exit 5
fi

if git -C "$usf_verify_root" ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo '.env must never be tracked.' >&2
  exit 5
fi

if git -C "$usf_verify_root" ls-files | grep -Eq '^\.usf(/|$)'; then
  echo '.usf content must never be tracked.' >&2
  exit 5
fi

git -C "$usf_verify_root" ls-files -s | while read -r usf_verify_mode _ _ usf_verify_path
do
  if [ "$usf_verify_mode" = "120000" ]; then
    usf_verify_target=$(realpath -m "$usf_verify_root/$usf_verify_path")
    case "$usf_verify_target" in
      "$usf_verify_root"/*) ;;
      *) echo "Tracked symlink escapes repository: $usf_verify_path" >&2; exit 5 ;;
    esac
  fi
done

if git -C "$usf_verify_root" grep -n -E \
  '/home/user/src/bak|/home/user/\.local/share/usf|/var/lib/usf' -- \
  ':!GOAL.md' ':!docs/historical-inventory.md' ':!scripts/verify-contained.sh' \
  ':!provenance/reuse.json' >/dev/null 2>&1
then
  echo 'Tracked runtime-bearing content contains a prohibited historical/external path.' >&2
  exit 5
fi

printf '%s\n' '{"schema":"urn:usf:containment-check:1","status":"pass","runtimeRoot":".usf"}'
