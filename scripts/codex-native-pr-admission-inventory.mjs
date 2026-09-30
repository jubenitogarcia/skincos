#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REPOSITORY = "jubenitogarcia/skincos";
const ROOT = path.join(os.homedir(), ".local/state/skincos-native-pr-admission");

function api(endpoint) {
  const result = spawnSync("gh", ["api", "--method", "GET", `repos/${REPOSITORY}${endpoint}`], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`GitHub read failed (${result.status ?? result.error?.code})`);
  try { return JSON.parse(result.stdout); }
  catch { throw new Error("GitHub read returned invalid JSON"); }
}

function sha(value) {
  const parsed = String(value || "").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(parsed)) throw new Error("GitHub commit SHA is invalid");
  return parsed;
}

function privateRoot() {
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(ROOT);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) {
    throw new Error("private PR admission directory custody is invalid");
  }
  return ROOT;
}

function openPulls() {
  const pulls = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = api(`/pulls?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("open PR catalog is unavailable");
    pulls.push(...batch);
    if (batch.length < 100) return pulls;
  }
  throw new Error("open PR catalog exceeded bounded inventory");
}

export function classifyAdmission(pull, mainSha, comparison) {
  if (pull?.base?.ref !== "main") return "other-base";
  if (pull?.head?.repo?.full_name !== REPOSITORY) return "external-head";
  if (pull?.draft === true) return "draft";
  if (!comparison) return "compare-unavailable";
  if (comparison.behind_by !== 0 || !["ahead", "identical"].includes(comparison.status)) return "stale-head";
  if (sha(pull?.base?.sha) !== mainSha) return "stale-api-base-anchor";
  return "candidate-for-native-gate";
}

function main() {
  const mainSha = sha(api("/git/ref/heads/main")?.object?.sha);
  const pulls = openPulls();
  const records = [];
  for (const pull of pulls) {
    const headSha = sha(pull?.head?.sha);
    let comparison = null;
    let comparisonError = null;
    if (pull?.base?.ref === "main" && pull?.head?.repo?.full_name === REPOSITORY && pull?.draft !== true) {
      try {
        const result = api(`/compare/${mainSha}...${headSha}`);
        comparison = { status: result?.status, ahead_by: result?.ahead_by, behind_by: result?.behind_by };
      } catch (error) { comparisonError = String(error?.message || error); }
    }
    records.push({
      number: pull.number,
      headSha,
      baseSha: sha(pull?.base?.sha),
      draft: pull?.draft === true,
      headRepo: pull?.head?.repo?.full_name || null,
      comparison,
      comparisonError,
      admission: classifyAdmission(pull, mainSha, comparison),
    });
  }
  if (sha(api("/git/ref/heads/main")?.object?.sha) !== mainSha) throw new Error("main changed during PR admission inventory");
  const report = { version: 1, repository: REPOSITORY, mainSha, capturedAt: new Date().toISOString(), records };
  const directory = fs.mkdtempSync(path.join(privateRoot(), "inventory-"));
  fs.chmodSync(directory, 0o700);
  const file = path.join(directory, "report.json");
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  const counts = {};
  for (const record of records) counts[record.admission] = (counts[record.admission] || 0) + 1;
  process.stdout.write(`${JSON.stringify({ file, mainSha, count: records.length, byAdmission: counts, candidateNumbers: records.filter((record) => record.admission === "candidate-for-native-gate").map((record) => record.number) }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
