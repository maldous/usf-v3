import assert from "node:assert/strict";
import test from "node:test";

import * as capability from "../../../src/capabilities/developerplatform/webhooksdeveloperfacing.ts";

type State = capability.WebhookState;
type Actor = capability.WebhookActor;
type Metadata = capability.WebhookAuditMetadata;

function okAudit(_m: Metadata): capability.WebhookResult<void> {
  return { _type: "success", value: undefined };
}

function failAudit(_m: Metadata): capability.WebhookResult<void> {
  return { _type: "error", kind: "AUDIT_FAILURE", message: "audit denied" };
}

function actorWith(perm: boolean, org = "org-1"): Actor {
  return { organizationId: org, actor: "user-1", hasTenantWebhooksPermission: perm };
}

function seedState(overrides: Partial<State> = {}): State {
  return {
    subscriptions: [],
    deliveries: [],
    adapterAvailable: true,
    workerAvailable: true,
    ...overrides,
  };
}

test("webhooksdeveloperfacingauditmodel", () => {
  const state = seedState();
  const actor = actorWith(true);

  // createSubscription must audit with CREATE_SUBSCRIPTION only; no signing secret in metadata
  let observed: Metadata | null = null;
  const auditCapture = (m: Metadata): capability.WebhookResult<void> => {
    observed = m;
    return okAudit(m);
  };
  const create = capability.createSubscription(
    state, actor, "https://example.test/hook", ["order.created"], "sub-1",
    "hash-abc", "reveal-once-xyz", auditCapture
  );
  assert.equal(create._type, "success");
  if (create._type === "success") {
    assert.equal(observed!.kind, "CREATE_SUBSCRIPTION");
    assert.equal((observed as any).secret, undefined);
    assert.equal((observed as any).secretHash, undefined);
    assert.equal((observed as any).revealOnceSecret, undefined);
    // plaintext secret must not appear in subscription record returned
    const sub = create.value.result.subscription;
    assert.equal((sub as any).revealOnceSecret, undefined);
  }

  // rotateSecret must audit with ROTATE_SECRET only; no signing secret in metadata
  const afterCreate = (create._type === "success" ? create.value.state : state);
  let observed2: Metadata | null = null;
  const auditCapture2 = (m: Metadata): capability.WebhookResult<void> => {
    observed2 = m;
    return okAudit(m);
  };
  const rotate = capability.rotateSecret(
    afterCreate, actor, "sub-1", "hash-def", "reveal-once-rot", auditCapture2
  );
  assert.equal(rotate._type, "success");
  assert.equal(observed2!.kind, "ROTATE_SECRET");
  assert.equal((observed2 as any).secret, undefined);
  assert.equal((observed2 as any).revealOnceSecret, undefined);

  // redrive is audit-first: audit runs before state mutation; failure aborts
  const withDelivery: State = {
    ...(rotate._type === "success" ? rotate.value.state : afterCreate),
    deliveries: [{
      identifier: "del-1", organizationId: "org-1", subscriptionId: "sub-1",
      eventType: "order.created", payload: "{}", status: "DEAD",
      attemptCount: 5, nextAttemptTime: 0, lastStatus: 500,
      idempotencyKey: "old-key"
    }],
  };
  const deniedRedrive = capability.redriveDelivery(
    withDelivery, actor, "del-1", "new-key", 1000, failAudit
  );
  assert.equal(deniedRedrive._type, "error");
  assert.equal(deniedRedrive.kind, "AUDIT_FAILURE");
  // delivery unchanged after failed audit
  assert.equal(withDelivery.deliveries[0]!.idempotencyKey, "old-key");
  assert.equal(withDelivery.deliveries[0]!.status, "DEAD");

  // redriveAllDeadDeliveries also audits before mutating
  const deniedAll = capability.redriveAllDeadDeliveries(
    withDelivery, actor, 2000, () => "k", failAudit
  );
  assert.equal(deniedAll._type, "error");
  assert.equal(deniedAll.kind, "AUDIT_FAILURE");

  // metrics surface must never carry the plaintext secret
  const metrics = capability.getDeliveryMetrics(withDelivery, actor, "sub-1");
  assert.equal(metrics._type, "success");
  if (metrics._type === "success") {
    assert.equal((metrics.value as any).secret, undefined);
    assert.equal((metrics.value as any).secretHash, undefined);
  }
});

test("webhooksdeveloperfacingcontracts", () => {
  const actor = actorWith(true);
  let state = seedState();

  // create
  const c = capability.createSubscription(
    state, actor, "https://example.test/h", ["e1"], "sub-A",
    "h1", "reveal-1", okAudit
  );
  assert.equal(c._type, "success");
  state = c._type === "success" ? c.value.state : state;

  // list (redacted)
  const list = capability.listSubscriptions(state, actor);
  assert.equal(list._type, "success");
  if (list._type === "success") {
    assert.equal(list.value.length, 1);
    assert.equal((list.value[0] as any).secretHash, undefined);
  }

  // update
  const u = capability.updateSubscription(state, actor, "sub-A", ["e1", "e2"], false);
  assert.equal(u._type, "success");

  // delete
  const d = capability.deleteSubscription(u._type === "success" ? u.value : state, actor, "sub-A");
  assert.equal(d._type, "success");

  // readiness query
  const r = capability.queryReadiness(d._type === "success" ? d.value : state, actor);
  assert.equal(r._type, "success");
  assert.equal(r._type === "success" && r.value, "NO_SUBSCRIPTIONS");

  // delivery list + metrics require an existing subscription
  const c2 = capability.createSubscription(
    state, actor, "https://example.test/h2", ["e1"], "sub-B",
    "h2", "reveal-2", okAudit
  );
  const state2 = c2._type === "success" ? c2.value.state : state;

  const fan = capability.fanOutEvent(state2, "e1", "{}", "org-1", "idem-1", 0, () => "del-1");
  const state3 = fan._type === "success" ? fan.value : state2;

  const lds = capability.listDeliveries(state3, actor, "sub-B");
  assert.equal(lds._type, "success");
  if (lds._type === "success") assert.equal(lds.value.length, 1);

  const mtr = capability.getDeliveryMetrics(state3, actor, "sub-B");
  assert.equal(mtr._type, "success");
  if (mtr._type === "success") {
    assert.equal(mtr.value.pendingCount, 1);
  }

  // rotate
  const rot = capability.rotateSecret(state3, actor, "sub-B", "h3", "reveal-3", okAudit);
  assert.equal(rot._type, "success");

  // test delivery
  const td = capability.testDelivery(state3, actor, { subscriptionId: "sub-B", payload: "{}" }, () => "del-T", 0);
  assert.equal(td._type, "success");
  if (td._type === "success") {
    assert.equal(td.value.delivery.eventType, "test");
  }
});

test("webhooksdeveloperfacingerrormodel", () => {
  const actor = actorWith(true);

  // unknown subscription -> not-found with null/zero metrics
  const s0 = seedState();
  const lm = capability.getDeliveryMetrics(s0, actor, "missing");
  assert.equal(lm._type, "error");
  assert.equal(lm._type === "error" && lm.kind, "NOT_FOUND");
  const ld = capability.listDeliveries(s0, actor, "missing");
  assert.equal(ld._type, "error");
  assert.equal(ld._type === "error" && ld.kind, "NOT_FOUND");

  // no enabled subscriptions -> no-subscriptions
  const nf = capability.fanOutEvent(s0, "evt", "{}", "org-1", "k", 0, () => "d");
  assert.equal(nf._type, "error");
  assert.equal(nf._type === "error" && nf.kind, "NO_SUBSCRIPTIONS");

  // bounded attempts move a delivery to DEAD
  let s = seedState();
  const c = capability.createSubscription(s, actor, "https://x.test", ["e"], "sub-1", "h", "r", okAudit);
  s = c._type === "success" ? c.value.state : s;
  const fo = capability.fanOutEvent(s, "e", "{}", "org-1", "k", 0, () => "del-x");
  s = fo._type === "success" ? fo.value : s;
  // max attempts 3
  let cur: State = s;
  cur = capability.processDeliveryResponse(cur, "del-x", 500, 10, 3, 1);
  cur = capability.processDeliveryResponse(cur, "del-x", 500, 20, 3, 1);
  cur = capability.processDeliveryResponse(cur, "del-x", 500, 30, 3, 1);
  const dlv = cur.deliveries.find(d => d.identifier === "del-x");
  assert.equal(dlv!.status, "DEAD");
  assert.equal(dlv!.attemptCount, 3);

  // dead deliveries report has-dead-deliveries
  const rdy = capability.queryReadiness(cur, actor);
  assert.equal(rdy._type, "success");
  assert.equal(rdy._type === "success" && rdy.value, "HAS_DEAD_DELIVERIES");

  // unavailable seeded organisation is skipped: adapter/worker off -> UNAVAILABLE
  const off = seedState({ adapterAvailable: false, workerAvailable: false });
  const cOff = capability.createSubscription(off, actor, "u", ["e"], "sub", "h", "r", okAudit);
  assert.equal(cOff._type, "error");
  assert.equal(cOff._type === "error" && cOff.kind, "UNAVAILABLE");
  // readiness still readable when adapter/worker down
  const rOff = capability.queryReadiness(off, actor);
  assert.equal(rOff._type, "success");
});

test("webhooksdeveloperfacinglifecycle", () => {
  const actor = actorWith(true);
  let s = seedState();

  // create with reveal-once
  const c = capability.createSubscription(s, actor, "https://x.test", ["e"], "sub-1", "hash1", "REVEAL_ONCE", okAudit);
  s = c._type === "success" ? c.value.state : s;
  assert.equal(c._type === "success" && c.value.result.revealOnceSecret, "REVEAL_ONCE");

  // list redacted
  const l = capability.listSubscriptions(s, actor);
  if (l._type === "success") {
    assert.equal((l.value[0] as any).secretHash, undefined);
  }

  // signed test dispatch (test delivery exists as contract)
  const t = capability.testDelivery(s, actor, { subscriptionId: "sub-1", payload: "{}" }, () => "td-1", 0);
  assert.equal(t._type, "success");

  // fan out to enabled subscriptions
  const fo = capability.fanOutEvent(s, "e", "{}", "org-1", "idem-A", 0, () => "del-1");
  s = fo._type === "success" ? fo.value : s;
  assert.equal(fo._type === "success" && fo.value.deliveries.some(d => d.identifier === "del-1"), true);

  // retry with bounded backoff (2xx -> DELIVERED; 5xx -> FAILED with exponential backoff)
  s = capability.processDeliveryResponse(s, "del-1", 500, 100, 5, 1);
  const after1 = s.deliveries.find(d => d.identifier === "del-1")!;
  assert.equal(after1.status, "FAILED");
  assert.equal(after1.attemptCount, 1);
  assert.equal(after1.nextAttemptTime, 100 + 1 * Math.pow(2, 0));

  // dead-letter after maximum attempts
  let cur = s;
  for (let i = 0; i < 4; i++) cur = capability.processDeliveryResponse(cur, "del-1", 500, 1000 + i, 5, 1);
  const afterDead = cur.deliveries.find(d => d.identifier === "del-1")!;
  assert.equal(afterDead.status, "DEAD");

  // redrive dead with fresh idempotency key
  const rd = capability.redriveDelivery(cur, actor, "del-1", "idem-FRESH", 5000, okAudit);
  assert.equal(rd._type, "success");
  if (rd._type === "success") {
    const revived = rd.value.deliveries.find(d => d.identifier === "del-1")!;
    assert.equal(revived.status, "PENDING");
    assert.equal(revived.attemptCount, 0);
    assert.equal(revived.idempotencyKey, "idem-FRESH");
  }

  // delete with cleanup
  const del = capability.deleteSubscription(cur, actor, "sub-1");
  assert.equal(del._type, "success");
  if (del._type === "success") {
    assert.equal(del.value.subscriptions.length, 0);
    assert.equal(del.value.deliveries.length, 0);
  }
});

test("webhooksdeveloperfacingpermissions", () => {
  // tenant webhooks permission required
  const noPerm = actorWith(false);
  const s = seedState();
  const c = capability.createSubscription(s, noPerm, "u", ["e"], "sub", "h", "r", okAudit);
  assert.equal(c._type, "error");
  assert.equal(c._type === "error" && c.kind, "UNAUTHORIZED");

  const l = capability.listSubscriptions(s, noPerm);
  assert.equal(l._type, "error");
  assert.equal(l._type === "error" && l.kind, "UNAUTHORIZED");

  // scoped to requesting organisation
  const actor = actorWith(true, "org-1");
  const other = actorWith(true, "org-2");
  const c1 = capability.createSubscription(s, actor, "https://a", ["e"], "sub-1", "h", "r", okAudit);
  const s1 = c1._type === "success" ? c1.value.state : s;
  // other tenant must not see org-1's subscription in list
  const lOther = capability.listSubscriptions(s1, other);
  assert.equal(lOther._type, "success");
  if (lOther._type === "success") assert.equal(lOther.value.length, 0);

  // redrive and test require tenant context (same permission)
  const c2 = capability.createSubscription(s, actor, "https://a", ["e"], "sub-2", "h", "r", okAudit);
  const s2 = c2._type === "success" ? c2.value.state : s;
  const fo = capability.fanOutEvent(s2, "e", "{}", "org-1", "k", 0, () => "del-1");
  const s3 = fo._type === "success" ? fo.value : s2;
  const dead = capability.processDeliveryResponse(
    capability.processDeliveryResponse(s3, "del-1", 500, 0, 2, 1),
    "del-1", 500, 1, 2, 1
  );
  // other tenant must not redrive
  const rdOther = capability.redriveDelivery(dead, other, "del-1", "k2", 5, okAudit);
  assert.equal(rdOther._type, "error");
  assert.equal(rdOther._type === "error" && rdOther.kind, "NOT_FOUND");
  // other tenant must not run test delivery
  const tdOther = capability.testDelivery(s2, other, { subscriptionId: "sub-2", payload: "{}" }, () => "x", 0);
  assert.equal(tdOther._type, "error");
  assert.equal(tdOther._type === "error" && tdOther.kind, "NOT_FOUND");
});

test("webhooksdeveloperfacingproof", () => {
  // Hermetic runtime lineage proof: exercise the full chain using only module exports.
  const actor = actorWith(true);
  const base = seedState();

  const c = capability.createSubscription(base, actor, "https://x.test", ["e"], "sub", "h1", "R", okAudit);
  const s1 = c._type === "success" ? c.value.state : base;

  const t = capability.testDelivery(s1, actor, { subscriptionId: "sub", payload: "{}" }, () => "del-test", 0);
  const s2 = t._type === "success" ? t.value.state : s1;

  const fo = capability.fanOutEvent(s2, "e", "{}", "org-1", "idem", 0, () => "del-fan");
  const s3 = fo._type === "success" ? fo.value : s2;

  let s4 = s3;
  s4 = capability.processDeliveryResponse(s4, "del-fan", 500, 1, 3, 1);
  s4 = capability.processDeliveryResponse(s4, "del-fan", 500, 2, 3, 1);
  s4 = capability.processDeliveryResponse(s4, "del-fan", 500, 3, 3, 1);
  const dead = s4.deliveries.find(d => d.identifier === "del-fan")!;
  assert.equal(dead.status, "DEAD");

  const m = capability.getDeliveryMetrics(s4, actor, "sub");
  assert.equal(m._type, "success");
  if (m._type === "success") {
    assert.equal(m.value.deadCount, 1);
  }

  const rd = capability.redriveDelivery(s4, actor, "del-fan", "idem-2", 99, okAudit);
  assert.equal(rd._type, "success");
});

test("webhooksdeveloperfacingreadinessmodel", () => {
  const actor = actorWith(true);

  // no subscriptions
  const r0 = capability.queryReadiness(seedState(), actor);
  assert.equal(r0._type, "success");
  assert.equal(r0._type === "success" && r0.value, "NO_SUBSCRIPTIONS");

  // configured
  const c = capability.createSubscription(seedState(), actor, "u", ["e"], "sub", "h", "r", okAudit);
  const s1 = c._type === "success" ? c.value.state : seedState();
  const r1 = capability.queryReadiness(s1, actor);
  assert.equal(r1._type === "success" && r1.value, "CONFIGURED");

  // has-dead-deliveries
  const fo = capability.fanOutEvent(s1, "e", "{}", "org-1", "k", 0, () => "d");
  const s2 = fo._type === "success" ? fo.value : s1;
  const dead = capability.processDeliveryResponse(
    capability.processDeliveryResponse(
      capability.processDeliveryResponse(s2, "d", 500, 0, 2, 1),
      "d", 500, 1, 2, 1),
    "d", 500, 2, 2, 1);
  const r2 = capability.queryReadiness(dead, actor);
  assert.equal(r2._type === "success" && r2.value, "HAS_DEAD_DELIVERIES");

  // worker/adapter unavailable: mutation paths disabled, read-only readiness still visible
  const off = seedState({ adapterAvailable: false, workerAvailable: false });
  const cOff = capability.createSubscription(off, actor, "u", ["e"], "sub", "h", "r", okAudit);
  assert.equal(cOff._type, "error");
  assert.equal(cOff._type === "error" && cOff.kind, "UNAVAILABLE");
  const rOff = capability.queryReadiness(off, actor);
  assert.equal(rOff._type, "success");
});

test("webhooksdeveloperfacingstatemodel", () => {
  const actor = actorWith(true);
  const s0 = seedState();

  const c = capability.createSubscription(s0, actor, "https://x.test", ["e1", "e2"], "sub-1", "hash-only", "reveal", okAudit);
  assert.equal(c._type, "success");
  if (c._type === "success") {
    const sub = c.value.result.subscription;
    assert.equal(sub.identifier, "sub-1");
    assert.equal(sub.url, "https://x.test");
    assert.deepEqual([...sub.eventTypes], ["e1", "e2"]);
    assert.equal(sub.enabled, true);
    // only secret hash is stored, not plaintext
    assert.equal(sub.secretHash, "hash-only");
    assert.equal((sub as any).secret, undefined);
    assert.equal((sub as any).revealOnceSecret, undefined);
  }

  const s1 = c._type === "success" ? c.value.state : s0;
  const fo = capability.fanOutEvent(s1, "e1", "{}", "org-1", "idem", 0, () => "del-1");
  const s2 = fo._type === "success" ? fo.value : s1;
  const pending = s2.deliveries.find(d => d.identifier === "del-1")!;
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.attemptCount, 0);
  assert.equal(pending.lastStatus, null);

  // delivered
  const s3 = capability.processDeliveryResponse(s2, "del-1", 204, 5, 3, 1);
  assert.equal(s3.deliveries.find(d => d.identifier === "del-1")!.status, "DELIVERED");

  // failed with attempt count + next-attempt time
  const s4 = capability.processDeliveryResponse(s2, "del-1", 500, 5, 3, 1);
  const failed = s4.deliveries.find(d => d.identifier === "del-1")!;
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.attemptCount, 1);
  assert.equal(failed.lastStatus, 500);
  assert.equal(failed.nextAttemptTime, 5 + Math.pow(2, 0));

  // redrive-pending reset: status PENDING, attemptCount 0
  const s5 = capability.processDeliveryResponse(
    capability.processDeliveryResponse(s2, "del-1", 500, 1, 2, 1),
    "del-1", 500, 2, 2, 1);
  const rd = capability.redriveDelivery(s5, actor, "del-1", "new-k", 100, okAudit);
  assert.equal(rd._type, "success");
  if (rd._type === "success") {
    const revived = rd.value.deliveries.find(d => d.identifier === "del-1")!;
    assert.equal(revived.status, "PENDING");
    assert.equal(revived.attemptCount, 0);
  }
});

test("webhooksdeveloperfacingvalidation", () => {
  const actor = actorWith(true);

  // secret revealed once, never appears in payload / list / audit / metrics
  let observed: Metadata | null = null;
  const c = capability.createSubscription(
    seedState(), actor, "https://x.test", ["e"], "sub", "hash-only", "PLAINTEXT-SECRET",
    (m) => { observed = m; return okAudit(m); }
  );
  assert.equal(c._type, "success");
  if (c._type === "success") {
    assert.equal(c.value.result.subscription.secretHash, "hash-only");
    assert.equal((c.value.result.subscription as any).revealOnceSecret, undefined);
    assert.equal((c.value.result as any).payload, undefined);
  }
  assert.equal((observed as any).secret, undefined);
  assert.equal((observed as any).revealOnceSecret, undefined);

  const s1 = c._type === "success" ? c.value.state : seedState();
  const l = capability.listSubscriptions(s1, actor);
  if (l._type === "success") {
    assert.equal((l.value[0] as any).secretHash, undefined);
    assert.equal((l.value[0] as any).secret, undefined);
  }
  const m = capability.getDeliveryMetrics(s1, actor, "sub");
  if (m._type === "success") {
    assert.equal((m.value as any).secret, undefined);
    assert.equal((m.value as any).secretHash, undefined);
  }

  // only enabled event types are fanned out
  const u = capability.updateSubscription(s1, actor, "sub", ["other"], true);
  const s2 = u._type === "success" ? u.value : s1;
  const foOff = capability.fanOutEvent(s2, "e", "{}", "org-1", "k", 0, () => "d");
  assert.equal(foOff._type, "error");
  assert.equal(foOff._type === "error" && foOff.kind, "NO_SUBSCRIPTIONS");

  // disabled subscriptions not fanned out
  const u2 = capability.updateSubscription(s1, actor, "sub", ["e"], false);
  const s3 = u2._type === "success" ? u2.value : s1;
  const foDisabled = capability.fanOutEvent(s3, "e", "{}", "org-1", "k", 0, () => "d");
  assert.equal(foDisabled._type, "error");
  assert.equal(foDisabled._type === "error" && foDisabled.kind, "NO_SUBSCRIPTIONS");

  // retries scheduled, dead-letter after max attempts, redrive of dead is idempotent
  const u3 = capability.updateSubscription(s1, actor, "sub", ["e"], true);
  const s4 = u3._type === "success" ? u3.value : s1;
  const fo2 = capability.fanOutEvent(s4, "e", "{}", "org-1", "idem", 0, () => "del-1");
  const s5 = fo2._type === "success" ? fo2.value : s4;
  let cur = s5;
  cur = capability.processDeliveryResponse(cur, "del-1", 500, 1, 3, 1);
  assert.equal(cur.deliveries.find(d => d.identifier === "del-1")!.status, "FAILED");
  cur = capability.processDeliveryResponse(cur, "del-1", 500, 2, 3, 1);
  cur = capability.processDeliveryResponse(cur, "del-1", 500, 3, 3, 1);
  assert.equal(cur.deliveries.find(d => d.identifier === "del-1")!.status, "DEAD");

  // redrive produces PENDING; calling again with new key still works (idempotent redrive path)
  const rd1 = capability.redriveDelivery(cur, actor, "del-1", "k-A", 50, okAudit);
  assert.equal(rd1._type, "success");
  const rd2 = capability.redriveDelivery(rd1._type === "success" ? rd1.value : cur, actor, "del-1", "k-B", 60, okAudit);
  assert.equal(rd2._type, "success");
  if (rd2._type === "success") {
    assert.equal(rd2.value.deliveries.find(d => d.identifier === "del-1")!.status, "PENDING");
    assert.equal(rd2.value.deliveries.find(d => d.identifier === "del-1")!.idempotencyKey, "k-B");
  }

  // deleted subscriptions are handled (subsequent fan-out returns NO_SUBSCRIPTIONS)
  const del = capability.deleteSubscription(cur, actor, "sub");
  const s6 = del._type === "success" ? del.value : cur;
  const foAfterDelete = capability.fanOutEvent(s6, "e", "{}", "org-1", "k", 0, () => "d");
  assert.equal(foAfterDelete._type, "error");
  assert.equal(foAfterDelete._type === "error" && foAfterDelete.kind, "NO_SUBSCRIPTIONS");
});