import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  new URL("../workflows/module-availability.yml", import.meta.url),
  "utf8",
);
const coordinator = fs.readFileSync(
  new URL("../workflows/ponto-progressive-release.yml", import.meta.url),
  "utf8",
);
const setStateStart = workflow.indexOf("  set-state:");
const emergencyStart = workflow.indexOf("  emergency-reconciliation:");
const setState = workflow.slice(setStateStart, emergencyStart);

test("Ponto control-plane mutation remains protected and GitHub-hosted without changing Finance", () => {
  assert.ok(setStateStart >= 0 && setStateStart < emergencyStart);
  assert.match(setState, /runs-on: ubuntu-latest/);
  assert.match(setState, /environment: \$\{\{ inputs\.target \}\}/);
  assert.match(setState, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(setState, /timekeeping:staging\) NAMESPACE_ID=/);
  assert.match(setState, /timekeeping:production\) NAMESPACE_ID=/);
  assert.match(setState, /finance:staging\) NAMESPACE_ID=/);
  assert.match(setState, /finance:production\) NAMESPACE_ID=/);
  assert.match(setState, /kv key put "module-control:\$MODULE"/);
  assert.match(setState, /ponto-cloudflare-resource-identity\.mjs/);
  assert.match(setState, /ponto-module-propagation\.mjs/);
  assert.match(
    setState,
    /payload\.state === "active"[\s\S]*payload\.rolloutStage = process\.env\.TARGET;[\s\S]*active staging Timekeeping must be synthetic-only/,
  );
  assert.match(
    setState,
    /value\.state === "active" && value\.rolloutStage !== process\.env\.EXPECTED_TARGET/,
  );
  assert.match(setState, /module-transition-\$\{\{ inputs\.module \}\}-\$\{\{ inputs\.target \}\}-\$\{\{ inputs\.state \}\}-/);
  assert.match(setState, /Upload sanitized module transition and propagation evidence[\s\S]*?if: always\(\)[\s\S]*?actions\/upload-artifact@/);
  assert.match(setState, /\$\{\{ runner\.temp \}\}\/ponto-resource-identity\.json/);
  assert.doesNotMatch(setState, /PONTO_PILOT_RUNNER_LABELS_JSON/);
  assert.doesNotMatch(workflow, /self-hosted|PONTO_PILOT_RUNNER_LABELS_JSON/);
});

test("live clinic evidence is delegated only after the exact module artifact to the canonical SLO workflow", () => {
  const liveOpenStep = coordinator.indexOf(
    "      - name: Open the approved live cohort or activate production",
  );
  const liveOpenDispatch = coordinator.indexOf(
    "ponto-dispatch-workflow.mjs module-availability.yml",
    liveOpenStep,
  );
  const liveOpenArtifact = coordinator.indexOf(
    '--name "module-transition-timekeeping-production-$state-$GITHUB_RUN_ID"',
    liveOpenDispatch,
  );
  const sloStep = coordinator.indexOf(
    "      - name: Observe external authenticated production SLO",
    liveOpenArtifact,
  );
  const sloDispatch = coordinator.indexOf(
    "ponto-dispatch-workflow.mjs ponto-production-slo.yml",
    sloStep,
  );
  assert.ok(
    liveOpenStep >= 0
      && liveOpenStep < liveOpenDispatch
      && liveOpenDispatch < liveOpenArtifact
      && liveOpenArtifact < sloStep
      && sloStep < sloDispatch,
  );
});
