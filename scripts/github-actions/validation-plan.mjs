#!/usr/bin/env node
/**
 * Select the smallest safe GitHub Actions validation set for a repository diff.
 *
 * This intentionally lives in the repository rather than in workflow YAML so
 * the selection rules are testable, versioned, and shared by PR, push and
 * manually recovered gate runs. Unknown non-documentation paths fail closed to
 * the core validation set instead of silently avoiding a check.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { matchesAny } from "../codex-autonomy-lib.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");

const DOCUMENTATION = [
  "docs/**",
  "**/*.md",
  "ops/project-orchestration/**",
  "docs/project-state/**"
];

const CODEX = [
  ".codex/**",
  "skills/**",
  "ops/codex/**",
  "scripts/codex-*.mjs",
  "scripts/tests/codex-*.mjs",
  "scripts/codex-*.sh",
  "scripts/*codex*.ps1"
];

const GOVERNANCE = [
  ".github/workflows/**",
  ".github/scripts/**",
  ".github/governance/**",
  ".github/allowlists/**",
  ".github/security/**",
  ".github/codeql/**",
  ".gitleaks.toml",
  "scripts/github-actions/**",
  "scripts/tests/github-actions-*.mjs"
];

const CRM = ["crm/console/**", "crm/api/**"];
const WEBSITE = ["website/**", "booking/**", "modules/site-public/**"];
const BACKEND = [
  "backend/**",
  "api/**",
  "ads/**",
  "db/**",
  "finance/**",
  "identity/**",
  "integration/**",
  "inventory/**",
  "messaging/**",
  "service/**",
  "shared/**",
  "social/**"
];
const RUNTIME = ["orb/**", "platform/**", "ops/runtime/**"];
const LINT_CONFIGURATION = [
  ".github/workflows/lint-format-static.yml",
  ".github/workflows/test-coverage-quality.yml"
];
const E2E_CONFIGURATION = [
  ".github/workflows/central-e2e-smoke.yml",
  ".github/workflows/escala-ui-e2e.yml"
];
const ROOT_BUILD = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pyproject.toml",
  "requirements*.txt",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/requirements*.txt"
];
const TIMEKEEPING = [
  "workforce/timekeeping/**",
  "api/**",
  "inventory/src/worker.js",
  "inventory/tests/releaseHealth.test.mjs",
  "inventory/wrangler.toml",
  "shared/identity-runtime/**",
  "shared/module-availability/**",
  "crm/console/functions/api/ponto/**",
  "crm/console/PontoModule.tsx",
  "crm/console/crmRoleAccess.ts",
  "crm/console/moduleAvailability.ts",
  "crm/console/pontoApi.ts",
  "crm/console/pontoTypes.ts",
  "crm/console/tests/ponto*.test.ts",
  "crm/console/tests/crmRoleAccess.test.ts",
  "crm/console/tests/moduleRegistry.test.ts",
  "crm/console/scripts/ponto-staging-journey.cjs",
  "workforce/timekeeping/scripts/ponto-staging-journey-fixtures.mjs",
  ".github/workflows/timekeeping-staging-journey.yml",
  ".github/workflows/deploy-timekeeping.yml",
  ".github/workflows/deploy-core-workers.yml",
  ".github/workflows/deploy-crm-pages.yml",
  ".github/workflows/module-availability.yml",
  ".github/workflows/ponto-*.yml",
  ".github/scripts/ponto-*.mjs",
  ".github/governance/progressive-release-policy.json",
  "platform/deploy/operational-units.json",
  ".github/workflows/timekeeping-ci.yml"
];
const SECURITY = [
  "**/*auth*",
  "**/*session*",
  "**/*secret*",
  "**/*credential*",
  "**/*payment*",
  "**/*billing*",
  "**/migrations/**",
  "package-lock.json",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/requirements*.txt",
  ".github/scripts/npm-audit-gate.mjs",
  ".github/governance/progressive-release-policy.json",
  ".github/workflows/ponto-*.yml",
  ".github/scripts/ponto-*.mjs",
  "workforce/timekeeping/**"
];

function normalizePath(value) {
  const normalized = String(value ?? "").replaceAll("\\", "/");
  if (!normalized || normalized.includes("\0") || normalized.includes("\n") || normalized.includes("\r")) {
    throw new Error("changed paths must be non-empty single-line repository-relative paths");
  }
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`changed path must stay inside the repository: ${normalized}`);
  }
  return normalized;
}

function changed(files, patterns) {
  return files.some((file) => matchesAny(file, patterns));
}

function every(files, patterns) {
  return files.length > 0 && files.every((file) => matchesAny(file, patterns));
}

export function buildValidationPlan(changedFiles) {
  const files = [...new Set(changedFiles.map(normalizePath))].sort();
  const documentationOnly = every(files, DOCUMENTATION);
  const codexOnly = every(files, [...DOCUMENTATION, ...CODEX]);
  const governance = changed(files, GOVERNANCE);
  const crm = changed(files, CRM);
  const website = changed(files, WEBSITE);
  const backend = changed(files, BACKEND);
  const runtime = changed(files, RUNTIME);
  const lintConfiguration = changed(files, LINT_CONFIGURATION);
  const e2eConfiguration = changed(files, E2E_CONFIGURATION);
  const rootBuild = changed(files, ROOT_BUILD);
  const timekeeping = changed(files, TIMEKEEPING);
  const security = changed(files, SECURITY);
  const python = changed(files, ["backend/**/*.py", "backend/requirements*.txt", "**/requirements*.txt", "pyproject.toml"]);
  const classifiedExecutable = governance || crm || website || backend || runtime || rootBuild || timekeeping;
  const unknownExecutable = files.length > 0 && !documentationOnly && !codexOnly && !classifiedExecutable;
  const core = !documentationOnly && !codexOnly && (classifiedExecutable || unknownExecutable);

  const outputs = {
    run_architecture: core,
    run_ci_smoke: core && (governance || backend || runtime || rootBuild || timekeeping || unknownExecutable),
    run_lint: core,
    // A component's own workflow change exercises all of its branches before
    // it can be relied on for later selective PR runs.
    run_crm: crm || timekeeping || rootBuild || lintConfiguration || e2eConfiguration,
    run_website: website || rootBuild || lintConfiguration,
    run_backend: backend || timekeeping || rootBuild || lintConfiguration,
    run_python: python || rootBuild || lintConfiguration,
    run_e2e: crm || timekeeping || e2eConfiguration,
    run_security: security || governance || unknownExecutable,
    run_codeql: governance || crm || website || backend || runtime || rootBuild || timekeeping || unknownExecutable,
    run_timekeeping: timekeeping,
    run_windows_continuity: changed(files, CODEX)
  };

  return {
    schemaVersion: 1,
    changedFiles: files,
    classification: {
      documentationOnly,
      codexOnly,
      governance,
      crm,
      website,
      backend,
      runtime,
      lintConfiguration,
      e2eConfiguration,
      rootBuild,
      timekeeping,
      security,
      python,
      unknownExecutable
    },
    outputs,
    rationale: documentationOnly
      ? "Documentation-only changes retain diff validation without starting application suites."
      : codexOnly
        ? "Codex-only changes retain the focused and Windows continuity contracts."
        : unknownExecutable
          ? "An unclassified executable path selected the conservative core validation set."
          : "Validation was selected from the affected repository surfaces."
  };
}

function readArgument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function readRepeated(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function gitChangedFiles(base, head) {
  const output = execFileSync("git", ["diff", "--name-only", "-z", "--diff-filter=ACMR", `${base}...${head}`], {
    cwd: root,
    encoding: "buffer"
  });
  return output.toString("utf8").split("\0").filter(Boolean);
}

function resolveChangedFiles() {
  const explicit = readRepeated("--file");
  if (explicit.length) return explicit;
  const base = readArgument("--base");
  const head = readArgument("--head", "HEAD");
  if (!base) throw new Error("use --file <path> or --base <commit-ish>");
  return gitChangedFiles(base, head);
}

function writeReport(report) {
  const output = readArgument("--output");
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (output) fs.writeFileSync(path.resolve(root, output), serialized);
  else process.stdout.write(serialized);
  if (process.env.GITHUB_OUTPUT) {
    for (const [key, value] of Object.entries(report.outputs)) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value ? "true" : "false"}\n`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  writeReport(buildValidationPlan(resolveChangedFiles()));
}
