import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VELOCITY_APPEND_EXPECTATIONS = Object.freeze({
  baseRows: 200,
  preservedExtraRows: 13,
  velocityRows: 52,
  velocityBaseRows: 8,
  velocityLegacyRows: 0,
  appendRows: 57,
  combinedRows: 257,
  promotionRows: 3,
  alreadyCourtesyRows: 5,
});

const INPUT_HEADER = ["name", "whatsapp", "prize"];
const DELIVERY_HEADER = ["name", "invite_ref", "whatsapp", "invite_url"];
const CAMPAIGN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const VELOCITY_BENEFIT = "aula_cortesia_evento";
const ASSIGNMENT_PROTOCOL_VERSION = "beauty-movement-invite-assignments-v1";

function fail(code) {
  throw new Error(`beauty_movement_velocity_${code}`);
}

export function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (digits.length >= 12 && digits.length <= 15) return `+${digits}`;
  return "";
}

export function parseCsv(value, label) {
  const source = String(value ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let afterQuote = false;

  const finishCell = () => {
    row.push(cell.trim());
    cell = "";
    afterQuote = false;
  };
  const finishRow = () => {
    finishCell();
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        cell += char;
      }
      continue;
    }

    if (afterQuote && char !== "," && char !== "\n" && char !== "\r") fail(`${label}_invalid_csv`);
    if (char === '"') {
      if (cell.length > 0) fail(`${label}_invalid_csv`);
      quoted = true;
    } else if (char === ",") {
      finishCell();
    } else if (char === "\n") {
      finishRow();
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (quoted) fail(`${label}_invalid_csv`);
  if (cell.length > 0 || row.length > 0) finishRow();
  if (rows.length < 2) fail(`${label}_empty`);
  return rows;
}

export function serializeCsv(header, rows) {
  const cell = (value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `${[header, ...rows].map((row) => row.map(cell).join(",")).join("\n")}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseInput(value, label) {
  const rows = parseCsv(value, label);
  const header = rows.shift().map((cell) => cell.toLowerCase());
  if (header.join(",") !== INPUT_HEADER.join(",")) fail(`${label}_invalid_header`);
  if (rows.some((row) => row.length !== INPUT_HEADER.length || row.some((cell) => !cell))) fail(`${label}_invalid_row`);
  return rows;
}

function readInput(file, label) {
  return parseInput(readFileSync(file, "utf8"), label);
}

function phoneSet(rows, label, { velocityOnly = false } = {}) {
  const phones = new Set();
  for (const row of rows) {
    const phone = normalizePhone(row[1]);
    if (!phone || (velocityOnly && row[2].toLowerCase() !== "velocity")) fail(`${label}_not_velocity`);
    if (phones.has(phone)) fail(`${label}_duplicate_whatsapp`);
    phones.add(phone);
  }
  return phones;
}

function assertExpected(actual, expected, code) {
  if (actual !== expected) fail(`${code}_unexpected`);
}

function csvFor(rows) {
  return serializeCsv(INPUT_HEADER, rows);
}

export function materializeVelocityInviteInputs({
  baseCsv,
  legacyCsv,
  velocityCsv,
  expectedBaseSha256,
  expectedLegacySha256,
  expectedVelocitySha256,
}) {
  const baseRows = parseInput(baseCsv, "base");
  const legacyRows = parseInput(legacyCsv, "extra");
  const velocityRows = parseInput(velocityCsv, "velocity_extra");
  const basePhones = phoneSet(baseRows, "base");
  const legacyPhones = phoneSet(legacyRows, "extra", { velocityOnly: true });
  const velocityPhones = phoneSet(velocityRows, "velocity_extra", { velocityOnly: true });

  const velocityLegacyRows = [...velocityPhones].filter((phone) => legacyPhones.has(phone)).length;
  if (velocityLegacyRows !== 0) fail("velocity_extra_duplicates_preserved_overlay");

  const velocityExistingRows = velocityRows.filter((row) => basePhones.has(normalizePhone(row[1])));
  const velocityAppendRows = velocityRows.filter((row) => !basePhones.has(normalizePhone(row[1])));
  const legacyBaseRows = legacyRows.filter((row) => basePhones.has(normalizePhone(row[1])));
  if (legacyBaseRows.length !== 0) fail("preserved_overlay_duplicates_base");

  const sourceOverlayRows = [...legacyRows, ...velocityRows];
  const sourceOverlayPhones = phoneSet(sourceOverlayRows, "source_overlay", { velocityOnly: true });
  const appendRows = [...legacyRows, ...velocityAppendRows];
  const appendPhones = phoneSet(appendRows, "append_overlay", { velocityOnly: true });
  const combinedRows = [...baseRows, ...appendRows];
  const combinedPhones = phoneSet(combinedRows, "combined");

  assertExpected(baseRows.length, VELOCITY_APPEND_EXPECTATIONS.baseRows, "base_rows");
  assertExpected(legacyRows.length, VELOCITY_APPEND_EXPECTATIONS.preservedExtraRows, "preserved_extra_rows");
  assertExpected(velocityRows.length, VELOCITY_APPEND_EXPECTATIONS.velocityRows, "velocity_rows");
  assertExpected(velocityExistingRows.length, VELOCITY_APPEND_EXPECTATIONS.velocityBaseRows, "velocity_base_rows");
  assertExpected(velocityLegacyRows, VELOCITY_APPEND_EXPECTATIONS.velocityLegacyRows, "velocity_legacy_rows");
  assertExpected(appendRows.length, VELOCITY_APPEND_EXPECTATIONS.appendRows, "append_rows");
  assertExpected(combinedRows.length, VELOCITY_APPEND_EXPECTATIONS.combinedRows, "combined_rows");
  if (sourceOverlayPhones.size !== sourceOverlayRows.length || appendPhones.size !== appendRows.length || combinedPhones.size !== combinedRows.length) fail("phone_set_integrity_invalid");

  const canonical = {
    base: csvFor(baseRows),
    legacy: csvFor(legacyRows),
    preserved: csvFor(legacyRows),
    velocity: csvFor(velocityRows),
    sourceOverlay: csvFor(sourceOverlayRows),
    append: csvFor(appendRows),
    velocityAppend: csvFor(velocityAppendRows),
    velocityExisting: csvFor(velocityExistingRows),
    combined: csvFor(combinedRows),
  };
  const meta = {
    baseRows: baseRows.length,
    preservedExtraRows: legacyRows.length,
    velocityRows: velocityRows.length,
    sourceOverlayRows: sourceOverlayRows.length,
    appendRows: appendRows.length,
    velocityAppendRows: velocityAppendRows.length,
    velocityBaseRows: velocityExistingRows.length,
    velocityLegacyRows,
    combinedRows: combinedRows.length,
    baseSha256: sha256(canonical.base),
    extraSha256: sha256(canonical.legacy),
    velocityExtraSha256: sha256(canonical.velocity),
    combinedSha256: sha256(canonical.combined),
  };
  if (meta.baseSha256 !== expectedBaseSha256) fail("base_input_sha256_mismatch");
  if (meta.extraSha256 !== expectedLegacySha256) fail("extra_input_sha256_mismatch");
  if (meta.velocityExtraSha256 !== expectedVelocitySha256) fail("velocity_extra_input_sha256_mismatch");
  return { canonical, meta };
}

function readDelivery(file, label) {
  const rows = parseCsv(readFileSync(file, "utf8"), label);
  const header = rows.shift().map((cell) => cell.toLowerCase());
  if (header.join(",") !== DELIVERY_HEADER.join(",")) fail(`${label}_invalid_header`);
  if (rows.some((row) => row.length !== DELIVERY_HEADER.length || row.some((cell) => !cell))) fail(`${label}_invalid_row`);
  return rows;
}

function rowsByPhone(rows, label) {
  const byPhone = new Map();
  for (const row of rows) {
    const phone = normalizePhone(row[2]);
    if (!phone || byPhone.has(phone)) fail(`${label}_phone_index_invalid`);
    byPhone.set(phone, row);
  }
  return byPhone;
}

function selectDeliveryRows(inputRows, byPhone, label) {
  const selected = [];
  const selectedPhones = new Set();
  for (const row of inputRows) {
    const phone = normalizePhone(row[1]);
    const delivery = byPhone.get(phone);
    if (!phone || !delivery || selectedPhones.has(phone)) fail(`${label}_delivery_invalid`);
    selectedPhones.add(phone);
    selected.push(delivery);
  }
  return selected;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function selectSql(campaignId, refs) {
  if (!CAMPAIGN_ID_PATTERN.test(campaignId) || refs.length === 0 || new Set(refs).size !== refs.length) fail("query_scope_invalid");
  return `SELECT external_ref, invite_token_hmac, invite_status, expires_at_ms, confirmed_at_ms, velocity_benefit, assigned_outcome_key, assignment_protocol_version, outcome_key FROM bm_invites WHERE campaign_id=${sqlString(campaignId)} AND external_ref IN (${refs.map(sqlString).join(",")});\n`;
}

function inviteTargets(campaignId, refs) {
  if (!CAMPAIGN_ID_PATTERN.test(campaignId) || refs.length === 0 || new Set(refs).size !== refs.length) fail("target_scope_invalid");
  return { campaignId, refs, refHash: sha256(refs.slice().sort().join("\n")) };
}

function appendRollbackPredicate(ref, tableAlias = "") {
  const column = (name) => tableAlias ? `${tableAlias}.${name}` : name;
  return [
    `${column("external_ref")}=${sqlString(ref)}`,
    `${column("invite_status")}='active'`,
    `${column("velocity_benefit")}=${sqlString(VELOCITY_BENEFIT)}`,
    `${column("assigned_outcome_key")} IS NULL`,
    `${column("assignment_protocol_version")}=${sqlString(ASSIGNMENT_PROTOCOL_VERSION)}`,
    `${column("confirmed_at_ms")} IS NULL`,
    `${column("operational_consent_at_ms")} IS NULL`,
    `${column("outcome_key")} IS NULL`,
    `NOT EXISTS (SELECT 1 FROM bm_card_reveals AS reveal WHERE reveal.invite_id=${column("id")})`,
  ].join(" AND ");
}

function guardedInviteRevokeSql({ campaignId, refs }) {
  const scope = `campaign_id=${sqlString(campaignId)}`;
  const candidates = refs.map((ref) => `(${appendRollbackPredicate(ref, "candidate")})`).join(" OR ");
  const targets = refs.map((ref) => `(${appendRollbackPredicate(ref)})`).join(" OR ");
  return `UPDATE bm_invites
SET invite_status='revoked',
    updated_at_ms=CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE ${scope}
  AND (SELECT COUNT(*) FROM bm_invites AS candidate WHERE candidate.campaign_id=${sqlString(campaignId)} AND (${candidates}))=${refs.length}
  AND (${targets});\n`;
}

function inviteRollbackReadbackSql(campaignId, refs) {
  return `SELECT i.external_ref, i.invite_status, i.confirmed_at_ms, i.operational_consent_at_ms, i.outcome_key, (SELECT COUNT(*) FROM bm_card_reveals AS reveal WHERE reveal.invite_id=i.id) AS reveal_count FROM bm_invites AS i WHERE i.campaign_id=${sqlString(campaignId)} AND i.external_ref IN (${refs.map(sqlString).join(",")});\n`;
}

function writePrivate(file, content) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, content, { encoding: "utf8", mode: 0o600 });
}

export function deriveVelocityInviteArtifacts({ campaignId, sourceOverlayRows, preservedRows, velocityRows, velocityAppendRows, existingRows, deliveryRows, shortRows }) {
  const deliveryByPhone = rowsByPhone(deliveryRows, "delivery");
  const shortByPhone = rowsByPhone(shortRows, "short");
  const overlayDelivery = selectDeliveryRows(sourceOverlayRows, deliveryByPhone, "overlay");
  const overlayShort = selectDeliveryRows(sourceOverlayRows, shortByPhone, "overlay_short");
  const velocityDelivery = selectDeliveryRows(velocityRows, deliveryByPhone, "velocity");
  const velocityShort = selectDeliveryRows(velocityRows, shortByPhone, "velocity_short");
  const velocityAppendDelivery = selectDeliveryRows(velocityAppendRows, deliveryByPhone, "velocity_append");
  const existingDelivery = selectDeliveryRows(existingRows, deliveryByPhone, "velocity_existing");
  const overlayRefs = overlayDelivery.map((row) => row[1]);
  const preservedRefs = selectDeliveryRows(preservedRows, deliveryByPhone, "preserved").map((row) => row[1]);
  const velocityRefs = velocityDelivery.map((row) => row[1]);
  const velocityAppendRefs = velocityAppendDelivery.map((row) => row[1]);
  const existingRefs = existingDelivery.map((row) => row[1]);
  if (overlayShort.length !== overlayDelivery.length || velocityShort.length !== velocityDelivery.length) fail("short_link_count_invalid");
  if (new Set(overlayRefs).size !== overlayRefs.length || new Set(preservedRefs).size !== preservedRefs.length || new Set(velocityRefs).size !== velocityRefs.length || new Set(velocityAppendRefs).size !== velocityAppendRefs.length || new Set(existingRefs).size !== existingRefs.length) fail("invite_ref_set_invalid");
  assertExpected(sourceOverlayRows.length, 65, "source_overlay_rows");
  assertExpected(preservedRows.length, VELOCITY_APPEND_EXPECTATIONS.preservedExtraRows, "preserved_extra_rows");
  assertExpected(velocityRows.length, VELOCITY_APPEND_EXPECTATIONS.velocityRows, "velocity_rows");
  assertExpected(velocityAppendRows.length, VELOCITY_APPEND_EXPECTATIONS.velocityRows - VELOCITY_APPEND_EXPECTATIONS.velocityBaseRows, "velocity_append_rows");
  assertExpected(existingRows.length, VELOCITY_APPEND_EXPECTATIONS.velocityBaseRows, "velocity_base_rows");
  return {
    velocityShortCsv: serializeCsv(DELIVERY_HEADER, velocityShort),
    velocityAppendDeliveryCsv: serializeCsv(DELIVERY_HEADER, velocityAppendDelivery),
    summary: {
      campaignId,
      count: velocityRows.length,
      overlayCount: sourceOverlayRows.length,
      existingBaseCount: existingRows.length,
      sha256: sha256(serializeCsv(DELIVERY_HEADER, velocityShort)),
    },
    teamQuery: selectSql(campaignId, overlayRefs),
    preservedQuery: selectSql(campaignId, preservedRefs),
    velocityQuery: selectSql(campaignId, velocityRefs),
    promotionQuery: selectSql(campaignId, existingRefs),
    preservedTargets: inviteTargets(campaignId, preservedRefs),
    promotionTargets: inviteTargets(campaignId, existingRefs),
    velocityTargets: inviteTargets(campaignId, velocityRefs),
    velocityAppendTargets: inviteTargets(campaignId, velocityAppendRefs),
    inviteRollbackSql: guardedInviteRevokeSql({ campaignId, refs: velocityAppendRefs }),
    inviteRollbackReadbackSql: inviteRollbackReadbackSql(campaignId, velocityAppendRefs),
  };
}

function parseD1Payload(value, label, { requireResults = true } = {}) {
  const raw = String(value ?? "").replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== "[" && raw[index] !== "{") continue;
    try {
      const payload = JSON.parse(raw.slice(index));
      if (Array.isArray(payload) && (!requireResults || Array.isArray(payload?.[0]?.results))) return payload;
    } catch {
      // Wrangler can prefix progress output before its JSON payload.
    }
  }
  fail(`${label}_invalid`);
}

function d1Rows(value, label) {
  const payload = parseD1Payload(value, label);
  const rows = payload?.[0]?.results;
  return rows;
}

function verifyExpectedRows(rows, targets, label) {
  const actual = new Map(rows.map((row) => [String(row.external_ref ?? ""), row]));
  if (actual.size !== rows.length || actual.size !== targets.refs.length || [...actual.keys()].some((ref) => !targets.refs.includes(ref))) fail(`${label}_scope_invalid`);
  if (rows.some((row) => row.invite_status !== "active" || Number(row.expires_at_ms) <= Date.now())) fail(`${label}_not_active`);
  return actual;
}

export function verifyPreservedInvites({ targets, d1Payload }) {
  const rows = d1Rows(d1Payload, "preserved_pre_readback");
  verifyExpectedRows(rows, targets, "preserved_pre_readback");
  assertExpected(rows.length, VELOCITY_APPEND_EXPECTATIONS.preservedExtraRows, "preserved_pre_readback_rows");
  return { activePreservedInvites: rows.length };
}

export function verifyPromotionTokenHmacs({ targets, d1Payload, deliveryAttestation }) {
  if (!deliveryAttestation || deliveryAttestation.campaignId !== targets.campaignId) fail("promotion_token_attestation_scope_invalid");
  const expectedByRef = deliveryAttestation.inviteTokenHmacByRef;
  if (!expectedByRef || typeof expectedByRef !== "object" || Array.isArray(expectedByRef)) fail("promotion_token_attestation_invalid");
  const rows = d1Rows(d1Payload, "promotion_token_pre_readback");
  const byRef = verifyExpectedRows(rows, targets, "promotion_token_pre_readback");
  for (const ref of targets.refs) {
    const expected = expectedByRef[ref];
    const actual = byRef.get(ref)?.invite_token_hmac;
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected) || actual !== expected) fail("promotion_token_hmac_mismatch");
  }
  return { targetCount: rows.length, tokenHmacMatch: true };
}

function requiredText(value, code) {
  const text = typeof value === "string" ? value : "";
  if (!text) fail(code);
  return text;
}

function exactInteger(value, code) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric)) fail(code);
  return numeric;
}

function nullableInteger(value, code) {
  if (value === null) return null;
  return exactInteger(value, code);
}

function nullableText(value, code) {
  if (value === null) return null;
  return requiredText(value, code);
}

function nullableSqlPredicate(column, value) {
  if (value === null) return `${column} IS NULL`;
  return Number.isSafeInteger(value) ? `${column}=${value}` : `${column}=${sqlString(value)}`;
}

function promotionCommercialState(row) {
  const assignmentProtocolVersion = requiredText(row.assignment_protocol_version, "promotion_assignment_protocol_missing");
  if (assignmentProtocolVersion !== ASSIGNMENT_PROTOCOL_VERSION) fail("promotion_assignment_protocol_invalid");
  return {
    ref: requiredText(row.external_ref, "promotion_ref_missing"),
    velocityBenefit: row.velocity_benefit,
    expiresAtMs: exactInteger(row.expires_at_ms, "promotion_expiry_invalid"),
    confirmedAtMs: nullableInteger(row.confirmed_at_ms, "promotion_confirmation_invalid"),
    assignedOutcomeKey: requiredText(row.assigned_outcome_key, "promotion_commercial_assignment_missing"),
    assignmentProtocolVersion,
    outcomeKey: nullableText(row.outcome_key, "promotion_outcome_invalid"),
  };
}

function promotionCommercialPredicate(state, velocityBenefit) {
  return [
    `external_ref=${sqlString(state.ref)}`,
    "invite_status='active'",
    `expires_at_ms=${state.expiresAtMs}`,
    `velocity_benefit=${sqlString(velocityBenefit)}`,
    `assigned_outcome_key=${sqlString(state.assignedOutcomeKey)}`,
    `assignment_protocol_version=${sqlString(state.assignmentProtocolVersion)}`,
    nullableSqlPredicate("confirmed_at_ms", state.confirmedAtMs),
    nullableSqlPredicate("outcome_key", state.outcomeKey),
  ].join(" AND ");
}

function guardedVelocityUpdate({ campaignId, commercialRows, fromBenefit, toBenefit }) {
  const scope = `campaign_id=${sqlString(campaignId)}`;
  const predicates = commercialRows.map((row) => `(${promotionCommercialPredicate(row, fromBenefit)})`).join(" OR ");
  const expectedCount = commercialRows.length;
  return `UPDATE bm_invites SET velocity_benefit=${sqlString(toBenefit)}, updated_at_ms=CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE ${scope} AND (SELECT COUNT(*) FROM bm_invites WHERE ${scope} AND (${predicates}))=${expectedCount} AND (${predicates});\n`;
}

function matchesPromotionCommercialState(row, expected, velocityBenefit) {
  try {
    return row.velocity_benefit === velocityBenefit
      && row.invite_status === "active"
      && exactInteger(row.expires_at_ms, "promotion_final_expiry_invalid") === expected.expiresAtMs
      && nullableInteger(row.confirmed_at_ms, "promotion_final_confirmation_invalid") === expected.confirmedAtMs
      && requiredText(row.assigned_outcome_key, "promotion_final_assignment_missing") === expected.assignedOutcomeKey
      && requiredText(row.assignment_protocol_version, "promotion_final_assignment_protocol_missing") === expected.assignmentProtocolVersion
      && nullableText(row.outcome_key, "promotion_final_outcome_invalid") === expected.outcomeKey;
  } catch {
    return false;
  }
}

export function planVelocityPromotions({ campaignId, targets, d1Payload }) {
  if (campaignId !== targets.campaignId || !CAMPAIGN_ID_PATTERN.test(campaignId)) fail("promotion_scope_invalid");
  const rows = d1Rows(d1Payload, "promotion_pre_readback");
  verifyExpectedRows(rows, targets, "promotion_pre_readback");
  if (rows.some((row) => row.velocity_benefit !== VELOCITY_BENEFIT && row.velocity_benefit !== "none")) fail("promotion_benefit_state_invalid");

  const commercialRows = rows
    .filter((row) => String(row.assigned_outcome_key ?? "").length > 0)
    .map((row) => promotionCommercialState(row))
    .sort((left, right) => left.ref.localeCompare(right.ref));
  if (commercialRows.length !== VELOCITY_APPEND_EXPECTATIONS.promotionRows) fail("promotion_commercial_assignment_missing");

  const alreadyCourtesy = rows.filter((row) => row.velocity_benefit === VELOCITY_BENEFIT);
  const commercialCourtesy = commercialRows.filter((row) => row.velocityBenefit === VELOCITY_BENEFIT);
  const commercialNone = commercialRows.filter((row) => row.velocityBenefit === "none");
  const initialGrant = alreadyCourtesy.length === VELOCITY_APPEND_EXPECTATIONS.alreadyCourtesyRows
    && commercialCourtesy.length === 0
    && commercialNone.length === VELOCITY_APPEND_EXPECTATIONS.promotionRows;
  const reconciledGrant = alreadyCourtesy.length === targets.refs.length
    && commercialCourtesy.length === VELOCITY_APPEND_EXPECTATIONS.promotionRows
    && commercialNone.length === 0;
  if (!initialGrant && !reconciledGrant) fail("promotion_precondition_invalid");

  const operation = initialGrant ? "apply" : "reconciled";
  const promotionCount = operation === "apply" ? commercialRows.length : 0;
  const plan = {
    schemaVersion: 1,
    campaignId,
    targetRefHash: targets.refHash,
    targetCount: targets.refs.length,
    operation,
    alreadyCourtesyCount: alreadyCourtesy.length,
    promotionCount,
    commercialCount: commercialRows.length,
    commercialRows,
  };
  const updateSql = operation === "apply"
    ? guardedVelocityUpdate({ campaignId, commercialRows, fromBenefit: "none", toBenefit: VELOCITY_BENEFIT })
    : "SELECT 0 AS no_changes;\n";
  const rollbackSql = guardedVelocityUpdate({ campaignId, commercialRows, fromBenefit: VELOCITY_BENEFIT, toBenefit: "none" });
  return { plan, updateSql, rollbackSql };
}

export function verifyPromotionApply({ targets, plan, d1Payload }) {
  if (
    targets.campaignId !== plan.campaignId
    || targets.refHash !== plan.targetRefHash
    || plan.targetCount !== targets.refs.length
    || !["apply", "reconciled"].includes(plan.operation)
    || !Array.isArray(plan.commercialRows)
    || plan.commercialRows.length !== VELOCITY_APPEND_EXPECTATIONS.promotionRows
    || plan.commercialCount !== VELOCITY_APPEND_EXPECTATIONS.promotionRows
    || plan.promotionCount !== (plan.operation === "apply" ? VELOCITY_APPEND_EXPECTATIONS.promotionRows : 0)
  ) fail("promotion_plan_invalid");
  const rows = d1Rows(d1Payload, "promotion_final_readback");
  const byRef = verifyExpectedRows(rows, targets, "promotion_final_readback");
  if (rows.some((row) => row.velocity_benefit !== VELOCITY_BENEFIT)) fail("promotion_final_entitlement_invalid");
  for (const expected of plan.commercialRows) {
    const actual = byRef.get(expected.ref);
    if (!actual || !matchesPromotionCommercialState(actual, expected, VELOCITY_BENEFIT)) fail("promotion_commercial_assignment_changed");
  }
  return { operation: plan.operation, targetCount: rows.length, promotionCount: plan.promotionCount };
}

export function verifyVelocityEntitlements({ targets, d1Payload }) {
  const rows = d1Rows(d1Payload, "velocity_final_readback");
  verifyExpectedRows(rows, targets, "velocity_final_readback");
  if (rows.some((row) => row.velocity_benefit !== VELOCITY_BENEFIT)) fail("velocity_final_entitlement_invalid");
  assertExpected(rows.length, VELOCITY_APPEND_EXPECTATIONS.velocityRows, "velocity_final_rows");
  return { targetCount: rows.length };
}

export function verifyOverlayInvites({ sourceOverlayRows, d1Payload }) {
  const rows = d1Rows(d1Payload, "overlay_readback");
  if (sourceOverlayRows.length !== 65 || rows.length !== sourceOverlayRows.length) fail("overlay_readback_count_invalid");
  if (rows.some((row) => row.invite_status !== "active" || Number(row.expires_at_ms) <= Date.now())) fail("overlay_readback_not_active");
  return { activeOverlayInvites: rows.length };
}

export function verifyPromotionWrite({ plan, d1Payload }) {
  if (!plan || !["apply", "reconciled"].includes(plan.operation) || !Number.isInteger(plan.promotionCount)) fail("promotion_plan_invalid");
  const payload = parseD1Payload(d1Payload, "promotion_write", { requireResults: false });
  const changes = Array.isArray(payload)
    ? payload.reduce((total, entry) => total + Number(entry?.meta?.changes ?? 0), 0)
    : Number.NaN;
  if (changes !== plan.promotionCount) fail("promotion_write_count_invalid");
  return { operation: plan.operation, promotionCount: changes };
}

function required(name) {
  const value = process.env[name];
  if (!value) fail(`missing_${name.toLowerCase()}`);
  return value;
}

function runMaterialize() {
  const result = materializeVelocityInviteInputs({
    baseCsv: required("BASE_INVITES_CSV"),
    legacyCsv: required("EXTRA_INVITES_CSV"),
    velocityCsv: required("VELOCITY_EXTRA_INVITES_CSV"),
    expectedBaseSha256: required("EXPECTED_BASE_INPUT_SHA256"),
    expectedLegacySha256: required("EXPECTED_EXTRA_INPUT_SHA256"),
    expectedVelocitySha256: required("EXPECTED_VELOCITY_EXTRA_INPUT_SHA256"),
  });
  const outputs = {
    BASE_INPUT: result.canonical.base,
    TEAM_INPUT: result.canonical.sourceOverlay,
    APPEND_INPUT: result.canonical.append,
    PRESERVED_INPUT: result.canonical.preserved,
    VELOCITY_INPUT: result.canonical.velocity,
    VELOCITY_APPEND_INPUT: result.canonical.velocityAppend,
    VELOCITY_EXISTING_INPUT: result.canonical.velocityExisting,
    COMBINED_INPUT: result.canonical.combined,
    OVERLAY_META: `${JSON.stringify(result.meta)}\n`,
  };
  for (const [name, content] of Object.entries(outputs)) writePrivate(required(name), content);
  console.log(JSON.stringify(result.meta));
}

function runDerive() {
  const result = deriveVelocityInviteArtifacts({
    campaignId: required("CAMPAIGN_ID"),
    sourceOverlayRows: readInput(required("TEAM_INPUT"), "source_overlay"),
    preservedRows: readInput(required("PRESERVED_INPUT"), "preserved"),
    velocityRows: readInput(required("VELOCITY_INPUT"), "velocity"),
    velocityAppendRows: readInput(required("VELOCITY_APPEND_INPUT"), "velocity_append"),
    existingRows: readInput(required("VELOCITY_EXISTING_INPUT"), "velocity_existing"),
    deliveryRows: readDelivery(required("DELIVERY_OUTPUT"), "delivery"),
    shortRows: readDelivery(required("SHORT_OUTPUT"), "short"),
  });
  writePrivate(required("VELOCITY_SHORT_OUTPUT"), result.velocityShortCsv);
  writePrivate(required("VELOCITY_APPEND_DELIVERY"), result.velocityAppendDeliveryCsv);
  writePrivate(required("VELOCITY_SUMMARY"), `${JSON.stringify(result.summary)}\n`);
  writePrivate(required("TEAM_QUERY"), result.teamQuery);
  writePrivate(required("PRESERVED_QUERY"), result.preservedQuery);
  writePrivate(required("VELOCITY_QUERY"), result.velocityQuery);
  writePrivate(required("PROMOTION_QUERY"), result.promotionQuery);
  writePrivate(required("PRESERVED_TARGETS"), `${JSON.stringify(result.preservedTargets)}\n`);
  writePrivate(required("PROMOTION_TARGETS"), `${JSON.stringify(result.promotionTargets)}\n`);
  writePrivate(required("VELOCITY_TARGETS"), `${JSON.stringify(result.velocityTargets)}\n`);
  writePrivate(required("VELOCITY_APPEND_TARGETS"), `${JSON.stringify(result.velocityAppendTargets)}\n`);
  writePrivate(required("INVITE_ROLLBACK_SQL"), result.inviteRollbackSql);
  writePrivate(required("INVITE_ROLLBACK_READBACK_SQL"), result.inviteRollbackReadbackSql);
  console.log(JSON.stringify({ overlayRows: result.summary.overlayCount, velocityRows: result.summary.count, existingBaseRows: result.summary.existingBaseCount }));
}

function runPlanPromotion() {
  const result = planVelocityPromotions({
    campaignId: required("CAMPAIGN_ID"),
    targets: JSON.parse(readFileSync(required("PROMOTION_TARGETS"), "utf8")),
    d1Payload: readFileSync(required("PROMOTION_PRE_READBACK"), "utf8"),
  });
  writePrivate(required("PROMOTION_PLAN"), `${JSON.stringify(result.plan)}\n`);
  writePrivate(required("PROMOTION_SQL"), result.updateSql);
  writePrivate(required("PROMOTION_ROLLBACK_SQL"), result.rollbackSql);
  console.log(JSON.stringify({ operation: result.plan.operation, targetCount: result.plan.targetCount, alreadyCourtesyCount: result.plan.alreadyCourtesyCount, promotionCount: result.plan.promotionCount }));
}

function runVerifyPromotion() {
  const result = verifyPromotionApply({
    targets: JSON.parse(readFileSync(required("PROMOTION_TARGETS"), "utf8")),
    plan: JSON.parse(readFileSync(required("PROMOTION_PLAN"), "utf8")),
    d1Payload: readFileSync(required("PROMOTION_FINAL_READBACK"), "utf8"),
  });
  console.log(JSON.stringify(result));
}

function runVerifyVelocity() {
  const result = verifyVelocityEntitlements({
    targets: JSON.parse(readFileSync(required("VELOCITY_TARGETS"), "utf8")),
    d1Payload: readFileSync(required("VELOCITY_FINAL_READBACK"), "utf8"),
  });
  console.log(JSON.stringify(result));
}

function runVerifyOverlay() {
  const result = verifyOverlayInvites({
    sourceOverlayRows: readInput(required("TEAM_INPUT"), "source_overlay"),
    d1Payload: readFileSync(required("TEAM_READBACK"), "utf8"),
  });
  console.log(JSON.stringify(result));
}

function runVerifyPreserved() {
  const result = verifyPreservedInvites({
    targets: JSON.parse(readFileSync(required("PRESERVED_TARGETS"), "utf8")),
    d1Payload: readFileSync(required("PRESERVED_READBACK"), "utf8"),
  });
  console.log(JSON.stringify(result));
}

function runVerifyPromotionTokenHmacs() {
  const result = verifyPromotionTokenHmacs({
    targets: JSON.parse(readFileSync(required("PROMOTION_TARGETS"), "utf8")),
    d1Payload: readFileSync(required("PROMOTION_PRE_READBACK"), "utf8"),
    deliveryAttestation: JSON.parse(readFileSync(required("DELIVERY_ATTESTATION"), "utf8")),
  });
  console.log(JSON.stringify(result));
}

export function selectVelocityShortProbeUrl(rows) {
  assertExpected(rows.length, VELOCITY_APPEND_EXPECTATIONS.velocityRows, "velocity_short_rows");
  const value = requiredText(rows[0]?.[3], "short_probe_unavailable");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("short_probe_unavailable");
  }
  if (url.protocol !== "https:" || url.hostname !== "esfa.co" || !/^\/[A-Za-z0-9_-]{5}\/BelezaEmMovimento$/.test(url.pathname)) fail("short_probe_unavailable");
  return value;
}

function runProbeVelocityShort() {
  const rows = readDelivery(required("VELOCITY_SHORT_OUTPUT"), "velocity_short");
  const value = selectVelocityShortProbeUrl(rows);
  process.stdout.write(value);
}

function runVerifyPromotionWrite() {
  console.log(JSON.stringify(verifyPromotionWrite({
    plan: JSON.parse(readFileSync(required("PROMOTION_PLAN"), "utf8")),
    d1Payload: readFileSync(required("PROMOTION_APPLY_READBACK"), "utf8"),
  })));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const mode = process.argv[2];
  if (mode === "materialize") runMaterialize();
  else if (mode === "derive") runDerive();
  else if (mode === "plan-promotion") runPlanPromotion();
  else if (mode === "verify-promotion-write") runVerifyPromotionWrite();
  else if (mode === "verify-promotion") runVerifyPromotion();
  else if (mode === "verify-velocity") runVerifyVelocity();
  else if (mode === "verify-overlay") runVerifyOverlay();
  else if (mode === "verify-preserved") runVerifyPreserved();
  else if (mode === "verify-promotion-token-hmacs") runVerifyPromotionTokenHmacs();
  else if (mode === "probe-short-url") runProbeVelocityShort();
  else fail("mode_required");
}
