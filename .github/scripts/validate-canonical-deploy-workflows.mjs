import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowsDirectory = path.join(root, ".github", "workflows");
const failures = [];
const fail = (message) => failures.push(message);

const canonical = new Map([
  ["deploy-insumos-worker.yml", "deploy-core-workers-${{ github.ref_name }}"],
  ["deploy-crm-pages.yml", "deploy-crm-pages-${{ github.ref_name }}"],
  ["deploy-timekeeping.yml", "deploy-timekeeping-${{ inputs.target }}"],
  ["deploy-escala-api.yml", "deploy-escala-api-${{ github.event_name == 'workflow_dispatch' && inputs.target || github.ref_name == 'main' && 'production' || 'staging' }}"],
  ["deploy-social-publisher-worker.yml", "deploy-social-publisher-production"],
  ["deploy-meta-ads-report-worker.yml", "deploy-meta-ads-report-production"],
  ["deploy-website-cloudflare.yml", "deploy-website-production"],
]);

const retired = [
  "cloudflare-pages-sync-ponto.yml",
  "cloudflare-pages-sync-escala.yml",
  "cloudflare-pages-sync-meta-ads-report-secret.yml",
  "cloudflare-sync-integrations-encryption-secret.yml",
  "cloudflare-workers-sync-ponto-secrets.yml",
  "deploy-core-workers.yml",
  "deploy-core-workers-reconcile.yml",
  "deploy-workers-reconcile.yml",
  "deploy-workers-after-automerge.yml",
  "dispatch-after-automerge-fallback.yml",
  "deploy-crm-api.yml",
  "deploy-crm-pages-after-automerge.yml",
  "deploy-crm-pages-reconcile.yml",
  "deploy-escala-api-reconcile.yml",
  "deploy-social-publisher-worker-reconcile.yml",
];

for (const [workflow, group] of canonical) {
  const filename = path.join(workflowsDirectory, workflow);
  if (!fs.existsSync(filename)) {
    fail(`missing canonical workflow ${workflow}`);
    continue;
  }
  const source = fs.readFileSync(filename, "utf8");
  if (!source.includes(`group: ${group}`)) fail(`${workflow} must use concurrency group ${group}`);
  if (!/^\s*cancel-in-progress: false\s*$/m.test(source)) fail(`${workflow} must serialize queued releases`);
  if (!/^\s*environment:/m.test(source)) fail(`${workflow} must declare its GitHub Environment`);
}

for (const workflow of retired) {
  if (fs.existsSync(path.join(workflowsDirectory, workflow))) fail(`retired duplicate workflow remains: ${workflow}`);
}

const publication = /(?:\bwrangler(?:@[^\s]+)?\s+(?:pages\s+)?deploy\b|\bd1\s+migrations\s+apply\b[\s\S]{0,300}?--remote\b|\bpages\s+secret\s+(?:put|delete)\b|\bsecret\s+put\b|appleboy\/ssh-action|createWorkflowDispatch)/i;
for (const workflow of fs.readdirSync(workflowsDirectory).filter((name) => name.endsWith(".yml"))) {
  const source = fs.readFileSync(path.join(workflowsDirectory, workflow), "utf8");
  const sourceWithoutDryRuns = source.replace(/^.*wrangler.*deploy\s+--dry-run.*$/gim, "");
  if (publication.test(sourceWithoutDryRuns) && !canonical.has(workflow)) {
    fail(`${workflow} directly changes a deployable unit but is not canonical`);
  }
}

const core = fs.readFileSync(path.join(workflowsDirectory, "deploy-insumos-worker.yml"), "utf8");
const timekeeping = fs.readFileSync(path.join(workflowsDirectory, "deploy-timekeeping.yml"), "utf8");
if (!core.includes("cloudflare-workers.sh deploy")) fail("Core workflow must remain the API Worker publisher");
if (/wrangler\s+deploy[^\n]*--config\s+api\/wrangler\.toml/i.test(timekeeping)) {
  fail("Timekeeping must not publish the shared API Worker");
}

if (failures.length > 0) {
  for (const message of failures) process.stderr.write(`canonical deploy validation failed: ${message}\n`);
  process.exit(1);
}

process.stdout.write("Canonical deploy workflow validation OK.\n");
