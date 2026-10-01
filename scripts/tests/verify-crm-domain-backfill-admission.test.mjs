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

test("the canonical admission plan keeps production and route mutations disabled", () => {
  const summary = assertCrmDomainBackfillAdmission(plan())
  assert.equal(summary.state, "pre-cut")
  assert.equal(summary.productionMutationAllowed, false)
  assert.equal(summary.publicRouteMutationAllowed, false)
  assert.deepEqual(summary.stagingProjectionCandidateIds, ["atendimento-client-memberships"])
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

test("the verifier offers no apply or delivery operation", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--apply"], { encoding: "utf8" })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, "")
  assert.match(result.stderr, /OPERATION_NOT_SUPPORTED/)
})
