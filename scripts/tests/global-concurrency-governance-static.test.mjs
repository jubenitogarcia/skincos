import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadPolicy, validatePolicy } from "../../.github/scripts/validate-cloudflare-single-writer.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("Cloudflare policy is valid and has one explicit writer for each active surface", () => {
  const policy = loadPolicy();
  assert.deepEqual(validatePolicy(policy), []);
  assert.equal(policy.authority.coordinationPlane, "global");
  assert.equal(policy.authority.mode, "fail-closed");
  assert.equal(policy.pagesGitIntegration.automaticDeploymentsMustBeDisabled, true);
  for (const [id, resource] of [
    ["ponto-pages-dedicated-writer", "deploy:ponto-pages:<environment>"],
    ["ponto-pages-writer", "global:ponto-pages-writer"],
    ["ponto-workers-writer", "global:ponto-workers-writer"],
    ["website-writer", "release:website"],
    ["social-publisher-writer", "global:social-publisher-writer"],
  ]) {
    assert.equal(policy.coordinationGroups.find((entry) => entry.id === id)?.resource, resource, id);
  }
  assert.equal(policy.coordinationGroups.some((entry) => entry.id.includes("crm-cloudflare")), false);
  assert.equal(policy.surfaces.some((entry) => entry.id.includes(["crm", "pages"].join("-"))), false);
});

test("Ponto Pages has a single guarded publisher and a non-mutating secret bridge", () => {
  const policy = loadPolicy();
  const surface = policy.surfaces.find((entry) => entry.id === "ponto-pages-dedicated");
  assert.deepEqual(surface?.mutationWorkflows, [".github/workflows/ponto-pages-governed-publisher.yml"]);
  const publisher = read(".github/workflows/ponto-pages-governed-publisher.yml");
  assert.match(publisher, /group: ponto-pages-governed-publisher-\$\{\{ inputs\.target \}\}/);
  assert.match(publisher, /resource: deploy:ponto-pages:\$\{\{ inputs\.target \}\}/);
  assert.match(publisher, /pages secret bulk/);
  assert.match(publisher, /pages deploy dist/);
  assert.match(publisher, /ponto-pages-publish-receipt-/);
  const bridge = read(".github/workflows/ponto-pages-secret-bridge.yml");
  assert.match(bridge, /group: ponto-pages-governed-publisher-\$\{\{ inputs\.target \}\}/);
  assert.doesNotMatch(bridge, /wrangler[^\n]+(?:pages deploy|secret (?:put|bulk|delete))/i);
});

test("Other Cloudflare writers use their own coordination resources", () => {
  for (const [workflow, resource] of [
    [".github/workflows/deploy-escala-api.yml", "global:escala-writer"],
    [".github/workflows/deploy-meta-ads-report-worker.yml", "global:meta-ads-report-writer"],
    [".github/workflows/deploy-social-publisher-worker.yml", "global:social-publisher-writer"],
  ]) {
    const source = read(workflow);
    const escaped = resource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(escaped), workflow);
    assert.doesNotMatch(source, new RegExp(["global", "crm", "cloudflare", "writer"].join(":")));
  }
});

test("Ponto custody workflows pin the active coordination key", () => {
  for (const workflow of [
    ".github/workflows/ponto-pages-governed-publisher.yml",
    ".github/workflows/ponto-pages-secret-bridge.yml",
    ".github/workflows/cloudflare-workers-sync-ponto-secrets.yml",
    ".github/workflows/deploy-core-workers.yml",
    ".github/workflows/deploy-timekeeping.yml",
  ]) {
    const source = read(workflow);
    assert.match(source, /SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY/);
    assert.doesNotMatch(source, /SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET/);
  }
});

test("No checked-in workflow or static test points to the removed monorepo CRM tree", () => {
  const roots = [".github", "scripts", "workforce", "integration", "backend", "api"];
  const forbidden = new RegExp([
    ["crm", "console"].join("/"),
    ["deploy", "crm", "pages"].join("-"),
    ["crm", "pages"].join("-"),
    ["global", "crm", "cloudflare", "writer"].join(":"),
    ["cloudflare", "pages", "sync", "ponto"].join("-"),
  ].join("|"), "i");
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      if (entry.isDirectory()) visit(relative);
      else if (/\.(?:mjs|js|yml|yaml|ps1|sh|json|toml)$/.test(entry.name)) files.push(relative);
    }
  };
  for (const root of roots) visit(root);
  for (const relative of files) assert.doesNotMatch(read(relative), forbidden, relative);
});
