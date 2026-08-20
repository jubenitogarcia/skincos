#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  buildClassificationFallback,
  classifyFiles,
  normalizeChangedFiles,
  parseGitNameStatus,
} from "./codex-autonomy-lib.mjs";

const root = path.resolve(import.meta.dirname, "..");
const policyPath = path.join(root, "ops/codex/risk-policy.json");
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const ZERO_SHA = /^0{40}$/;
const SOURCE_EXTENSIONS = new Set([
  ".cjs", ".css", ".html", ".js", ".jsx", ".mjs", ".scss", ".ts", ".tsx",
]);
const TEST_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const SECRET_PATTERNS = [
  /\b(?:api[_-]?key|secret|token|password|private[_-]?key)\b\s*[:=]\s*["'][^"']{8,}/i,
  /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
];

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function repeatedArgument(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function hasArgument(name) {
  return process.argv.includes(name);
}

function runGit(args, { input = undefined } = {}) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", input });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("git " + args.join(" ") + " failed (" + result.status + "): " + (result.stderr || "").trim());
  }
  return result.stdout || "";
}

function diffOutput(args) {
  return parseGitNameStatus(runGit(["diff", "--name-status", "-z", "--diff-filter=ACDMRTUXB", ...args]));
}

function parsePushRef(line) {
  const values = String(line).trim().split(/\s+/);
  if (values.length !== 4) throw new Error("pre-push ref line is invalid: " + line);
  const [localRef, localSha, remoteRef, remoteSha] = values;
  if (!/^refs\/(?:heads|tags)\//.test(localRef) || !/^refs\/(?:heads|tags)\//.test(remoteRef)) {
    throw new Error("pre-push ref names are invalid: " + line);
  }
  if (!/^[0-9a-f]{40}$/.test(localSha) || !/^[0-9a-f]{40}$/.test(remoteSha)) {
    throw new Error("pre-push ref SHAs are invalid: " + line);
  }
  return { localRef, localSha, remoteRef, remoteSha };
}

function collectPushLines(lines) {
  return lines.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(parsePushRef);
}

function collectChanges() {
  const explicitFiles = repeatedArgument("--file");
  if (explicitFiles.length) {
    return {
      changes: normalizeChangedFiles(explicitFiles.map((file) => ({ status: "M", path: file }))),
      diffSpecs: [{ label: "explicit files", args: ["HEAD", "--", ...explicitFiles] }],
      source: "explicit files",
    };
  }

  const base = argument("--base");
  const head = argument("--head", "HEAD");
  if (base) {
    const range = base + "..." + head;
    return { changes: diffOutput([range]), diffSpecs: [{ label: range, args: [range] }], source: range };
  }

  if (hasArgument("--staged")) {
    return { changes: diffOutput(["--cached"]), diffSpecs: [{ label: "staged", args: ["--cached"] }], source: "staged index" };
  }

  const pushRefs = repeatedArgument("--push-ref");
  const pushLines = pushRefs.length
    ? pushRefs.map(parsePushRef)
    : hasArgument("--push")
      ? collectPushLines(fs.readFileSync(0, "utf8"))
      : [];
  if (pushLines.length) {
    const changes = [];
    const diffSpecs = [];
    for (const ref of pushLines) {
      if (ZERO_SHA.test(ref.localSha)) continue;
      const baseRef = ZERO_SHA.test(ref.remoteSha) ? "origin/main" : ref.remoteSha;
      const range = baseRef + "..." + ref.localSha;
      changes.push(...diffOutput([range]));
      diffSpecs.push({ label: ref.remoteRef + " -> " + ref.localRef, args: [range] });
    }
    return { changes: normalizeChangedFiles(changes), diffSpecs, source: "pre-push refs" };
  }

  // Untracked trees can contain node_modules, browser caches, or local
  // evidence. They are intentionally validated only after staging; scanning
  // them here would make the manual command unexpectedly recursive.
  const changes = diffOutput(["HEAD"]);
  return { changes: normalizeChangedFiles(changes), diffSpecs: [{ label: "working tree", args: ["HEAD"] }], source: "working tree" };
}

function existingFiles(changes) {
  return [...new Set(changes.flatMap((change) => change.paths))]
    .filter((file) => fs.existsSync(path.join(root, file)));
}

function fileExtension(file) {
  return path.extname(file).toLowerCase();
}

function isTestFile(file) {
  return TEST_EXTENSIONS.has(fileExtension(file)) && /(?:^|[./])(?:test|spec)\.[^.]+$/i.test(file);
}

function relatedTests(file) {
  const extension = fileExtension(file);
  if (!TEST_EXTENSIONS.has(extension)) return [];
  const directory = path.dirname(file);
  const base = path.basename(file, extension);
  const candidates = [
    path.join(directory, base + ".test" + extension),
    path.join(directory, base + ".spec" + extension),
    path.join(directory, "__tests__", base + ".test" + extension),
    path.join(directory, "__tests__", base + ".spec" + extension),
  ];
  return candidates.filter((candidate) => fs.existsSync(path.join(root, candidate)));
}

function command(label, executable, args = []) {
  return { type: "command", label, executable, args };
}

function buildFullCommands() {
  return [
    command("architecture", "npm", ["run", "architecture:validate"]),
    command("quality:critical", "npm", ["run", "quality:critical"]),
    command("autonomy contract", "npm", ["run", "codex:autonomy:test"]),
    command("dependency closures", "npm", ["run", "codex:dependency-closures:test"]),
    command("single-writer contract", "npm", ["run", "codex:cloudflare:single-writer:test"]),
    command("concurrency contract", "npm", ["run", "codex:global-concurrency:chaos:test"]),
  ];
}

function buildVerificationPlan({ changes, diffSpecs, report, full = false }) {
  const files = changes.flatMap((change) => change.paths);
  const presentFiles = existingFiles(changes);
  const plan = [];
  if (diffSpecs.length) plan.push({ type: "diff-check", specs: diffSpecs });
  plan.push({ type: "static-parse", files: presentFiles });
  plan.push({ type: "secret-delta", specs: diffSpecs });

  const forcedFull = full || report.risk === "high" || report.risk === "critical";
  if (forcedFull) {
    plan.push(...buildFullCommands());
    plan.push({ type: "secret-full" });
    return { files, plan, lane: full ? "full" : report.risk, forcedFull };
  }

  const crmConsoleCode = files.filter((file) =>
    file.startsWith("crm/console/") && [".js", ".jsx", ".ts", ".tsx"].includes(fileExtension(file))
  );
  const websiteCode = files.filter((file) =>
    file.startsWith("website/") && [".js", ".jsx", ".ts", ".tsx"].includes(fileExtension(file))
  );
  const crmApiChanged = files.some((file) => file.startsWith("crm/api/") || file.startsWith("api/"));
  const pythonChanged = files.some((file) => fileExtension(file) === ".py");

  if (report.risk === "medium") {
    if (crmConsoleCode.length) {
      plan.push(command("CRM console lint", "npm", ["--prefix", "crm/console", "run", "lint"]));
      plan.push(command("CRM console typecheck", "npm", ["--prefix", "crm/console", "run", "typecheck"]));
      plan.push(command("CRM console affected tests", "npm", ["--prefix", "crm/console", "run", "test"]));
    }
    if (websiteCode.length) {
      plan.push(command("website lint", "npm", ["--prefix", "website", "run", "lint"]));
      plan.push(command("website affected tests", "npm", ["--prefix", "website", "run", "test"]));
      plan.push(command("website typecheck", "npm", ["--prefix", "website", "run", "typecheck"]));
    }
    if (crmApiChanged) plan.push(command("CRM API tests", "npm", ["--prefix", "crm/api", "test"]));
    if (pythonChanged) plan.push(command("Python unit tests", "python3", ["-m", "pytest", "backend/tests/unit"]));
    const changedTests = presentFiles.filter(isTestFile);
    if (changedTests.length && !crmConsoleCode.length && !websiteCode.length) {
      plan.push(command("changed Node tests", process.execPath, ["--test", ...changedTests]));
    }
    if (!crmConsoleCode.length && !websiteCode.length && !crmApiChanged && !pythonChanged && !changedTests.length) {
      plan.push(command("policy/classifier contract", "npm", ["run", "codex:autonomy:test"]));
    }
  } else if (report.risk === "low") {
    if (crmConsoleCode.length) {
      const paths = crmConsoleCode.map((file) => file.slice("crm/console/".length));
      plan.push(command("CRM console focal lint", "npm", ["--prefix", "crm/console", "exec", "--", "eslint", ...paths]));
      plan.push(command("CRM console focal typecheck", "npm", ["--prefix", "crm/console", "run", "typecheck"]));
      const tests = [...new Set(crmConsoleCode.flatMap(relatedTests))];
      if (tests.length) {
        plan.push(command("CRM console affected tests", "npm", ["--prefix", "crm/console", "exec", "--", "vitest", "run", ...tests.map((file) => file.slice("crm/console/".length))]));
      }
    }
    if (websiteCode.length) {
      const paths = websiteCode.map((file) => file.slice("website/".length));
      plan.push(command("website focal lint", "npm", ["--prefix", "website", "exec", "--", "eslint", ...paths]));
    }
  }

  return { files, plan, lane: report.risk, forcedFull };
}

function commandText(item) {
  if (item.type === "diff-check") return "git diff --check (" + item.specs.map((spec) => spec.label).join(", ") + ")";
  if (item.type === "static-parse") return "static parse (" + item.files.length + " file(s))";
  if (item.type === "secret-delta") return "delta secret scan (" + item.specs.length + " diff(s))";
  if (item.type === "secret-full") return "gitleaks detect --source .";
  return [item.executable, ...item.args].join(" ");
}

function printPlan(report, verification, source, planOnly) {
  process.stdout.write(
    "[verify] source=" + source + " risk=" + report.risk + " lane=" + verification.lane + " files=" + verification.files.length + "\n"
  );
  process.stdout.write(
    "[verify] surfaces=" + ((report.surfaces || report.affectedSurfaces || []).join(",") || "none") +
    " languages=" + ((report.languages || []).join(",") || "none") + "\n"
  );
  process.stdout.write(
    "[verify] dependencies_changed=" + report.dependencies_changed +
    " shared_contracts_changed=" + report.shared_contracts_changed +
    " production_sensitive=" + report.production_sensitive +
    " security_sensitive=" + report.security_sensitive + "\n"
  );
  for (const item of verification.plan) process.stdout.write("[verify] " + (planOnly ? "plan" : "run") + ": " + commandText(item) + "\n");
}

function commandExists(executable) {
  const result = spawnSync(executable, ["--version"], { cwd: root, stdio: "ignore" });
  return !result.error && result.status === 0;
}

function diffPatch(spec) {
  return runGit(["diff", "--no-ext-diff", "--unified=0", ...spec.args]);
}

function runDiffCheck(item) {
  for (const spec of item.specs) {
    const result = spawnSync("git", ["diff", "--check", ...spec.args], { cwd: root, stdio: "inherit" });
    if (result.status !== 0) throw new Error("git diff --check failed for " + spec.label);
  }
}

function runStaticParse(files) {
  for (const file of files) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) continue;
    if (fileExtension(file) === ".json") {
      try {
        JSON.parse(fs.readFileSync(absolute, "utf8"));
      } catch (error) {
        throw new Error("invalid JSON in " + file + ": " + error.message);
      }
    }
    if ([".js", ".mjs", ".cjs"].includes(fileExtension(file))) {
      const result = spawnSync(process.execPath, ["--check", file], { cwd: root, stdio: "inherit" });
      if (result.status !== 0) throw new Error("Node syntax check failed for " + file);
    }
  }
}

function runSecretDeltaScan(specs) {
  const patch = specs.map(diffPatch).join("\n");
  if (!patch) return;
  if (commandExists("gitleaks")) {
    const result = spawnSync("gitleaks", ["stdin", "--no-banner", "--redact"], {
      cwd: root,
      input: patch,
      encoding: "utf8",
      stdio: ["pipe", "inherit", "inherit"],
    });
    if (result.status !== 0) throw new Error("gitleaks delta scan found a possible secret");
    return;
  }
  const suspects = patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .filter((line) => SECRET_PATTERNS.some((pattern) => pattern.test(line)));
  if (suspects.length) throw new Error("delta secret fallback found a possible secret; install gitleaks for the complete local scan");
  process.stdout.write("[verify] gitleaks unavailable; deterministic delta secret fallback passed\n");
}

function runFullSecretScan() {
  if (!commandExists("gitleaks")) throw new Error("gitleaks is required for high/critical local verification; CI remains fail-closed");
  const result = spawnSync("gitleaks", ["detect", "--source", ".", "--no-banner", "--redact"], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error("full gitleaks scan failed");
}

function runCommand(item) {
  const result = spawnSync(item.executable, item.args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(item.label + " failed with exit code " + result.status);
}

function executePlan(plan) {
  for (const item of plan) {
    if (item.type === "diff-check") runDiffCheck(item);
    else if (item.type === "static-parse") runStaticParse(item.files);
    else if (item.type === "secret-delta") runSecretDeltaScan(item.specs);
    else if (item.type === "secret-full") runFullSecretScan();
    else runCommand(item);
  }
}

export { buildVerificationPlan, collectPushLines, parsePushRef };

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let exitCode = 0;
  try {
    const collected = collectChanges();
    const full = hasArgument("--full");
    if (!collected.changes.length && !full) {
      process.stdout.write("[verify] no changed files; nothing to validate\n");
      process.exit(0);
    }

    let report;
    try {
      report = classifyFiles(policy, collected.changes);
    } catch (error) {
      report = buildClassificationFallback({ policy, code: "local_classification_failed", reason: error.message });
      printPlan(report, { files: [], plan: [], lane: "critical" }, collected.source, hasArgument("--plan"));
      throw new Error("classification failed closed: " + error.message);
    }

    const verification = buildVerificationPlan({
      changes: collected.changes,
      diffSpecs: collected.diffSpecs,
      report,
      full,
    });
    const planOnly = hasArgument("--plan");
    printPlan(report, verification, collected.source, planOnly);
    if (!planOnly) executePlan(verification.plan);
  } catch (error) {
    process.stderr.write("[verify] FAIL: " + error.message + "\n");
    exitCode = 1;
  }
  process.exit(exitCode);
}
