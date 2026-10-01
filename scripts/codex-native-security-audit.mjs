#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { buildSecurityAuditScope } from "../.github/scripts/security-secrets-audit-scope.mjs";
import { createNativeCandidateSnapshot } from "./codex-native-merge-sandbox.mjs";
import { nativeGit } from "./codex-native-git-worktree.mjs";
import { publicMainSha } from "./codex-native-scheduled-source.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPOSITORY = "jubenitogarcia/skincos";
const RECEIPTS = path.join(os.homedir(), ".local/state/skincos-native-security-audit");
const TOOLS = path.join(os.homedir(), ".local/share/skincos-native-security-tools/current");
const REQUIRED_VERSIONS = Object.freeze({ gitleaks: "8.30.1", trivy: "0.74.0", "pip-audit": "2.10.1", bandit: "1.9.4", semgrep: "1.178.0" });
const BANDIT_PATHS = ["backend/config", "backend/libs", "backend/apps/automations/sales_chart_messenger", "backend/tools/scripts", "backend/apps/agent-zero"];
const SHA = /^[0-9a-f]{40}$/;

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) {
    throw new Error("native security report custody is invalid");
  }
  return directory;
}

function savePrivate(file, value) {
  fs.writeFileSync(file, value, { mode: 0o600, flag: "wx" });
  return crypto.createHash("sha256").update(value).digest("hex");
}

function gitIn(root, ...args) {
  if (path.resolve(root) === ROOT) return nativeGit(root, ...args);
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH || "/usr/bin:/bin", HOME: "/tmp", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
}

function readExceptions(root, relative, fields, today) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`security exception policy missing: ${relative}`);
  return fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((line, index) => {
    const value = line.trim();
    if (!value || value.startsWith("#")) return [];
    const parts = value.split(",").map((part) => part.trim());
    if (parts.length < fields || parts.slice(0, fields).some((part) => !part)) {
      throw new Error(`invalid security exception row at ${relative}:${index + 1}`);
    }
    const expires = parts[fields - 1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || Number.isNaN(Date.parse(`${expires}T00:00:00Z`))) {
      throw new Error(`invalid security exception expiry at ${relative}:${index + 1}`);
    }
    if (expires < today) throw new Error(`expired security exception at ${relative}:${index + 1}`);
    return [parts.slice(0, fields)];
  });
}

export function weeklySecurityPlan(root = ROOT, today = new Date().toISOString().slice(0, 10)) {
  const scope = buildSecurityAuditScope({
    eventName: "schedule", riskReport: { classification_status: "ok", risk: "low", security_sensitive: false }, changedFiles: [],
  });
  if (["fullScan", "npmAudit", "trivy", "pipAudit", "bandit", "semgrep"].some((field) => scope[field] !== true)) {
    throw new Error("weekly security scope omitted a required scan");
  }
  const requirements = gitIn(root, "ls-files", "-z").split("\0").filter((file) => /(^|\/)requirements(?:\.unified)?\.txt$/.test(file));
  if (!requirements.length) throw new Error("weekly security audit found no tracked requirements files");
  const vulnExceptions = readExceptions(root, ".github/security/pip-audit-vuln-exceptions.csv", 2, today);
  const pathExceptions = readExceptions(root, ".github/security/pip-audit-path-exceptions.csv", 2, today);
  const banditExceptions = readExceptions(root, ".github/security/bandit-exceptions.csv", 3, today);
  const tracked = new Set(gitIn(root, "ls-files", "-z").split("\0").filter(Boolean));
  for (const [file] of pathExceptions) if (!tracked.has(file)) throw new Error(`pip-audit path exception no longer names a tracked file: ${file}`);
  const excluded = new Set(pathExceptions.map(([file]) => file));
  const selectedRequirements = requirements.filter((file) => !excluded.has(file));
  if (!selectedRequirements.length) throw new Error("all tracked requirements files were excluded from pip-audit");
  for (const file of [".gitleaks.toml", ".github/security/pip-audit-build-constraints.txt"]) {
    if (!tracked.has(file)) throw new Error(`security policy file is not tracked: ${file}`);
  }
  return { scope, requirements: selectedRequirements, skippedRequirements: requirements.filter((file) => excluded.has(file)), vulnExceptions, banditExceptions, scanners: REQUIRED_VERSIONS };
}

function liveMainSha() {
  return publicMainSha();
}

function installedVersion(binary, args, version, env = process.env) {
  const result = spawnSync(binary, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024, env });
  if (result.error || result.status !== 0 || !String(result.stdout || result.stderr).includes(version)) {
    throw new Error(`pinned security scanner is missing or has the wrong version: ${path.basename(binary)} ${version}`);
  }
}

function assertTools() {
  const resolved = fs.realpathSync(TOOLS);
  if (!resolved.startsWith(`${path.dirname(TOOLS)}${path.sep}`)) throw new Error("native security tools resolved outside their approved custody");
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o022)) {
    throw new Error("native security tools are not in an admin-owned read-only bind source");
  }
  installedVersion(path.join(resolved, "bin/gitleaks"), ["version"], REQUIRED_VERSIONS.gitleaks);
  installedVersion(path.join(resolved, "bin/trivy"), ["--version"], REQUIRED_VERSIONS.trivy);
  for (const [name, moduleName] of [["pip-audit", "pip_audit"], ["bandit", "bandit"]]) {
    installedVersion("python3", ["-m", moduleName, "--version"], REQUIRED_VERSIONS[name], { ...process.env, PYTHONPATH: path.join(resolved, "lib/python3.12/site-packages") });
  }
  installedVersion(path.join(resolved, "bin/semgrep"), ["--version"], REQUIRED_VERSIONS.semgrep, {
    ...process.env, PATH: `${path.join(resolved, "bin")}:${process.env.PATH || "/usr/bin:/bin"}`,
    PYTHONPATH: path.join(resolved, "lib/python3.12/site-packages"),
  });
  return resolved;
}

function isolatedScan({ source, toolsRoot, executable, args, label, online, reportDir, accepted = [0] }) {
  const unit = `skincos-native-security-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
  const environment = [
    "PATH=/run/tools/bin:/usr/local/bin:/usr/bin:/bin", "HOME=/tmp", "XDG_CONFIG_HOME=/tmp/config", "CI=1",
    "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=safe.directory", "GIT_CONFIG_VALUE_0=/run/candidate",
    "PYTHONPATH=/run/tools/lib/python3.12/site-packages", "PIP_BUILD_CONSTRAINT=/run/candidate/.github/security/pip-audit-build-constraints.txt",
    "SEMGREP_APP_TOKEN=",
  ];
  const command = [
    "-n", "systemd-run", "--wait", "--collect", "--pipe", "--quiet", `--unit=${unit}`,
    "-p", "DynamicUser=yes", "-p", "PrivateTmp=yes", "-p", "ProtectHome=yes", "-p", "ProtectSystem=strict",
    "-p", `InaccessiblePaths=${online ? "/mnt/c /mnt/wslg" : "/mnt"} /etc/skincos /var/lib /var/log /opt/skincos /run/credentials`,
    "-p", "NoNewPrivileges=yes", "-p", "CapabilityBoundingSet=", "-p", "ProtectProc=invisible",
    "-p", "ProtectKernelTunables=yes", "-p", "ProtectControlGroups=yes", "-p", "ProtectKernelModules=yes",
    "-p", "RestrictSUIDSGID=yes", "-p", "LockPersonality=yes", "-p", "RuntimeMaxSec=45min", "-p", "MemoryMax=4G", "-p", "TasksMax=128",
    "-p", `BindReadOnlyPaths=${source}:/run/candidate`, "-p", `BindReadOnlyPaths=${toolsRoot}:/run/tools`, "-p", "WorkingDirectory=/run/candidate",
  ];
  if (!online) command.push("-p", "PrivateNetwork=yes");
  command.push("/usr/bin/env", "-i", ...environment, executable, ...args);
  const result = spawnSync("sudo", command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024, timeout: 46 * 60_000 });
  const basename = `${label.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}-${crypto.createHash("sha256").update(label).digest("hex").slice(0, 8)}`;
  const stdout = path.join(reportDir, `${basename}.stdout`);
  const stderr = path.join(reportDir, `${basename}.stderr`);
  const outputDigest = savePrivate(stdout, String(result.stdout || ""));
  savePrivate(stderr, String(result.stderr || ""));
  return { label, status: result.error ? "failed" : accepted.includes(result.status) ? "passed" : "failed", exitCode: result.status, outputDigest, stdout, stderr, error: result.error?.code || null };
}

export function scannerJson(raw) {
  const start = String(raw).indexOf("{");
  if (start < 0) throw new Error("scanner emitted no JSON object");
  const report = JSON.parse(String(raw).slice(start));
  if (!report || Array.isArray(report) || typeof report !== "object") throw new Error("scanner JSON is not an object");
  return report;
}

function run({ requireMain = true, candidateRoot = ROOT } = {}) {
  if (process.platform !== "linux") throw new Error("weekly security audit requires native Ubuntu/Linux");
  const sha = nativeGit(candidateRoot, "rev-parse", "HEAD");
  if (nativeGit(candidateRoot, "status", "--porcelain", "--untracked-files=normal")) throw new Error("weekly security audit requires a clean checkout");
  if (requireMain && sha !== liveMainSha()) throw new Error("weekly security audit requires the exact live main SHA");
  const toolsRoot = assertTools();
  const snapshot = createNativeCandidateSnapshot({ candidateRoot, headSha: sha });
  const reportDir = privateDirectory(path.join(privateDirectory(RECEIPTS), `${sha}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`));
  const receipt = { schemaVersion: 1, kind: "skincos-native-weekly-security-audit", mode: requireMain ? "live-main" : "rehearsal", sourceSha: sha, startedAt: new Date().toISOString(), scans: [], status: "running" };
  try {
    if (gitIn(snapshot.source, "rev-parse", "--is-shallow-repository") !== "false") throw new Error("weekly security snapshot has incomplete Git history");
    const plan = weeklySecurityPlan(snapshot.source);
    const scan = (label, executable, args, online = true, accepted = [0]) => {
      const result = isolatedScan({ source: snapshot.source, toolsRoot, executable, args, label, online, reportDir, accepted });
      receipt.scans.push(result);
      process.stdout.write(`${label}: ${result.status}\n`);
      return result;
    };
    scan("gitleaks-history", "/run/tools/bin/gitleaks", ["git", "--redact", "--exit-code=2", "--config", ".gitleaks.toml", "--log-opts=HEAD", "--report-format=json", "--report-path=-", "."], false);
    scan("gitleaks-tree", "/run/tools/bin/gitleaks", ["dir", "--redact", "--exit-code=2", "--config", ".gitleaks.toml", "--report-format=json", "--report-path=-", "."], false);
    for (const directory of [".", "website", "workforce/timekeeping"]) {
      if (fs.existsSync(path.join(snapshot.source, directory, "package-lock.json"))) {
        scan(`npm-${directory}`, "node", [".github/scripts/npm-audit-gate.mjs", directory]);
      }
    }
    if (fs.existsSync(path.join(snapshot.source, "backend/pnpm-lock.yaml"))) {
      scan("trivy-backend", "/run/tools/bin/trivy", ["fs", "--scanners", "vuln", "--severity", "HIGH,CRITICAL", "--exit-code", "1", "--ignore-unfixed=false", "--format", "json", "backend/pnpm-lock.yaml"]);
    }
    for (const requirement of plan.requirements) {
      scan(`pip-${requirement}`, "python3", ["-m", "pip_audit", "-r", requirement, "-f", "json", ...plan.vulnExceptions.flatMap(([id]) => ["--ignore-vuln", id])]);
    }
    const bandit = scan("bandit", "python3", ["-m", "bandit", "-r", ...BANDIT_PATHS, "-x", "backend/tools/scripts/xiaomi,backend/archive", "-f", "json", "--severity-level", "high", "--confidence-level", "high"], false, [0, 1]);
    try {
      const report = scannerJson(fs.readFileSync(bandit.stdout, "utf8"));
      if (!Array.isArray(report.results)) throw new Error("Bandit report has no results array");
      const allowed = new Set(plan.banditExceptions.map(([file, id]) => `${file}\0${id}`));
      const unresolved = (report.results || []).filter((issue) => {
        const filename = String(issue.filename || "");
        const relative = filename.startsWith("/run/candidate/") ? filename.slice("/run/candidate/".length) : filename;
        return !allowed.has(`${relative}\0${issue.test_id}`);
      });
      if (unresolved.length || ![0, 1].includes(bandit.exitCode)) bandit.status = "failed";
      bandit.findingCount = unresolved.length;
    } catch { bandit.status = "failed"; }
    const semgrep = scan("semgrep", "/run/tools/bin/semgrep", ["scan", "--config", "auto", "--sarif"]);
    try {
      const sarif = scannerJson(fs.readFileSync(semgrep.stdout, "utf8"));
      if (sarif.version !== "2.1.0" || !Array.isArray(sarif.runs)) semgrep.status = "failed";
    } catch { semgrep.status = "failed"; }
    if (nativeGit(candidateRoot, "rev-parse", "HEAD") !== sha || (requireMain && sha !== liveMainSha())) throw new Error("source changed during weekly security audit");
    receipt.status = receipt.scans.every((result) => result.status === "passed") ? "local-passed-sarif-publication-pending" : "failed";
    receipt.completedAt = new Date().toISOString();
    savePrivate(path.join(reportDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    if (receipt.status !== "local-passed-sarif-publication-pending") throw new Error(`weekly security audit failed; private reports: ${reportDir}`);
    return { status: receipt.status, sourceSha: sha, scans: receipt.scans.length, reportDir };
  } catch (error) {
    if (receipt.status === "running") {
      receipt.status = "failed";
      receipt.failure = String(error?.message || error).slice(0, 300);
      receipt.completedAt = new Date().toISOString();
      savePrivate(path.join(reportDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    }
    throw error;
  } finally {
    if (!/^\/var\/tmp\/skincos-native-gate-[A-Za-z0-9]+$/.test(snapshot.temporaryRoot)) throw new Error("security snapshot cleanup target is invalid");
    fs.rmSync(snapshot.temporaryRoot, { recursive: true, force: true });
  }
}

function preflight() {
  if (process.platform !== "linux") throw new Error("native security preflight requires Ubuntu/Linux");
  if (nativeGit(ROOT, "status", "--porcelain", "--untracked-files=normal")) throw new Error("native security preflight requires a clean checkout");
  const toolsRoot = assertTools();
  const snapshot = createNativeCandidateSnapshot({ candidateRoot: ROOT, headSha: nativeGit(ROOT, "rev-parse", "HEAD") });
  const reportDir = privateDirectory(path.join(privateDirectory(RECEIPTS), `preflight-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`));
  try {
    const plan = weeklySecurityPlan(snapshot.source);
    const checks = [
      isolatedScan({ source: snapshot.source, toolsRoot, executable: "/run/tools/bin/gitleaks", args: ["version"], label: "gitleaks-version", online: false, reportDir }),
      isolatedScan({ source: snapshot.source, toolsRoot, executable: "/run/tools/bin/trivy", args: ["--version"], label: "trivy-version", online: false, reportDir }),
      isolatedScan({ source: snapshot.source, toolsRoot, executable: "/run/tools/bin/semgrep", args: ["--version"], label: "semgrep-version", online: false, reportDir }),
    ];
    if (checks.some((check) => check.status !== "passed")) throw new Error(`native scanner sandbox preflight failed; private reports: ${reportDir}`);
    return { status: "passed", sourceSha: nativeGit(ROOT, "rev-parse", "HEAD"), scannerCount: Object.keys(plan.scanners).length, requirements: plan.requirements.length, privateReports: reportDir };
  } finally {
    if (!/^\/var\/tmp\/skincos-native-gate-[A-Za-z0-9]+$/.test(snapshot.temporaryRoot)) throw new Error("security preflight snapshot cleanup target is invalid");
    fs.rmSync(snapshot.temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    const mode = process.argv[2];
    if (mode === "plan" && process.argv.length === 3) {
      const plan = weeklySecurityPlan();
      process.stdout.write(`${JSON.stringify({ scanners: plan.scanners, requirements: plan.requirements.length, skippedRequirements: plan.skippedRequirements.length, fullScan: plan.scope.fullScan }, null, 2)}\n`);
    } else if (mode === "preflight" && process.argv.length === 3) {
      process.stdout.write(`${JSON.stringify(preflight(), null, 2)}\n`);
    } else if (["run", "rehearsal"].includes(mode) && [3, 5].includes(process.argv.length)) {
      const candidateRoot = process.argv.length === 5 && process.argv[3] === "--candidate" ? process.argv[4] : ROOT;
      if (process.argv.length === 5 && (mode !== "run" || process.argv[3] !== "--candidate")) throw new Error("candidate override requires run mode");
      process.stdout.write(`${JSON.stringify(run({ requireMain: mode === "run", candidateRoot }), null, 2)}\n`);
    } else throw new Error("mode must be plan, preflight, rehearsal or run");
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
