#!/usr/bin/env node
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const defaultPlanPath = path.join(root, "docs/extraction/crm-domain-backfill-admission.json")

const excludedDomains = Object.freeze([
  "identity-delivery",
  "inventory",
  "finance",
  "messaging",
  "timekeeping",
  "booking",
])
const requiredAtendimentoEvidence = Object.freeze([
  "owner-attested-repeatable-read-snapshot",
  "read-only-source-principal-and-grants",
  "core-staging-receiver-release-and-digest",
  "finite-signed-batch-allowlist",
  "accepted-idempotent-receipts-and-d1-readback",
  "same-artifact-rollback-without-data-deletion",
])
const requiredAtendimentoSourceRelations = Object.freeze([
  "crm_atendimento.global_client_identity_members",
  "crm_atendimento.attendance_client_links",
  "crm_atendimento.attendances",
  "crm_atendimento.units",
])
const excludedAtendimentoSourceDomains = Object.freeze(["finance"])

function fail(code) {
  throw new Error(`CRM_DOMAIN_BACKFILL_ADMISSION_INVALID:${code}`)
}

function object(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code)
  return value
}

function exactKeys(value, keys, code) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code)
}

function text(value, code) {
  if (typeof value !== "string" || !value.trim()) fail(code)
  return value.trim()
}

function orderedStrings(value, code) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) fail(code)
  if (new Set(value).size !== value.length) fail(code)
  return value
}

function exactOrderedStrings(value, expected, code) {
  const actual = orderedStrings(value, code)
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) fail(code)
  return actual
}

function assertTarget(value) {
  const target = object(value, "TARGET_INVALID")
  exactKeys(target, ["repository", "environment", "productionMutationAllowed", "receiverScope", "publicRouteMutationAllowed"], "TARGET_INVALID")
  if (
    target.repository !== "jubenitogarcia/skincos-crm-core"
    || target.environment !== "staging"
    || target.productionMutationAllowed !== false
    || target.receiverScope !== "opaque-projections-only"
    || target.publicRouteMutationAllowed !== false
  ) fail("TARGET_NOT_FAIL_CLOSED")
  return Object.freeze({ ...target })
}

function assertProjectionCandidate(value) {
  const domain = object(value, "ATENDIMENTO_DOMAIN_INVALID")
  exactKeys(domain, ["id", "owner", "mode", "state", "sourceContract", "sourceSemantics", "sourceRelationAllowlist", "excludedSourceDomains", "recordClass", "targetEnvironment", "stagingSourceReadAllowed", "productionBackfillAllowed", "requiredEvidence"], "ATENDIMENTO_DOMAIN_INVALID")
  if (
    domain.id !== "atendimento-client-memberships"
    || domain.owner !== "Atendimento"
    || domain.mode !== "projection-candidate"
    || domain.state !== "staging-preparation-authorized"
    || domain.sourceContract !== "atendimento/crm-core/unit-scoped-projection-source/v1"
    || domain.sourceSemantics !== "atendimento/crm-core/confirmed-unit-membership-source/v3"
    || domain.recordClass !== "opaque-client-membership-projection"
    || domain.targetEnvironment !== "staging"
    || domain.stagingSourceReadAllowed !== true
    || domain.productionBackfillAllowed !== false
  ) fail("ATENDIMENTO_DOMAIN_NOT_FAIL_CLOSED")
  exactOrderedStrings(domain.sourceRelationAllowlist, requiredAtendimentoSourceRelations, "ATENDIMENTO_SOURCE_RELATION_ALLOWLIST_INVALID")
  exactOrderedStrings(domain.excludedSourceDomains, excludedAtendimentoSourceDomains, "ATENDIMENTO_SOURCE_DOMAIN_EXCLUSIONS_INVALID")
  assert.deepEqual(orderedStrings(domain.requiredEvidence, "ATENDIMENTO_EVIDENCE_INVALID"), requiredAtendimentoEvidence, "Atendimento evidence must retain its exact staging admission sequence")
  return Object.freeze({
    ...domain,
    sourceRelationAllowlist: Object.freeze([...domain.sourceRelationAllowlist]),
    excludedSourceDomains: Object.freeze([...domain.excludedSourceDomains]),
    requiredEvidence: Object.freeze([...domain.requiredEvidence]),
  })
}

function assertExcludedDomain(value, expectedId) {
  const domain = object(value, "EXCLUDED_DOMAIN_INVALID")
  exactKeys(domain, ["id", "owner", "mode", "state", "reason", "productionBackfillAllowed"], "EXCLUDED_DOMAIN_INVALID")
  if (
    domain.id !== expectedId
    || domain.mode !== "excluded"
    || domain.state !== "owner-retained"
    || domain.productionBackfillAllowed !== false
  ) fail("EXCLUDED_DOMAIN_NOT_FAIL_CLOSED")
  text(domain.owner, "EXCLUDED_DOMAIN_OWNER_INVALID")
  text(domain.reason, "EXCLUDED_DOMAIN_REASON_INVALID")
  return Object.freeze({ ...domain })
}

export function assertCrmDomainBackfillAdmission(value) {
  const plan = object(value, "PLAN_INVALID")
  exactKeys(plan, ["contract", "state", "target", "domains", "prohibitions"], "PLAN_INVALID")
  if (plan.contract !== "skincos/crm-domain-backfill-admission/v3" || plan.state !== "staging-preparation-authorized") fail("PLAN_NOT_STAGING_PREPARATION_AUTHORIZED")
  const target = assertTarget(plan.target)
  if (!Array.isArray(plan.domains) || plan.domains.length !== excludedDomains.length + 1) fail("DOMAIN_SET_INVALID")
  const [candidate, ...excluded] = plan.domains
  const atendimento = assertProjectionCandidate(candidate)
  const actualExcludedIds = excluded.map((entry, index) => assertExcludedDomain(entry, excludedDomains[index]).id)
  assert.deepEqual(actualExcludedIds, excludedDomains, "Excluded domains must remain explicit and ordered")
  const prohibitions = orderedStrings(plan.prohibitions, "PROHIBITIONS_INVALID")
  const requiredProhibitions = [
    "No CRM Core delivery, route mutation or legacy runtime retirement is performed by this plan.",
    "Only the fixed Atendimento custody helper may take an owner-attested read-only production-source snapshot to prepare opaque staging packets; no source payload is uploaded to GitHub and no packet is delivered by this plan.",
    "No customer attribute, raw identifier, identity, session, finance, messaging, inventory or timekeeping record is copied into CRM Core; the Atendimento source may query only its declared relation allowlist.",
    "No excluded domain may be reclassified without a dedicated source-owner contract and reviewed staging evidence.",
  ]
  assert.deepEqual(prohibitions, requiredProhibitions, "Domain admission prohibitions must remain exact")
  return Object.freeze({
    contract: plan.contract,
    state: plan.state,
    productionMutationAllowed: target.productionMutationAllowed,
    publicRouteMutationAllowed: target.publicRouteMutationAllowed,
    stagingSourceReadAuthorized: Object.freeze([atendimento.id]),
    stagingProjectionCandidateIds: Object.freeze([atendimento.id]),
    atendimentoSourceRelationAllowlist: atendimento.sourceRelationAllowlist,
    atendimentoExcludedSourceDomains: atendimento.excludedSourceDomains,
    eligibleNow: Object.freeze([]),
    excludedDomainIds: Object.freeze(actualExcludedIds),
  })
}

export function readCrmDomainBackfillAdmission(file = defaultPlanPath) {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"))
  } catch {
    fail("PLAN_READ_FAILED")
  }
  return assertCrmDomainBackfillAdmission(parsed)
}

function parseArguments(argv) {
  const args = [...argv]
  let plan = defaultPlanPath
  while (args.length) {
    const argument = args.shift()
    if (argument === "--plan") {
      const supplied = args.shift()
      if (!supplied || supplied.startsWith("-")) fail("PLAN_ARGUMENT_INVALID")
      plan = supplied
      continue
    }
    fail("OPERATION_NOT_SUPPORTED")
  }
  return plan
}

function main() {
  const summary = readCrmDomainBackfillAdmission(parseArguments(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "CRM_DOMAIN_BACKFILL_ADMISSION_INVALID"}\n`)
    process.exitCode = 1
  }
}
