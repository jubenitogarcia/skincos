import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  ".github/workflows/ponto-ui-smoke.yml",
  "utf8",
);
const script = fs.readFileSync(
  "crm/console/scripts/ponto-ui-smoke.cjs",
  "utf8",
);

test("production UI smoke is manual, environment-scoped, and emits no authenticated media", () => {
  assert.match(workflow, /\n  workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n  schedule:/);
  assert.match(workflow, /\n    environment: production/);
  assert.match(workflow, /secrets\.PONTO_PILOT_LOGIN/);
  assert.match(workflow, /secrets\.PONTO_PILOT_PASSWORD/);
  assert.equal(
    [...workflow.matchAll(/NO_SCREENSHOTS:\s*"1"/g)].length,
    2,
  );
  assert.doesNotMatch(workflow, /actions\/upload-artifact/);
  assert.doesNotMatch(workflow, /PONTO_SMOKE_(?:EMAIL|PASSWORD)/);
});

test("UI smoke revokes the exact authenticated session and never persists response bodies", () => {
  assert(
    script.indexOf("authenticatedSessionObserved = true")
      < script.indexOf("context.cookies(URL)"),
  );
  assert.match(
    script,
    /if \(AUTO_LOGIN\) \{\s+sessionMayExist = true\s+await tryAutoLogin\(\)/,
  );
  assert.match(script, /if \(sessionMayExist\) \{/);
  assert.match(script, /roleClass !== 'CONSULTOR'/);
  assert.match(
    script,
    /JSON\.stringify\(\['atendimento', 'ponto'\]\)/,
  );
  assert.match(script, /\[data-module-nav="true"\]/);
  assert.match(
    script,
    /CRM navigation does not expose exactly Atendimento and Ponto/,
  );
  assert.match(
    script,
    /Build badge is absent while EXPECT_BUILD_SHA is required/,
  );
  assert.match(script, /fetch\('\/api\/auth\/logout'/);
  assert.match(script, /fetch\(new URL\('\/api\/auth\/me', URL\)/);
  assert.match(script, /revoked\.status !== 401/);
  assert.match(script, /code !== 'UNAUTHORIZED'/);
  assert.match(script, /context\.clearCookies\(\)/);
  assert.match(script, /fs\.rmSync\(storageStatePath, \{ force: true \}\)/);
  assert.doesNotMatch(script, /storageState:\s*storageStatePath/);
  assert.doesNotMatch(script, /context\.storageState/);
  assert.doesNotMatch(script, /api\.text|state\.text/);
  assert.doesNotMatch(script, /consoleLines|console\.txt/);
});
