import assert from "node:assert/strict";
import test from "node:test";
import { buildSourceObservation, verifySourceObservation } from "../token-vault-native-observe.mjs";

const identity = { sourceSha: "a".repeat(40), sourceTree: "b".repeat(40),
  releaseInputDigest: "c".repeat(64), dependencyClosureDigest: "d".repeat(64) };
const now = Date.parse("2026-09-30T13:00:00.000Z");

test("fresh main observation binds source tree, input digest and closure", () => {
  const observation = buildSourceObservation({ ...identity, selectedClosureDigest: identity.dependencyClosureDigest,
    observedMainSha: "e".repeat(40), observedMainClosureDigest: identity.dependencyClosureDigest,
    observedAt: new Date(now).toISOString(), nonce: "f".repeat(48) });
  assert.equal(verifySourceObservation(observation, identity, { now }).observedMainSha, "e".repeat(40));
  assert.throws(() => verifySourceObservation({ ...observation, observedMainSha: "a".repeat(40) }, identity, { now }), /digest is invalid/);
  assert.throws(() => verifySourceObservation(observation, identity, { now: now + 61_000 }), /stale/);
  assert.throws(() => verifySourceObservation(observation, { ...identity, dependencyClosureDigest: "0".repeat(64) }, { now }), /changed release dependency closure/);
});
