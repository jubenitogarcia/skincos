#!/usr/bin/env node

import fs from "node:fs";

const RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);
const FULL_SCAN_EVENTS = new Set(["push", "schedule", "workflow_dispatch"]);

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function readLines(file) {
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().replaceAll("\\", "/"))
    .filter(Boolean);
}

function normalizeFiles(files) {
  return [...new Set(files.map((file) => file.replaceAll("\\", "/").replace(/^\.\//, "")))].sort();
}

function matches(files, pattern) {
  return files.some((file) => pattern.test(file));
}

const npmManifest = /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json)$/;
const dependencyManifest = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/;
const pythonManifest = /(^|\/)(requirements(?:\.[^/]+)?\.txt|requirements\.unified\.txt|pyproject\.toml|Pipfile(?:\.lock)?|poetry\.lock|uv\.lock|setup\.py|setup\.cfg)$/;
const pythonSource = /\.py$/;
const semgrepSource = /\.(?:c|cc|cpp|cxx|go|java|js|jsx|mjs|cjs|php|py|rb|rs|swift|ts|tsx)$/;

export function buildSecurityAuditScope({ eventName, riskReport, changedFiles }) {
  if (!riskReport || typeof riskReport !== "object" || Array.isArray(riskReport)) {
    throw new Error("Canonical risk classification report is required");
  }
  if (riskReport.classification_status !== "ok") {
    throw new Error(`Canonical risk classification is not valid: ${riskReport.classification_status ?? "missing status"}`);
  }
  const { risk, security_sensitive: securitySensitive } = riskReport;
  if (!RISK_LEVELS.has(risk)) throw new Error(`Unsupported canonical risk '${risk}'`);
  if (typeof securitySensitive !== "boolean") {
    throw new Error("Canonical risk classification is missing security_sensitive");
  }
  const files = normalizeFiles(changedFiles);
  const securitySensitiveChanged = securitySensitive;
  const fullScan = FULL_SCAN_EVENTS.has(eventName)
    || risk === "high"
    || risk === "critical"
    || securitySensitiveChanged;

  const scope = {
    schemaVersion: 2,
    eventName,
    risk,
    classificationStatus: riskReport.classification_status,
    changedFiles: files,
    securitySensitiveChanged,
    fullScan,
    npmAudit: fullScan || matches(files, npmManifest),
    trivy: fullScan || matches(files, dependencyManifest),
    pipAudit: fullScan || matches(files, pythonManifest),
    bandit: fullScan || matches(files, pythonSource),
    semgrep: fullScan || matches(files, semgrepSource),
  };
  return scope;
}

function writeOutputs(scope) {
  const output = argument("--output");
  if (output) fs.writeFileSync(output, `${JSON.stringify(scope, null, 2)}\n`);
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = [
    ["risk", scope.risk],
    ["security_sensitive_changed", scope.securitySensitiveChanged],
    ["full_scan", scope.fullScan],
    ["npm_audit", scope.npmAudit],
    ["trivy", scope.trivy],
    ["pip_audit", scope.pipAudit],
    ["bandit", scope.bandit],
    ["semgrep", scope.semgrep],
  ];
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
}

function main() {
  const riskReportPath = argument("--risk-report");
  const changedFilesPath = argument("--changed-files");
  if (!riskReportPath || !changedFilesPath) throw new Error("--risk-report and --changed-files are required");
  const riskReport = JSON.parse(fs.readFileSync(riskReportPath, "utf8"));
  const scope = buildSecurityAuditScope({
    eventName: argument("--event", process.env.GITHUB_EVENT_NAME || ""),
    riskReport,
    changedFiles: readLines(changedFilesPath),
  });
  writeOutputs(scope);
}

if (process.argv[1] && process.argv[1].endsWith("security-secrets-audit-scope.mjs")) main();
