import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { classify, BASELINE_E2E, USERS_E2E } from "../github-actions/affected-crm-validation-scope.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("JS-only changes run JavaScript CodeQL without Python or website work", () => {
  const report = classify(["messaging/channels/whatsapp/engine/index.js"]);
  assert.equal(report.run_js_codeql, true);
  assert.equal(report.run_python_codeql, false);
  assert.equal(report.run_website, false);
  assert.equal(report.run_central_e2e, false);
});

test("Python-only changes run Python CodeQL without JavaScript or CRM E2E", () => {
  const report = classify(["backend/config/settings.py"]);
  assert.equal(report.run_python_codeql, true);
  assert.equal(report.run_js_codeql, false);
  assert.equal(report.run_crm, false);
  assert.equal(report.run_central_e2e, false);
});

test("Python dependency manifests remain part of the Python closure", () => {
  const report = classify(["backend/requirements.txt"]);
  assert.equal(report.run_python_codeql, true);
  assert.equal(report.run_js_codeql, false);
  assert.equal(report.docs_only, false);
});

test("website-only changes build and analyze only the website", () => {
  const report = classify(["website/src/pages/Home.tsx"]);
  assert.equal(report.run_js_codeql, true);
  assert.equal(report.run_website, true);
  assert.equal(report.run_crm, false);
  assert.equal(report.run_central_e2e, false);
  assert.equal(report.run_escala_e2e, false);
});

test("Users changes select the shared baseline plus Users closure", () => {
  const report = classify(["crm/console/UsersModule.tsx"]);
  assert.equal(report.reason, "users-focused");
  assert.equal(report.run_users_e2e, true);
  assert.equal(report.run_central_e2e, true);
  assert.equal(report.run_escala_e2e, false);
  assert.equal(report.central_tests, [...BASELINE_E2E, ...USERS_E2E].join(" "));
});

test("Escala changes select the dedicated Escala closure without duplicating central E2E", () => {
  const report = classify(["crm/console/EscalaProfissionaisModule.tsx"]);
  assert.equal(report.reason, "escala-focused");
  assert.equal(report.run_escala_e2e, true);
  assert.equal(report.run_central_e2e, false);
  assert.equal(report.run_users_e2e, false);
});

test("the shared Escala client fans out to both dependent UI closures", () => {
  const report = classify(["crm/console/escalaApi.ts"]);
  assert.equal(report.run_users_e2e, true);
  assert.equal(report.run_escala_e2e, true);
  assert.equal(report.run_central_e2e, true);
  assert.match(report.central_tests, /users-module\.spec\.ts/);
});

test("shared and elevated paths fail closed to both analysis languages and full browser coverage", () => {
  const report = classify(["shared/identity-contract/index.js"]);
  assert.equal(report.full, true);
  assert.equal(report.shared_or_elevated, true);
  assert.equal(report.run_js_codeql, true);
  assert.equal(report.run_python_codeql, true);
  assert.equal(report.central_tests, "__FULL__");
  assert.equal(report.run_escala_e2e, true);
});

test("high and critical policy paths retain the full set", () => {
  const high = classify(["crm/console/functions/api/auth/[[path]].ts"]);
  const critical = classify(["ops/irreversible-production-delete.mjs"]);
  for (const report of [high, critical]) {
    assert.equal(report.full, true);
    assert.equal(report.run_js_codeql, true);
    assert.equal(report.run_python_codeql, true);
    assert.equal(report.run_central_e2e, true);
    assert.equal(report.run_escala_e2e, true);
    assert.equal(report.central_tests, "__FULL__");
  }
});

test("schedule and dispatch are always full, even without a changed-file list", () => {
  for (const event of ["schedule", "workflow_dispatch"]) {
    const report = classify([], { event });
    assert.equal(report.reason, `${event}-full`);
    assert.equal(report.full, true);
    assert.equal(report.run_js_codeql, true);
    assert.equal(report.run_python_codeql, true);
    assert.equal(report.run_crm, true);
    assert.equal(report.run_website, true);
    assert.equal(report.run_central_e2e, true);
    assert.equal(report.run_escala_e2e, true);
    assert.equal(report.central_tests, "__FULL__");
  }
});

test("the three workflows consume this focused scope and preserve manual/full triggers", () => {
  const codeql = read(".github/workflows/crm-codeql.yml");
  const central = read(".github/workflows/central-e2e-smoke.yml");
  const escala = read(".github/workflows/escala-ui-e2e.yml");
  const scope = read("scripts/github-actions/affected-crm-validation-scope.mjs");
  for (const workflow of [codeql, central, escala]) {
    assert.match(workflow, /affected-crm-validation-scope\.mjs/);
    assert.match(workflow, /workflow_dispatch:/);
  }
  assert.match(codeql, /schedule:/);
  assert.match(codeql, /run_js_codeql/);
  assert.match(codeql, /run_python_codeql/);
  assert.match(scope, /e2e\/users-module\.spec\.ts/);
  assert.match(scope, /__FULL__/);
  assert.match(escala, /escala-module\.spec\.ts/);
  assert.match(escala, /run_escala_e2e/);
});
