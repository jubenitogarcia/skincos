import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const policy = JSON.parse(read(".github/governance/progressive-release-policy.json"));
const catalog = JSON.parse(read("platform/deploy/operational-units.json"));
const failures = [];
const fail = (message) => failures.push(message);

if (policy.schemaVersion !== 1 || policy.sourceBranch !== "main") fail("policy must use main as its only release source");
if (JSON.stringify(policy.stages) !== JSON.stringify(["preview", "staging", "pilot", "canary", "production"])) fail("policy stages must be preview, staging, pilot, canary, production in order");
for (const [stage, predecessor] of Object.entries({ staging: "preview", pilot: "staging", canary: "pilot", production: "canary" })) {
  if (policy.stagePredecessor?.[stage] !== predecessor) fail(`${stage} must require ${predecessor} evidence`);
}
for (const [unit, control] of Object.entries(policy.criticalUnits ?? {})) {
  if (!catalog.units.some((entry) => entry.id === unit)) fail(`${unit} is not in the operational-unit catalog`);
  for (const key of ["featureFlag", "killSwitch", "rollback", "pilotCanary"]) if (!control[key] || typeof control[key] !== "string") fail(`${unit} must declare ${key}`);
}
const candidate = read(".github/workflows/prepare-release-candidate.yml");
for (const required of ["branches: [main]", "git merge-base --is-ancestor", "git archive --format=tar.gz", "sourceArchiveSha256", "release-source-${{ steps.release.outputs.source_sha }}"]) {
  if (!candidate.includes(required)) fail(`release candidate workflow is missing ${required}`);
}
const gate = read(".github/workflows/promotion-gate.yml");
if (!gate.includes("fetch-depth: 0")) fail("promotion gate must fetch complete main history before validating an immutable rollback SHA");
for (const required of ["release_sha", "Verify predecessor evidence", "promotion-evidence.mjs verify", "source_sha"]) if (!gate.includes(required)) fail(`immutable promotion gate is missing ${required}`);
if (failures.length) {
  for (const message of failures) process.stderr.write(`progressive release validation failed: ${message}\n`);
  process.exitCode = 1;
} else process.stdout.write("Progressive release policy validation OK.\n");
