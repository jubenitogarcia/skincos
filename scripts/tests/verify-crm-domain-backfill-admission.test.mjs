import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { assertCrmDomainBackfillAdmission } from "../verify-crm-domain-backfill-admission.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const planPath = path.join(root, "docs/extraction/crm-domain-backfill-admission.json")
const scriptPath = path.join(root, "scripts/verify-crm-domain-backfill-admission.mjs")

function plan() {
  return JSON.parse(readFileSync(planPath, "utf8"))
}

test("the canonical admission plan authorizes only custodied staging preparation while keeping production and routes disabled", () => {
  const summary = assertCrmDomainBackfillAdmission(plan())
  assert.equal(summary.contract, "skincos/crm-domain-backfill-admission/v3")
  assert.equal(summary.state, "staging-preparation-authorized")
  assert.equal(summary.productionMutationAllowed, false)
  assert.equal(summary.publicRouteMutationAllowed, false)
  assert.equal(summary.atendimentoSourceSemantics, "atendimento/crm-core/confirmed-unit-membership-source/v5")
  assert.deepEqual(summary.stagingSourceReadAuthorized, ["atendimento-client-memberships"])
  assert.deepEqual(summary.stagingProjectionCandidateIds, ["atendimento-client-memberships"])
  assert.deepEqual(summary.atendimentoSourceRelationAllowlist, [
    "crm_atendimento.crm_core_identity_members",
    "crm_atendimento.crm_core_attendance_client_links",
    "crm_atendimento.attendances",
    "crm_atendimento.units",
  ])
  assert.deepEqual(summary.atendimentoExcludedSourceDomains, ["finance"])
  assert.deepEqual(summary.eligibleNow, [])
  assert.deepEqual(summary.excludedDomainIds, ["identity-delivery", "inventory", "finance", "messaging", "timekeeping", "booking"])
})

test("a production admission cannot be introduced through the plan", () => {
  const candidate = plan()
  candidate.target.productionMutationAllowed = true
  assert.throws(() => assertCrmDomainBackfillAdmission(candidate), /TARGET_NOT_FAIL_CLOSED/)
})

test("a retained domain cannot be relabeled as an Atendimento projection candidate", () => {
  const candidate = plan()
  candidate.domains[2] = {
    ...candidate.domains[0],
    id: "finance",
    owner: "Finance",
  }
  assert.throws(() => assertCrmDomainBackfillAdmission(candidate), /EXCLUDED_DOMAIN_(INVALID|NOT_FAIL_CLOSED)/)
})

test("the Atendimento candidate rejects a Finance relation or dropped source-domain exclusion", () => {
  const withFinanceRelation = plan()
  withFinanceRelation.domains[0].sourceRelationAllowlist.push("crm_caixa.sales")
  assert.throws(() => assertCrmDomainBackfillAdmission(withFinanceRelation), /ATENDIMENTO_SOURCE_RELATION_ALLOWLIST_INVALID/)

  const withoutFinanceExclusion = plan()
  withoutFinanceExclusion.domains[0].excludedSourceDomains = []
  assert.throws(() => assertCrmDomainBackfillAdmission(withoutFinanceExclusion), /ATENDIMENTO_SOURCE_DOMAIN_EXCLUSIONS_INVALID/)
})

test("the verifier offers no apply or delivery operation", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--apply"], { encoding: "utf8" })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, "")
  assert.match(result.stderr, /OPERATION_NOT_SUPPORTED/)
})
