import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const workflow = readFileSync(resolve(repositoryRoot, ".github/workflows/beauty-movement-staging-smoke.yml"), "utf8");
const importer = readFileSync(resolve(repositoryRoot, "website/scripts/beauty-movement-import.ts"), "utf8");

test("staging smoke is pinned to the protected staging surface", () => {
    assert.match(workflow, /environment:\s*staging/);
    assert.match(workflow, /STAGING_URL:\s*https:\/\/espacofacial-site-staging\.skincos\.workers\.dev/);
    assert.match(workflow, /STAGING_D1_DATABASE:\s*espacofacial-beauty-movement-staging/);
    assert.match(workflow, /STAGING_WORKER_NAME:\s*espacofacial-site-staging/);
    assert.match(workflow, /release_sha:/);
    assert.match(workflow, /promotion_unit:/);
    assert.match(workflow, /default:\s*beauty-movement-production-activation/);
    assert.match(workflow, /promotion_unit is not allowed/);
    assert.match(workflow, /beauty-movement-campaign-copy-update/);
    assert.doesNotMatch(workflow, /target_environment|production_d1|--env production|espacofacial-beauty-movement(?:"|\\')/i);
});

test("smoke consumes secrets in-process and closes the staging gate", () => {
    assert.match(workflow, /BEAUTY_MOVEMENT_TOKEN_HMAC_KEY:/);
    assert.match(workflow, /BEAUTY_MOVEMENT_PII_KEY:/);
    assert.match(workflow, /BEAUTY_MOVEMENT_PRIVATE_RUNTIME_ROOT:/);
    assert.match(workflow, /Initialize private runner paths/);
    assert.match(workflow, /smoke_root="\$\{RUNNER_TEMP\}\/beauty-movement-staging-smoke"/);
    assert.match(workflow, /set -euo pipefail/);
    assert.match(workflow, /node --input-type=commonjs -e/);
    assert.doesNotMatch(workflow, /node -e\s/);
    assert.doesNotMatch(workflow, /set -x/);
    assert.match(workflow, /name: promotion-evidence-\$\{\{ inputs\.promotion_unit \}\}/);
    assert.match(workflow, /actions\/upload-artifact/);
    assert.match(workflow, /staging-smoke-disabled-probe/);
    assert.match(workflow, /beauty_movement_delivery_ref_invalid/);
    assert.match(workflow, /i\.external_ref = '\$\{invite_ref\}'/);
    assert.doesNotMatch(workflow, /i\.external_ref = 'velocity-0002'/);
    assert.match(workflow, /bootstrapReady/);
    assert.match(workflow, /mutationResponses/);
    assert.match(workflow, /failedRequests/);
    assert.match(workflow, /beauty_movement_browser_reveal_missing/);
    assert.match(workflow, /timeout: 60000/);
    assert.match(workflow, /timeout: 30000/);
    assert.match(workflow, /inactive_code.*503/s);
    assert.match(workflow, /if:\s*\$\{\{ always\(\) \}\}/);
    assert.match(workflow, /invite_status = 'revoked'/);
    assert.match(workflow, /status = 'disabled'/);
    assert.match(workflow, /rollback/);
    assert.match(workflow, /beauty-movement:update-copy/);
    assert.match(workflow, /--apply --remote --restore/);
    assert.match(workflow, /Recheck staging D1 lease before synthetic copy restore/);
    assert.match(workflow, /copyUpdated/);
    assert.match(workflow, /copyRestored/);
    const browserModule = workflow.match(/SMOKE_INVITE_TOKEN="\$\{token\}" node --input-type=module <<'NODE'[\s\S]*?\n          NODE/)?.[0] ?? "";
    assert.match(browserModule, /import fs from ['"]node:fs['"]/);
    assert.match(browserModule, /import \{ chromium \} from ['"]playwright['"]/);
    assert.doesNotMatch(browserModule, /require\(/);
    const validationStep = workflow.match(/      - name: Validate staging-only source and credentials[\s\S]*?(?=\n      - name:)/)?.[0] ?? "";
    assert.match(validationStep, /BEAUTY_MOVEMENT_TOKEN_HMAC_KEY:\s*\$\{\{ secrets\.BEAUTY_MOVEMENT_TOKEN_HMAC_KEY \}\}/);
    assert.match(validationStep, /BEAUTY_MOVEMENT_PII_KEY:\s*\$\{\{ secrets\.BEAUTY_MOVEMENT_PII_KEY \}\}/);
});

test("importer only widens private runtime custody inside GitHub Actions", () => {
    assert.match(importer, /GITHUB_ACTIONS !== "true"/);
    assert.match(importer, /RUNNER_TEMP/);
    assert.match(importer, /BEAUTY_MOVEMENT_PRIVATE_RUNTIME_ROOT/);
    assert.match(importer, /isWithin\(REPOSITORY_ROOT, resolved\)/);
});

test("deployment and browser journey shell remains syntactically valid", () => {
    const step = workflow.match(
        /      - name: Deploy temporary staging candidate and run authenticated browser journey[\s\S]*?(?=\n      - name:)/,
    )?.[0] ?? "";
    const runBlock = step.match(/\n        run: \|\n([\s\S]*)/)?.[1] ?? "";
    assert.notEqual(runBlock, "", "deployment step must contain a run block");
    const script = runBlock
        .split("\n")
        .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
        .join("\n");
    execFileSync("bash", ["-n"], { input: script, encoding: "utf8" });
});
