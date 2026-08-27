import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  VELOCITY_APPEND_EXPECTATIONS,
  deriveVelocityInviteArtifacts,
  materializeVelocityInviteInputs,
  normalizePhone,
  parseCsv,
  planVelocityPromotions,
  serializeCsv,
  verifyPromotionApply,
  verifyPromotionTokenHmacs,
  verifyPromotionWrite,
  verifyPreservedInvites,
  verifyVelocityEntitlements,
  selectVelocityShortProbeUrl,
} from "./beauty-movement-velocity-invite-links.mjs";

const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const phone = (value) => `51${String(900000000 + value).slice(-9)}`;
const csv = (rows) => serializeCsv(["name", "whatsapp", "prize"], rows);

test("materializes the frozen 200/13/52 Velocity append using importer phone normalization", () => {
  const baseRows = Array.from({ length: 200 }, (_, index) => [
    `Base ${index + 1}`,
    index < 8 ? `(${phone(index).slice(0, 2)}) ${phone(index).slice(2)}` : phone(index),
    index < 5 ? "Velocity" : "other_prize",
  ]);
  const legacyRows = Array.from({ length: 13 }, (_, index) => [`Legacy ${index + 1}`, phone(300 + index), "Velocity"]);
  const velocityRows = [
    ...Array.from({ length: 8 }, (_, index) => [`Existing ${index + 1}`, `+55 ${phone(index)}`, "Velocity"]),
    ...Array.from({ length: 44 }, (_, index) => [`New ${index + 1}`, phone(500 + index), "Velocity"]),
  ];
  const baseCsv = csv(baseRows);
  const legacyCsv = csv(legacyRows);
  const velocityCsv = csv(velocityRows);
  const result = materializeVelocityInviteInputs({
    baseCsv,
    legacyCsv,
    velocityCsv,
    expectedBaseSha256: hash(baseCsv),
    expectedLegacySha256: hash(legacyCsv),
    expectedVelocitySha256: hash(velocityCsv),
  });

  assert.equal(normalizePhone(phone(1)), `+55${phone(1)}`);
  assert.equal(result.meta.baseRows, VELOCITY_APPEND_EXPECTATIONS.baseRows);
  assert.equal(result.meta.preservedExtraRows, VELOCITY_APPEND_EXPECTATIONS.preservedExtraRows);
  assert.equal(result.meta.velocityRows, VELOCITY_APPEND_EXPECTATIONS.velocityRows);
  assert.equal(result.meta.velocityBaseRows, VELOCITY_APPEND_EXPECTATIONS.velocityBaseRows);
  assert.equal(result.meta.velocityAppendRows, 44);
  assert.equal(result.meta.sourceOverlayRows, 65);
  assert.equal(result.meta.appendRows, VELOCITY_APPEND_EXPECTATIONS.appendRows);
  assert.equal(result.meta.combinedRows, VELOCITY_APPEND_EXPECTATIONS.combinedRows);

  const rows = (value) => parseCsv(value, "fixture").slice(1);
  const combinedRows = rows(result.canonical.combined);
  const deliveryRows = combinedRows.map((row, index) => [
    row[0],
    `fixture-ref-${index + 1}`,
    row[1],
    `https://espacofacial.com/BelezaEmMovimento#c=${"x".repeat(40)}${String(index).padStart(5, "0")}`,
  ]);
  const shortRows = deliveryRows.map((row, index) => [
    row[0], row[1], row[2], `https://esfa.co/${String(index).padStart(5, "0")}/BelezaEmMovimento`,
  ]);
  const derived = deriveVelocityInviteArtifacts({
    campaignId: "beauty-movement-fixture",
    sourceOverlayRows: rows(result.canonical.sourceOverlay),
    preservedRows: rows(result.canonical.preserved),
    velocityRows: rows(result.canonical.velocity),
    velocityAppendRows: rows(result.canonical.velocityAppend),
    existingRows: rows(result.canonical.velocityExisting),
    deliveryRows,
    shortRows,
  });
  assert.equal(derived.preservedTargets.refs.length, 13);
  assert.equal(derived.velocityAppendTargets.refs.length, 44);
  assert.match(derived.inviteRollbackSql, /\)=44/);
  assert.match(derived.inviteRollbackSql, /invite_status='revoked'/);
  assert.match(derived.inviteRollbackReadbackSql, /reveal_count/);
});

test("rejects a Velocity contact duplicated with the preserved overlay", () => {
  const baseRows = Array.from({ length: 200 }, (_, index) => [`Base ${index + 1}`, phone(index), "Velocity"]);
  const legacyRows = Array.from({ length: 13 }, (_, index) => [`Legacy ${index + 1}`, phone(300 + index), "Velocity"]);
  const velocityRows = [
    [`Duplicate`, `+55${phone(300)}`, "Velocity"],
    ...Array.from({ length: 51 }, (_, index) => [`New ${index + 1}`, phone(500 + index), "Velocity"]),
  ];
  const baseCsv = csv(baseRows);
  const legacyCsv = csv(legacyRows);
  const velocityCsv = csv(velocityRows);
  assert.throws(
    () => materializeVelocityInviteInputs({
      baseCsv,
      legacyCsv,
      velocityCsv,
      expectedBaseSha256: hash(baseCsv),
      expectedLegacySha256: hash(legacyCsv),
      expectedVelocitySha256: hash(velocityCsv),
    }),
    /duplicates_preserved_overlay/,
  );
});

test("parses quoted compact-sheet values without splitting a display name", () => {
  const rows = parseCsv('name,whatsapp,prize\n"Name, with comma",+5551999991234,Velocity\n', "fixture");
  assert.deepEqual(rows[1], ["Name, with comma", "+5551999991234", "Velocity"]);
});

test("selects a Velocity short-link probe from an ordinary unquoted CSV URL", () => {
  const rows = Array.from({ length: 52 }, (_, index) => [
    `Name ${index + 1}`,
    `ref-${index + 1}`,
    `+555199999${String(index).padStart(4, "0")}`,
    `https://esfa.co/${String(index).padStart(5, "0")}/BelezaEmMovimento`,
  ]);
  assert.equal(selectVelocityShortProbeUrl(rows), "https://esfa.co/00000/BelezaEmMovimento");
});

test("plans and verifies the guarded additive Velocity grant for existing commercial invitees", () => {
  const refs = Array.from({ length: 8 }, (_, index) => `velocity-fixture-${index + 1}`);
  const targets = {
    campaignId: "beauty-movement-fixture",
    refs,
    refHash: hash(refs.slice().sort().join("\n")),
  };
  const future = Date.now() + 60_000;
  const preRows = refs.map((external_ref, index) => ({
    external_ref,
    invite_status: "active",
    expires_at_ms: future,
    confirmed_at_ms: index === 5 ? 1_726_000_000_000 : null,
    velocity_benefit: index < 5 ? "aula_cortesia_evento" : "none",
    assigned_outcome_key: index < 5 ? null : "filler_double",
    assignment_protocol_version: index < 5 ? null : "beauty-movement-invite-assignments-v1",
    outcome_key: index === 5 ? "filler_double" : null,
  }));
  const { plan, updateSql, rollbackSql } = planVelocityPromotions({
    campaignId: targets.campaignId,
    targets,
    d1Payload: `Checking remote D1 output\n${JSON.stringify([{ results: preRows }])}`,
  });
  assert.equal(plan.alreadyCourtesyCount, 5);
  assert.equal(plan.promotionCount, 3);
  assert.equal(plan.operation, "apply");
  assert.match(updateSql, /velocity_benefit='aula_cortesia_evento'/);
  assert.match(updateSql, /assigned_outcome_key='filler_double'/);
  assert.match(updateSql, /assignment_protocol_version='beauty-movement-invite-assignments-v1'/);
  assert.match(updateSql, /confirmed_at_ms=1726000000000/);
  assert.match(updateSql, /confirmed_at_ms IS NULL/);
  assert.doesNotMatch(updateSql, /assigned_outcome_key IS NOT NULL/);
  assert.match(rollbackSql, /SET velocity_benefit='none'/);
  assert.deepEqual(
    verifyPromotionWrite({ plan, d1Payload: `Checking remote D1 output\n${JSON.stringify([{ meta: { changes: 3 } }])}` }),
    { operation: "apply", promotionCount: 3 },
  );

  const finalRows = preRows.map((row) => ({ ...row, velocity_benefit: "aula_cortesia_evento" }));
  assert.deepEqual(
    verifyPromotionApply({ targets, plan, d1Payload: JSON.stringify([{ results: finalRows }]) }),
    { operation: "apply", targetCount: 8, promotionCount: 3 },
  );
  const tokenRows = preRows.map((row, index) => ({ ...row, invite_token_hmac: `${index.toString(16)}${"a".repeat(63)}` }));
  const attestation = {
    campaignId: targets.campaignId,
    inviteTokenHmacByRef: Object.fromEntries(tokenRows.map((row) => [row.external_ref, row.invite_token_hmac])),
  };
  assert.deepEqual(
    verifyPromotionTokenHmacs({ targets, d1Payload: JSON.stringify([{ results: tokenRows }]), deliveryAttestation: attestation }),
    { targetCount: 8, tokenHmacMatch: true },
  );
  tokenRows[0].invite_token_hmac = "b".repeat(64);
  assert.throws(
    () => verifyPromotionTokenHmacs({ targets, d1Payload: JSON.stringify([{ results: tokenRows }]), deliveryAttestation: attestation }),
    /promotion_token_hmac_mismatch/,
  );
  const fullTargets = { ...targets, refs: Array.from({ length: 52 }, (_, index) => `velocity-target-${index + 1}`) };
  fullTargets.refHash = hash(fullTargets.refs.slice().sort().join("\n"));
  const fullRows = fullTargets.refs.map((external_ref) => ({
    external_ref,
    invite_status: "active",
    expires_at_ms: future,
    velocity_benefit: "aula_cortesia_evento",
  }));
  assert.deepEqual(
    verifyVelocityEntitlements({ targets: fullTargets, d1Payload: JSON.stringify([{ results: fullRows }]) }),
    { targetCount: 52 },
  );
});

test("rejects a first-pass state that omits a preserved Velocity invite", () => {
  const refs = Array.from({ length: 13 }, (_, index) => `preserved-${index + 1}`);
  const targets = { campaignId: "beauty-movement-preserved", refs, refHash: hash(refs.slice().sort().join("\n")) };
  const future = Date.now() + 60_000;
  const rows = refs.slice(1).map((external_ref) => ({ external_ref, invite_status: "active", expires_at_ms: future }));
  assert.throws(
    () => verifyPreservedInvites({ targets, d1Payload: JSON.stringify([{ results: rows }]) }),
    /preserved_pre_readback_scope_invalid/,
  );
});

test("reconciles a prior completed Velocity grant without a second promotion write", () => {
  const refs = Array.from({ length: 8 }, (_, index) => `velocity-resume-${index + 1}`);
  const targets = {
    campaignId: "beauty-movement-resume",
    refs,
    refHash: hash(refs.slice().sort().join("\n")),
  };
  const future = Date.now() + 60_000;
  const rows = refs.map((external_ref, index) => ({
    external_ref,
    invite_status: "active",
    expires_at_ms: future,
    confirmed_at_ms: null,
    velocity_benefit: "aula_cortesia_evento",
    assigned_outcome_key: index < 5 ? null : "filler_double",
    assignment_protocol_version: index < 5 ? null : "beauty-movement-invite-assignments-v1",
    outcome_key: null,
  }));
  const { plan, updateSql, rollbackSql } = planVelocityPromotions({
    campaignId: targets.campaignId,
    targets,
    d1Payload: JSON.stringify([{ results: rows }]),
  });
  assert.equal(plan.operation, "reconciled");
  assert.equal(plan.promotionCount, 0);
  assert.equal(updateSql, "SELECT 0 AS no_changes;\n");
  assert.match(rollbackSql, /SET velocity_benefit='none'/);
  assert.deepEqual(
    verifyPromotionWrite({ plan, d1Payload: JSON.stringify([{ meta: { changes: 0 } }]) }),
    { operation: "reconciled", promotionCount: 0 },
  );
  assert.deepEqual(
    verifyPromotionApply({ targets, plan, d1Payload: JSON.stringify([{ results: rows }]) }),
    { operation: "reconciled", targetCount: 8, promotionCount: 0 },
  );
});
