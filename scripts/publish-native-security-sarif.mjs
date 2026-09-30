#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { scannerJson } from "./codex-native-security-audit.mjs";
import { publicMainSha } from "./codex-native-scheduled-source.mjs";

const API = "https://api.github.com/repos/jubenitogarcia/skincos/code-scanning/sarifs";
const REPORTS = "/home/admin/.local/state/skincos-native-security-audit";

export function sarifUploadBody(receipt, stdout) {
  if (receipt.schemaVersion !== 1 || receipt.kind !== "skincos-native-weekly-security-audit" || receipt.mode !== "live-main"
    || !/^[0-9a-f]{40}$/.test(receipt.sourceSha) || !["failed", "local-passed-sarif-publication-pending"].includes(receipt.status)
    || !Array.isArray(receipt.scans)) throw new Error("SARIF publication requires a terminal canonical security receipt");
  const scans = receipt.scans.filter((entry) => entry.label === "semgrep");
  if (scans.length !== 1 || scans[0].status !== "passed" || crypto.createHash("sha256").update(stdout).digest("hex") !== scans[0].outputDigest) {
    throw new Error("SARIF output differs from the verified scanner receipt");
  }
  const sarif = scannerJson(stdout);
  if (sarif.version !== "2.1.0" || !Array.isArray(sarif.runs) || !sarif.runs.length || sarif.runs.length > 20
    || sarif.runs.some((run) => (run.results || []).length > 25_000)) throw new Error("scanner SARIF is invalid or exceeds API limits");
  const compressed = gzipSync(JSON.stringify(sarif));
  if (compressed.length > 10 * 1024 * 1024) throw new Error("compressed SARIF exceeds the 10 MiB upload limit");
  return { commit_sha: receipt.sourceSha, ref: "refs/heads/main", sarif: compressed.toString("base64"), checkout_uri: "file:///run/candidate/", started_at: receipt.startedAt, tool_name: "Semgrep" };
}

export async function uploadSarif({ token, body, fetchImpl = fetch, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = 120 }) {
  if (typeof token !== "string" || !token || body.ref !== "refs/heads/main" || !/^[0-9a-f]{40}$/.test(body.commit_sha)) throw new Error("SARIF upload authentication or identity is invalid");
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
  const response = await fetchImpl(API, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (response.status !== 202) throw new Error(`SARIF upload rejected (HTTP ${response.status})`);
  const accepted = await response.json();
  if (typeof accepted.id !== "string" || !/^[A-Za-z0-9-]{1,100}$/.test(accepted.id)) throw new Error("SARIF API returned an invalid upload id");
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await delay(5_000);
    const statusResponse = await fetchImpl(`${API}/${accepted.id}`, { headers, signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (statusResponse.status !== 200) throw new Error(`SARIF processing readback failed (HTTP ${statusResponse.status})`);
    const status = await statusResponse.json();
    if (status.processing_status === "complete") return { status: "published", uploadId: accepted.id, sourceSha: body.commit_sha };
    if (status.processing_status !== "pending") throw new Error("SARIF processing rejected the analysis");
  }
  throw new Error("SARIF processing did not complete before its bounded deadline");
}

function privateReport(file) {
  const resolved = fs.realpathSync(file);
  if (!resolved.startsWith(`${REPORTS}/`) || resolved !== path.resolve(file)) throw new Error("security publication input escaped private report custody");
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 1000 || (stat.mode & 0o777) !== 0o600 || stat.size > 32 * 1024 * 1024) throw new Error("security publication input custody is invalid");
  return fs.readFileSync(file, "utf8");
}

async function main(receiptPath) {
  if (process.platform !== "linux" || process.getuid() !== 0) throw new Error("publish security SARIF through the root-owned credential service");
  const receipt = JSON.parse(privateReport(receiptPath));
  const semgrep = receipt.scans?.find((entry) => entry.label === "semgrep");
  if (!semgrep || path.dirname(semgrep.stdout) !== path.dirname(receiptPath)) throw new Error("Semgrep output does not belong to this receipt");
  const body = sarifUploadBody(receipt, privateReport(semgrep.stdout));
  if (body.commit_sha !== publicMainSha()) throw new Error("security receipt source is no longer canonical main");
  const configPath = "/etc/skincos/github-app/config.json";
  const configStat = fs.lstatSync(configPath);
  if (configStat.uid !== 0 || configStat.isSymbolicLink() || (configStat.mode & 0o777) !== 0o600) throw new Error("GitHub App metadata custody is invalid");
  const metadata = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const credentials = process.env.CREDENTIALS_DIRECTORY;
  if (!credentials || !credentials.startsWith("/run/credentials/")) throw new Error("GitHub App key is unavailable in systemd credential custody");
  const { issueInstallationToken } = await import("./codex-native-github-app.mjs");
  const privateKey = fs.readFileSync(path.join(credentials, "github-app-key"), "utf8");
  const issued = await issueInstallationToken({ appId: metadata.appId, installationId: metadata.installationId, privateKey, profile: "security" });
  const result = await uploadSarif({ token: typeof issued === "string" ? issued : issued.token, body });
  if (body.commit_sha !== publicMainSha()) throw new Error("canonical main changed during SARIF publication");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--receipt") throw new Error("usage: publish-native-security-sarif --receipt <private terminal receipt>");
    process.stdout.write(`${JSON.stringify(await main(process.argv[3]), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
