import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fail = (message) => {
  process.stderr.write(`artifact promotion validation failed: ${message}\n`);
  process.exitCode = 1;
};

const registry = JSON.parse(fs.readFileSync(path.join(root, ".github/governance/release-units.json"), "utf8"));
if (registry.schemaVersion !== 1 || registry.sourceBranch !== "main") fail("release registry must use main as the only source branch");
if (JSON.stringify(registry.phases) !== JSON.stringify(["preview", "staging", "smoke", "canary", "production"])) fail("release phases must be ordered preview through production");
for (const [unit, config] of Object.entries(registry.units)) {
  if (!config.workflow || !fs.existsSync(path.join(root, ".github/workflows", config.workflow))) fail(`release unit ${unit} has no workflow`);
}

const candidate = fs.readFileSync(path.join(root, ".github/workflows/prepare-release-candidate.yml"), "utf8");
for (const required of ["branches: [main]", "git merge-base --is-ancestor", "git archive --format=tar.gz", "sourceArchiveSha256", "release-source-${{ steps.release.outputs.sha }}"]) {
  if (!candidate.includes(required)) fail(`release candidate workflow is missing ${required}`);
}
if (/\bstaging\b/.test(candidate.replace(/release-candidate/g, ""))) fail("release candidate must not use staging as a source branch");

const timekeeping = fs.readFileSync(path.join(root, ".github/workflows/deploy-timekeeping.yml"), "utf8");
for (const required of ["release_sha:", "ref: ${{ inputs.release_sha }}", "EXPECTED_SHA: ${{ inputs.release_sha }}", "git merge-base --is-ancestor"] ) {
  if (!timekeeping.includes(required)) fail(`Timekeeping promotion is missing ${required}`);
}
if (/^\s*ref:\s*main\s*$/m.test(timekeeping)) fail("Timekeeping must not silently promote the dispatch branch");

const coreWorkers = fs.readFileSync(path.join(root, ".github/workflows/deploy-insumos-worker.yml"), "utf8");
for (const required of ["release_sha:", "staging_run_id:", "ref: ${{ inputs.release_sha }}", "core-workers-staging-attestation", "git merge-base --is-ancestor"]) {
  if (!coreWorkers.includes(required)) fail(`Core Workers promotion is missing ${required}`);
}
if (/branches:\s*\[\s*main\s*,\s*staging\s*\]/.test(coreWorkers)) fail("Core Workers must not use staging as a source branch");

if (!process.exitCode) process.stdout.write("Artifact promotion validation OK.\n");
