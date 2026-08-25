#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { matchesAny } from "../../scripts/codex-autonomy-lib.mjs";

const RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);
const DOMAIN_NAMES = ["ponto", "influencer", "cloudflare", "staging", "finance"];

export const VALIDATION_COMMANDS = Object.freeze({
  minimum: Object.freeze([
    "node .github/scripts/validate-github-governance.mjs",
    "node .github/scripts/validate-domain-boundaries.mjs",
  ]),
  global: Object.freeze([
    "node .github/scripts/validate-architecture.mjs",
    "node .github/scripts/validate-github-repository-transfer.mjs",
    "node .github/scripts/validate-deploy-topology.mjs",
    "node .github/scripts/validate-dependency-closures.mjs",
    "node --test .github/scripts/validate-dependency-closures.test.mjs",
    "node .github/scripts/validate-progressive-release.mjs",
    "node .github/scripts/validate-module-catalog.mjs && node .github/scripts/validate-module-maturity.mjs",
  ]),
  ponto: Object.freeze([
    "node --test .github/scripts/ponto-core-baseline-publisher.test.mjs",
    "node --test .github/scripts/ponto-core-staging-precondition.test.mjs",
    "node --test .github/scripts/ponto-cancelled-core-before-mutation.test.mjs .github/scripts/ponto-automatic-rollback-safety.test.mjs",
  ]),
  influencer: Object.freeze([
    "node --test social/influencer-intelligence/tests/*.test.mjs",
  ]),
  cloudflare: Object.freeze([
    "node .github/scripts/validate-cloudflare-single-writer.mjs",
    "node --test .github/scripts/validate-cloudflare-single-writer.test.mjs",
  ]),
  staging: Object.freeze([
    "node .github/scripts/validate-staging-manifest.mjs",
    "node .github/scripts/validate-staging-scripts.mjs",
    "node .github/scripts/validate-staging-postgres.mjs",
  ]),
  finance: Object.freeze([
    "node .github/scripts/validate-finance-canary-policy.mjs",
  ]),
});

const GLOBAL_PATTERNS = Object.freeze([
  ".github/governance/**",
  ".github/scripts/architecture-governance.mjs",
  ".github/scripts/validate-architecture.mjs",
  ".github/scripts/validate-dependency-closures.mjs",
  ".github/scripts/validate-module-catalog.mjs",
  ".github/scripts/validate-module-maturity.mjs",
  ".github/scripts/validate-domain-boundaries.mjs",
  ".github/workflows/architecture-governance.yml",
  "docs/architecture/**",
  "shared/**",
  "platform/cloudflare/**",
  "ops/governance/**",
  "ops/codex/**",
  "scripts/catalog.json",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "**/package.json",
  "**/package-lock.json",
]);

const DOMAIN_PATTERNS = Object.freeze({
  ponto: Object.freeze([
    "workforce/timekeeping/**",
    "crm/console/Ponto*",
    "crm/console/**/*ponto*",
    "crm/api/**/*ponto*",
    ".github/workflows/ponto-*.yml",
    ".github/workflows/timekeeping-*.yml",
    ".github/scripts/ponto-*",
    "shared/identity-contract/**",
    "shared/identity-runtime/**",
    "shared/module-availability/**",
  ]),
  influencer: Object.freeze([
    "social/influencer-intelligence/**",
    "crm/console/**/*influencer-intelligence*",
    "crm/console/InfluencerIntelligence*",
    "crm/console/influencerIntelligence*",
    "ops/runtime/units/influencer-intelligence*",
    "scripts/runtime/*influencer-intelligence*",
    "scripts/staging/influencer-intelligence*",
    ".github/workflows/influencer-intelligence-*.yml",
  ]),
  cloudflare: Object.freeze([
    "platform/cloudflare/**",
    ".github/scripts/validate-cloudflare-*",
    ".github/workflows/cloudflare-*.yml",
    "**/wrangler*.toml",
    "shared/service-adapters/cloudflare-service-binding.js",
    "backend/scripts/cloudflare-*",
    "ops/runtime/units/cloudflare-*",
  ]),
  staging: Object.freeze([
    "platform/staging/**",
    "scripts/staging/**",
    ".github/scripts/validate-staging-*",
    ".github/workflows/*staging*.yml",
    "ops/module-governance/*staging*",
    "crm/api/**/*staging*",
    "crm/console/**/*staging*",
    "docs/staging.md",
    "docs/runbooks/*staging*",
  ]),
  finance: Object.freeze([
    "finance/**",
    "crm/console/**/*finance*",
    "crm/console/Finance*",
    ".github/scripts/validate-finance-*",
    ".github/workflows/finance-*.yml",
    "ops/module-governance/finance-*",
    "docs/architecture/finance-*.md",
    "shared/finance-contracts/**",
  ]),
});

const SHARED_CONTRACT_DOMAINS = Object.freeze([
  { patterns: ["shared/finance-contracts/**"], domains: ["finance"] },
  { patterns: ["shared/service-adapters/cloudflare-service-binding.js"], domains: ["cloudflare", "finance"] },
  { patterns: ["shared/identity-contract/**", "shared/identity-runtime/**"], domains: ["ponto", "staging"] },
  { patterns: ["shared/module-availability/**"], domains: ["ponto", "staging"] },
  { patterns: ["shared/observability/**"], domains: ["ponto", "staging", "finance"] },
  { patterns: ["shared/influencer-intelligence/**", "shared/social/**"], domains: ["influencer"] },
  { patterns: ["shared/module-sdk/**", "shared/resilience/**"], domains: DOMAIN_NAMES },
]);

const KNOWN_SCOPE_PATTERNS = Object.freeze([
  ".github/**",
  "scripts/**",
  "ops/**",
  "docs/**",
  "shared/**",
  "crm/**",
  "workforce/**",
  "finance/**",
  "social/**",
  "platform/**",
  "api/**",
  "website/**",
  "booking/**",
  "ads/**",
  "backend/**",
  "db/**",
  "identity/**",
  "inventory/**",
  "integration/**",
  "messaging/**",
  "service/**",
  "tools/**",
  "**/*.md",
  "**/*.json",
  "**/*.yml",
  "**/*.yaml",
]);

function normalizePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function hasMatch(files, patterns) {
  return files.some((file) => matchesAny(file, patterns));
}

function assertClassifierReport(report) {
  if (!report || typeof report !== "object") throw new Error("classifier report is required");
  if (!RISK_LEVELS.has(report.risk)) throw new Error("classifier report has an invalid risk");
  if (!Array.isArray(report.affectedSurfaces)) throw new Error("classifier report must include affectedSurfaces");
  if (!Array.isArray(report.pathClassifications)) throw new Error("classifier report must include pathClassifications");
  for (const entry of report.pathClassifications) {
    if (!entry || typeof entry.file !== "string" || !entry.file.trim()) {
      throw new Error("classifier report contains an invalid path classification");
    }
  }
}

function fullPlan(reason, risk = "critical") {
  const jobs = ["minimum", "global", ...DOMAIN_NAMES];
  return {
    schemaVersion: 1,
    consumer: "codex-risk-classifier",
    risk,
    full: true,
    globalClosure: true,
    failClosed: true,
    reasons: [reason],
    unknownFiles: [],
    jobs,
    commands: Object.fromEntries(jobs.map((job) => [job, VALIDATION_COMMANDS[job]])),
    metrics: { validationCommands: jobs.reduce((count, job) => count + VALIDATION_COMMANDS[job].length, 0) },
  };
}

export function buildFullArchitectureGovernancePlan(reason = "manual or scheduled execution") {
  return fullPlan(reason);
}

export function buildArchitectureGovernancePlan(report, { forceFull = false } = {}) {
  assertClassifierReport(report);
  const files = report.pathClassifications.map((entry) => normalizePath(entry.file));
  const riskForcesFull = report.risk === "high" || report.risk === "critical";
  const full = forceFull || riskForcesFull;
  const reasons = [];
  if (forceFull) reasons.push("manual or scheduled execution");
  if (riskForcesFull) reasons.push(`classifier risk is ${report.risk}`);

  const classifierSignalsGlobal = new Set(report.affectedSurfaces).has("codex-baseline")
    || new Set(report.affectedSurfaces).has("github-governance");
  const globalClosure = full || classifierSignalsGlobal || hasMatch(files, GLOBAL_PATTERNS);
  if (classifierSignalsGlobal) reasons.push("classifier marked a shared governance surface");
  if (hasMatch(files, GLOBAL_PATTERNS)) reasons.push("architecture, governance, catalog or dependency input changed");

  const unknownFiles = files.filter((file) => !hasMatch([file], KNOWN_SCOPE_PATTERNS));
  const unknownSharedFiles = files.filter((file) => matchesAny(file, ["shared/**"])
    && !SHARED_CONTRACT_DOMAINS.some((entry) => matchesAny(file, entry.patterns)));
  const failClosedForUnknown = unknownFiles.length > 0 || unknownSharedFiles.length > 0;
  if (unknownFiles.length > 0) reasons.push("unknown path scope requires global closure");
  if (unknownSharedFiles.length > 0) reasons.push("unknown shared contract requires every domain gate");

  const selectedDomains = new Set();
  for (const domain of DOMAIN_NAMES) {
    if (hasMatch(files, DOMAIN_PATTERNS[domain])) selectedDomains.add(domain);
  }
  for (const contract of SHARED_CONTRACT_DOMAINS) {
    if (hasMatch(files, contract.patterns)) contract.domains.forEach((domain) => selectedDomains.add(domain));
  }

  const runAllDomains = full || failClosedForUnknown || unknownSharedFiles.length > 0;
  if (runAllDomains) DOMAIN_NAMES.forEach((domain) => selectedDomains.add(domain));
  const jobs = ["minimum"];
  if (globalClosure || failClosedForUnknown) jobs.push("global");
  for (const domain of DOMAIN_NAMES) if (selectedDomains.has(domain)) jobs.push(domain);

  return {
    schemaVersion: 1,
    consumer: "codex-risk-classifier",
    risk: report.risk,
    full: runAllDomains,
    globalClosure: globalClosure || failClosedForUnknown,
    failClosed: true,
    reasons,
    unknownFiles,
    jobs,
    commands: Object.fromEntries(jobs.map((job) => [job, VALIDATION_COMMANDS[job]])),
    metrics: { validationCommands: jobs.reduce((count, job) => count + VALIDATION_COMMANDS[job].length, 0) },
  };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function writeGitHubOutputs(plan) {
  if (!process.env.GITHUB_OUTPUT) return;
  const output = [
    ["full", plan.full],
    ["global", plan.jobs.includes("global")],
    ...DOMAIN_NAMES.map((domain) => [domain, plan.jobs.includes(domain)]),
    ["minimum", plan.jobs.includes("minimum")],
    ["validation_commands", plan.metrics.validationCommands],
  ];
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${output.map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outputPath = argumentValue("--output");
  const reportPath = argumentValue("--report");
  const plan = process.argv.includes("--full")
    ? buildFullArchitectureGovernancePlan()
    : buildArchitectureGovernancePlan(JSON.parse(fs.readFileSync(path.resolve(reportPath), "utf8")));
  const serialized = `${JSON.stringify(plan, null, 2)}\n`;
  if (outputPath) fs.writeFileSync(path.resolve(outputPath), serialized);
  else process.stdout.write(serialized);
  writeGitHubOutputs(plan);
}
