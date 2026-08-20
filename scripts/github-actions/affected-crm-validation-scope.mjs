#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifyFiles } from "../codex-autonomy-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const policy = JSON.parse(fs.readFileSync(path.join(root, "ops/codex/risk-policy.json"), "utf8"));

const WORKFLOWS = new Set([
  ".github/workflows/crm-codeql.yml",
  ".github/workflows/central-e2e-smoke.yml",
  ".github/workflows/escala-ui-e2e.yml",
]);
const BASELINE_E2E = [
  "e2e/login.spec.ts",
  "e2e/crm-header-layout.spec.ts",
  "e2e/module-shell-isolation.spec.ts",
  "e2e/accessibility/auth.a11y.spec.ts",
  "e2e/pilot/auth-pilot.spec.ts",
];
const USERS_E2E = [
  "e2e/users-module.spec.ts",
  "e2e/accessibility/users.a11y.spec.ts",
  "e2e/visual/users.visual.spec.ts",
];
const JS_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const DOC_EXTENSIONS = new Set([".md", ".mdx"]);

function normalize(file) {
  return String(file || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function hasPrefix(file, prefixes) {
  return prefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`));
}

function hasToken(file, tokens) {
  const lower = file.toLowerCase();
  return tokens.some((token) => lower.includes(token));
}

function isDocsOnly(file) {
  const extension = path.posix.extname(file).toLowerCase();
  return file === "AGENTS.md"
    || file === "CODEX_CONTEXT.md"
    || file === "TASKS.md"
    || file === "DECISIONS.md"
    || file.startsWith("docs/")
    || DOC_EXTENSIONS.has(extension);
}

function isJavaScript(file) {
  const extension = path.posix.extname(file).toLowerCase();
  return JS_EXTENSIONS.has(extension)
    || ["package.json", "package-lock.json", "npm-shrinkwrap.json"].includes(path.posix.basename(file))
    || (hasPrefix(file, [
      "crm/console", "crm/api", "website", "messaging", "orb", "api", "booking",
      "integration", "service", "social", "workforce", "shared", "platform/security",
    ]) && !isDocsOnly(file));
}

function isPython(file) {
  const extension = path.posix.extname(file).toLowerCase();
  return extension === ".py"
    || hasPrefix(file, ["backend"])
    || ["pyproject.toml", "requirements.txt", "requirements-dev.txt", "poetry.lock"].includes(path.posix.basename(file));
}

function isCrm(file) {
  return hasPrefix(file, ["crm/console", "crm/api"]);
}

function isWebsite(file) {
  return hasPrefix(file, ["website"]);
}

function isUsers(file) {
  return file === "crm/console/UsersModule.tsx"
    || file === "crm/console/teamApi.ts"
    || file === "crm/console/escalaApi.ts"
    || file.startsWith("crm/console/e2e/users-module")
    || file.startsWith("crm/console/e2e/accessibility/users.")
    || file.startsWith("crm/console/e2e/visual/users.");
}

function isEscala(file) {
  return file.startsWith("crm/console/Escala")
    || file.startsWith("crm/console/escala")
    || file.startsWith("crm/console/useEscala")
    || file.startsWith("crm/console/e2e/escala-module")
    || file.startsWith("crm/console/functions/api/escala/")
    || hasPrefix(file, ["workforce/schedule"]);
}

function isSharedOrElevated(file) {
  return hasPrefix(file, ["shared", ".github", "platform", "ops", "migrations"])
    || file === "crm/console/App.tsx"
    || file === "crm/console/AuthScreen.tsx"
    || file === "crm/console/authPolicy.ts"
    || file === "crm/console/navigation-menu.tsx"
    || file === "crm/console/ViewsManager.tsx"
    || file.startsWith("crm/console/functions/api/auth/")
    || (file.startsWith("crm/console/functions/_lib/") && hasToken(file, ["auth", "oauth"]))
    || file.startsWith("crm/console/e2e/login.")
    || file.startsWith("crm/console/e2e/crm-header-layout.")
    || file.startsWith("crm/console/e2e/module-shell-isolation.")
    || file.startsWith("crm/console/e2e/accessibility/auth.")
    || hasToken(file, ["/auth", "auth.", "authentication", "session", "permission", "secret", "credential", "migration", "rollback", "single-writer"]);
}

function isCritical(file) {
  return hasToken(file, ["irreversible", "destructive", "real-data", "production-delete", "financial-ledger", "credential-exposure"]);
}

function classify(files, { event = "pull_request" } = {}) {
  const changed = [...new Set(files.map(normalize).filter(Boolean))].sort();
  const scheduledOrManual = event === "schedule" || event === "workflow_dispatch";
  const docsOnly = changed.length > 0 && changed.every(isDocsOnly);
  const riskReport = classifyFiles(policy, changed);
  const workflowChanged = changed.some((file) => WORKFLOWS.has(file));
  const sharedOrElevated = changed.some(isSharedOrElevated);
  const critical = changed.some(isCritical) || riskReport.risk === "critical";
  const elevated = riskReport.risk === "high";
  const crm = !docsOnly && changed.some(isCrm);
  const focusedModuleChange = changed.length > 0 && changed.every((file) => isUsers(file) || isEscala(file));
  const unknownCrmChange = crm && changed.some((file) => !isUsers(file) && !isEscala(file));
  const full = scheduledOrManual || workflowChanged || sharedOrElevated || elevated || critical || unknownCrmChange;
  const js = !docsOnly && (full || changed.some(isJavaScript));
  const python = !docsOnly && (full || changed.some(isPython));
  const website = !docsOnly && (full || changed.some(isWebsite));
  const users = !full && changed.some(isUsers);
  const escala = !full && changed.some(isEscala);
  const central = !docsOnly && (full || users);
  const escalaE2e = !docsOnly && (full || escala);
  let centralTests = "";
  if (central) centralTests = full ? "__FULL__" : [...BASELINE_E2E, ...(users ? USERS_E2E : [])].join(" ");

  return {
    changed,
    risk: riskReport.risk,
    surfaces: riskReport.affectedSurfaces,
    docs_only: docsOnly,
    full,
    shared_or_elevated: sharedOrElevated || elevated || critical,
    run_js_codeql: js,
    run_python_codeql: python,
    run_crm: !docsOnly && (full || crm),
    run_website: website,
    run_central_e2e: central,
    run_users_e2e: users,
    run_escala_e2e: escalaE2e,
    central_tests: centralTests,
    reason: scheduledOrManual ? `${event}-full` : full ? "shared-or-elevated" : users ? "users-focused" : escala ? "escala-focused" : focusedModuleChange ? "focused-module" : "affected-module",
  };
}

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function isCommit(value) {
  if (!/^[0-9a-f]{40}$/i.test(value)) return false;
  try { git("cat-file", "-e", `${value}^{commit}`); return true; } catch { return false; }
}

function changedFiles() {
  const explicit = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === "--file" && process.argv[index + 1]) explicit.push(process.argv[index + 1]);
  }
  const event = process.env.GITHUB_EVENT_NAME || argument("--event", "pull_request");
  if (explicit.length || event === "schedule" || event === "workflow_dispatch") return explicit;
  const head = argument("--head", process.env.GITHUB_SHA || "HEAD");
  const candidates = [argument("--base", ""), process.env.PR_BASE_SHA || "", process.env.BEFORE_SHA || ""]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .filter(isCommit);
  let base = candidates[0];
  if (!base) {
    try { base = git("merge-base", "origin/main", head); } catch { base = git("rev-parse", `${head}^`); }
  }
  const output = git("diff", "--name-only", "--diff-filter=ACMR", `${base}...${head}`);
  return output ? output.split(/\r?\n/) : [];
}

function writeOutputs(report) {
  const entries = {
    risk: report.risk, surfaces: report.surfaces.join(","), reason: report.reason,
    docs_only: report.docs_only, full: report.full, shared_or_elevated: report.shared_or_elevated,
    run_js_codeql: report.run_js_codeql, run_python_codeql: report.run_python_codeql,
    run_crm: report.run_crm, run_website: report.run_website,
    run_central_e2e: report.run_central_e2e, run_users_e2e: report.run_users_e2e,
    run_escala_e2e: report.run_escala_e2e, central_tests: report.central_tests,
  };
  const output = process.env.GITHUB_OUTPUT;
  if (output) fs.appendFileSync(output, `${Object.entries(entries).map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
  else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME || argument("--event", "pull_request");
  writeOutputs(classify(changedFiles(), { event }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    process.stderr.write(`::error::affected validation scope failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

export { BASELINE_E2E, USERS_E2E, classify };
