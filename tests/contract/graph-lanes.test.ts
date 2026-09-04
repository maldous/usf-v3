import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { graphLanesCommand } from "../../src/commands/graph-lanes.ts";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

test("the lane census projects every manifest-by-profile lane and names the live ones", async () => {
  const result = await graphLanesCommand(repositoryRoot, []);
  const output = result.output as Record<string, unknown>;
  assert.equal(output.schema, "urn:usf:lane-census-result:1");
  assert.equal(output.evaluated, true);

  const lanes = output.lanes as ReadonlyArray<Record<string, unknown>>;
  assert.ok(lanes.length > 0, "the corpus declares lanes");
  assert.equal(output.laneCount, lanes.length);

  // Policy coverage is the precondition that decides which lane can complete,
  // and that correspondence is the fact the census exists to state. The count
  // itself is not an invariant: every lane that declares its own disjoint
  // publication policy is covered by construction, so a legitimate new lane
  // moves it. Asserting a literal count here made the census a snapshot of one
  // afternoon and turned "someone opened a lane" into a contract failure.
  const live = lanes.filter((lane) => lane.live === true);
  assert.equal(live.length, output.policyCoveredLaneCount);
  assert.ok(live.length >= 1, "at least one lane is policy-covered");

  // The foundational provider lane must remain among them. That is the part
  // that would be a real regression if it disappeared.
  assert.ok(
    live.some((lane) => lane.manifest === "graph/manifests/self-host-provider-v3.json"
      && lane.profile === "urn:usf:profile:v3-self-host:3"),
    "the foundational provider lane is policy-covered",
  );

  // Every live lane is a real manifest-and-profile pair, not a partially
  // populated row that happens to carry the flag.
  for (const lane of live) {
    assert.match(String(lane.manifest), /^graph\/manifests\/[a-z0-9-]+\.json$/u);
    assert.match(String(lane.profile), /^urn:usf:profile:[a-z0-9-]+:[0-9]+$/u);
  }

  // Totals are the sum of the rows, so the summary cannot drift from the detail.
  const works = lanes.reduce((total, lane) => total + ((lane.policyCoverage as Record<string, number>).works ?? 0), 0);
  const atRisk = lanes.reduce((total, lane) => total + ((lane.policyCoverage as Record<string, number>).worksAtRisk ?? 0), 0);
  assert.equal(output.workSlotCount, works);
  assert.equal(output.workSlotsAtRisk, atRisk);
  assert.ok(atRisk < works, "the live lanes' works are not at risk");

  // The projection must say what it does not claim.
  const nonClaims = output.nonClaims as readonly string[];
  assert.ok(nonClaims.some((claim) => claim.includes("not a superseded lane")));
});

test("the lane census refuses an unknown argument rather than ignoring it", async () => {
  await assert.rejects(() => graphLanesCommand(repositoryRoot, ["--all"]),
    (error: unknown) => (error as { code?: string }).code === "GRAPH_LANES_ARGUMENTS_INVALID");
});
