import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { graphLanesCommand } from "../../src/commands/graph-lanes.ts";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

test("the lane census projects every manifest-by-profile lane and names the live one", async () => {
  const result = await graphLanesCommand(repositoryRoot, []);
  const output = result.output as Record<string, unknown>;
  assert.equal(output.schema, "urn:usf:lane-census-result:1");
  assert.equal(output.evaluated, true);

  const lanes = output.lanes as ReadonlyArray<Record<string, unknown>>;
  assert.ok(lanes.length > 0, "the corpus declares lanes");
  assert.equal(output.laneCount, lanes.length);

  // Policy coverage is the precondition that decides which lane can complete.
  // Exactly one lane is covered; that is the fact the census exists to state.
  const live = lanes.filter((lane) => lane.live === true);
  assert.equal(live.length, output.policyCoveredLaneCount);
  assert.equal(live.length, 1, "one live lane");
  assert.equal(live[0]!.manifest, "graph/manifests/self-host-provider-v3.json");
  assert.equal(live[0]!.profile, "urn:usf:profile:v3-self-host:3");

  // Totals are the sum of the rows, so the summary cannot drift from the detail.
  const works = lanes.reduce((total, lane) => total + ((lane.policyCoverage as Record<string, number>).works ?? 0), 0);
  const atRisk = lanes.reduce((total, lane) => total + ((lane.policyCoverage as Record<string, number>).worksAtRisk ?? 0), 0);
  assert.equal(output.workSlotCount, works);
  assert.equal(output.workSlotsAtRisk, atRisk);
  assert.ok(atRisk < works, "the live lane's works are not at risk");

  // The projection must say what it does not claim.
  const nonClaims = output.nonClaims as readonly string[];
  assert.ok(nonClaims.some((claim) => claim.includes("not a superseded lane")));
});

test("the lane census refuses an unknown argument rather than ignoring it", async () => {
  await assert.rejects(() => graphLanesCommand(repositoryRoot, ["--all"]),
    (error: unknown) => (error as { code?: string }).code === "GRAPH_LANES_ARGUMENTS_INVALID");
});
