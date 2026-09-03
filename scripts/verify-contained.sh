#!/usr/bin/env sh
set -eu

# Repository containment verifier.
#
# Classification: current runtime architecture. This is the graph-declared
# validation urn:usf:validation:repository-containment-check, required by the
# integration carrier intents.
#
# It fails when tracked runtime-bearing content would make V3 depend on a
# historical (V1/V2/Factory) repository, worktree, recovery directory,
# executable, module import or runtime state, or on any absolute
# development-machine path.
#
# Historical provenance documents are exempt by explicit classification: they
# describe lineage and are never read at runtime. Each exemption must exist, and
# each one that is not the programme document or this verifier must carry the
# provenance marker, so an exemption cannot silently outlive its file or quietly
# become something other than a provenance document.
#
# The patterns are held here rather than in the graph deliberately: this guard
# runs at bootstrap with only git and a POSIX shell available, before any
# graph reader exists.

usf_verify_root=$(git rev-parse --show-toplevel)
usf_verify_runtime="$usf_verify_root/.usf"
usf_verify_marker='USF-PROVENANCE-DOCUMENT'

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

# Provenance documents exempt from the historical-reference rules below.
usf_verify_exempt='GOAL.md
docs/historical-inventory.md
docs/v3-transition-record.md
provenance/reuse.json
scripts/verify-contained.sh'

set -- .
usf_verify_exempt_count=0
for usf_verify_file in $usf_verify_exempt
do
  # An exemption for a path this repository does not track is inert: there is
  # nothing to exempt, and a minimal or synthetic checkout is entitled to omit
  # every provenance document. A *tracked* exemption must justify itself.
  if ! git -C "$usf_verify_root" ls-files --error-unmatch -- "$usf_verify_file" >/dev/null 2>&1; then
    continue
  fi
  case "$usf_verify_file" in
    GOAL.md|scripts/verify-contained.sh) ;;
    *)
      if ! grep -q "$usf_verify_marker" "$usf_verify_root/$usf_verify_file"; then
        echo "Exempt file is not classified as a provenance document: $usf_verify_file" >&2
        exit 5
      fi
      ;;
  esac
  set -- "$@" ":!$usf_verify_file"
  usf_verify_exempt_count=$((usf_verify_exempt_count + 1))
done

# Historical repository roots, worktrees, recovery directories and removed
# system installations.
usf_verify_historical='/home/[A-Za-z0-9._-]+/src/bak|/home/[A-Za-z0-9._-]+/\.local/share/usf-|/home/[A-Za-z0-9._-]+/\.local/run/usf-|/var/lib/usf-|/opt/usf(-|/)|/opt/stardog|/usr/local/lib/usf-operator'
# V1/V2 executables.
usf_verify_executable='stardog-admin|usf-operator-maintenance-launcher|chroot_agent_launcher|factory_bau_recovery_executor'
# V1/V2 package and module imports.
usf_verify_import='(from|import)[[:space:]]+usf_(operator|graph|factory)|org\.eclipse\.rdf4j|org\.apache\.jena|com\.complexible\.stardog'
# Historical runtime state.
usf_verify_state='usf-operator/broker\.sock|/run/usf-|actions\.runner\.maldous-usf'
# Absolute development-machine paths. /home/provider is the confined launcher's
# declared sandbox home and is not a path on any development machine.
usf_verify_machine='/home/[A-Za-z0-9._-]+/|/Users/[A-Za-z0-9._-]+/'
usf_verify_machine_allowed='/home/provider'

usf_verify_fail() {
  echo "Tracked runtime-bearing content introduces a prohibited $1 dependency:" >&2
  printf '%s\n' "$2" >&2
  exit 5
}

for usf_verify_rule in historical executable import state
do
  eval "usf_verify_pattern=\$usf_verify_$usf_verify_rule"
  usf_verify_hits=$(git -C "$usf_verify_root" grep -n -I -E "$usf_verify_pattern" -- "$@" || true)
  if [ -n "$usf_verify_hits" ]; then
    usf_verify_fail "$usf_verify_rule" "$usf_verify_hits"
  fi
done

usf_verify_hits=$(git -C "$usf_verify_root" grep -n -I -E "$usf_verify_machine" -- "$@" \
  | grep -v -F "$usf_verify_machine_allowed" || true)
if [ -n "$usf_verify_hits" ]; then
  usf_verify_fail 'absolute development-machine path' "$usf_verify_hits"
fi

printf '%s\n' "{\"schema\":\"urn:usf:containment-check:1\",\"status\":\"pass\",\"runtimeRoot\":\".usf\",\"rules\":[\"runtime-root-contained\",\"env-never-tracked\",\"usf-never-tracked\",\"tracked-symlinks-contained\",\"historical\",\"executable\",\"import\",\"state\",\"absolute-development-machine-path\"],\"provenanceExemptions\":$usf_verify_exempt_count}"
