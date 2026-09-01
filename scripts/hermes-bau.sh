#!/bin/bash
# External overnight driver. Hermes carries no monitoring semantics; this loop is
# outside USF and only records machine-readable status for the supervising agent.
cd /home/user/src/usf-v3
unset FORCE_COLOR NO_COLOR
STATUS=.usf/hermes/bau-status.json
ENV=.usf/credentials/providers.env
for cycle in $(seq 1 100000); do
  OUT=$(timeout 1500 node --experimental-strip-types src/cli.ts hermes realise --apply --env-file "$ENV" 2>/dev/null)
  [ -z "$OUT" ] && { sleep 30; continue; }
  echo "$OUT" > .usf/hermes/last-realise.json
  REALIZED=$(python3 -c "import json,sys;print(json.load(open('.usf/hermes/last-realise.json'))['realizedCount'])" 2>/dev/null || echo 0)
  if [ "$REALIZED" -gt 0 ] && [ -f .usf/proposals/delivery-realisation.json ]; then
    timeout 600 node --experimental-strip-types src/cli.ts transact --proposal .usf/proposals/delivery-realisation.json \
      > .usf/hermes/last-transact.json 2>&1 || true
  fi
  python3 - "$cycle" <<'PY'
import json,sys,os,datetime
cycle=int(sys.argv[1])
try: r=json.load(open('.usf/hermes/last-realise.json'))
except Exception: r={}
try: t=json.load(open('.usf/hermes/last-transact.json'))
except Exception: t={}
st={"schema":"urn:usf:hermes-overnight-status:1","cycle":cycle,
 "observedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),
 "capabilities":r.get("capabilityCount"),"artefactWork":r.get("artefactWorkCount"),
 "satisfiedArtefacts":r.get("alreadySatisfiedCount"),"readyFrontier":r.get("readyFrontier"),
 "deterministic":r.get("deterministicCount"),"modelOrExternal":r.get("semanticModelCount"),
 "realizedThisCycle":r.get("realizedCount"),"modelDispatch":r.get("modelDispatch"),
 "facets":(r.get("facets") or {}).get("stateCounts"),
 "capabilitiesFullySatisfied":(r.get("facets") or {}).get("capabilitiesFullySatisfied"),
 "cache":r.get("cache"),
 "lastTransaction":t.get("transactionDigest") or t.get("reasonCode"),
 "transactionPaths":len(t.get("derivedAffectedPaths") or [])}
json.dump(st,open('.usf/hermes/bau-status.json','w'),indent=1)
print(f"cycle {cycle}: realized={st['realizedThisCycle']} frontier={st['readyFrontier']} facets={st['facets']}")
PY
  if [ "$REALIZED" -eq 0 ]; then
    echo "no progress at cycle $cycle; frontier consumed" >> .usf/hermes/bau.log
    sleep 300
  fi
done
