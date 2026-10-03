#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appJwt, issueInstallationToken } from "../codex-native-github-app.mjs";

const REPOSITORY = "jubenitogarcia/skincos";
const PERMISSIONS = Object.freeze({ contents: "read", pull_requests: "read", statuses: "write", security_events: "write", metadata: "read" });
const TARGET = "/etc/skincos/github-app";

export async function validateCustody(input, { fetchImpl = fetch, issuer = issueInstallationToken } = {}) {
  if (Object.keys(input || {}).some((name) => !["appId", "installationId", "privateKey"].includes(name))) throw new Error("Unexpected custody input");
  const jwt = appJwt(input);
  async function api(suffix) {
    const response = await fetchImpl(`https://api.github.com${suffix}`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${jwt}`, "x-github-api-version": "2022-11-28" },
    });
    if (!response.ok) throw new Error(`GitHub App validation failed with HTTP ${response.status}`);
    return response.json();
  }
  const [app, installation] = await Promise.all([api("/app"), api(`/repos/${REPOSITORY}/installation`)]);
  if (app.id !== Number(input.appId) || app.owner?.login !== "jubenitogarcia" || !/^[a-z0-9-]+$/.test(app.slug || "")) throw new Error("GitHub App ownership is invalid");
  if (installation.id !== Number(input.installationId) || installation.app_id !== app.id
    || installation.account?.login !== "jubenitogarcia" || installation.repository_selection !== "selected" || installation.suspended_at) throw new Error("GitHub App installation is invalid");
  for (const value of [app.permissions, installation.permissions]) {
    if (!value || Object.entries(PERMISSIONS).some(([name, level]) => value[name] !== level)
      || Object.entries(value).some(([name, level]) => PERMISSIONS[name] !== level)) throw new Error("GitHub App permission union is invalid");
  }
  await issuer({ ...input, profile: "admission", fetchImpl });
  await issuer({ ...input, profile: "security", fetchImpl });
  return { appId: app.id, installationId: installation.id, botLogin: `${app.slug}[bot]`,
    coordinatorUrl: "https://skincos-global-coordinator-production.skincos.workers.dev/v1/leases" };
}

async function readStdin() {
  if (process.stdin.isTTY) throw new Error("Custody must arrive through the private stdin transport");
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 32_768) throw new Error("Custody input is too large");
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  try { return JSON.parse(buffer.toString("utf8")); }
  finally { buffer.fill(0); for (const chunk of chunks) chunk.fill(0); }
}

async function main() {
  const source = fs.realpathSync(import.meta.filename);
  if (process.getuid?.() !== 0 || !source.startsWith("/opt/skincos-github-app-custody/releases/") || fs.statSync(source).uid !== 0) {
    throw new Error("Custody helper requires an immutable root-owned native release");
  }
  for (let entry = source; entry !== "/"; entry = path.dirname(entry)) {
    const metadata = fs.lstatSync(entry);
    if (metadata.uid !== 0 || metadata.mode & 0o022 || metadata.isSymbolicLink()) throw new Error("Custody helper provenance is writable");
  }
  const issuerFile = fs.lstatSync(path.resolve(path.dirname(source), "../codex-native-github-app.mjs"));
  if (issuerFile.uid !== 0 || issuerFile.mode & 0o022 || issuerFile.isSymbolicLink() || !issuerFile.isFile()) throw new Error("Custody issuer provenance is writable");
  if (process.argv.length !== 2 || fs.existsSync(TARGET)) throw new Error("Custody provisioning is create-only");
  const input = await readStdin();
  const config = await validateCustody(input);
  const staging = `/etc/skincos/.github-app.new-${crypto.randomUUID()}`;
  fs.mkdirSync(staging, { mode: 0o700 });
  try {
    const write = (name, value) => { const descriptor = fs.openSync(path.join(staging, name), "wx", 0o600); try { fs.writeFileSync(descriptor, value); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); } };
    write("private-key.pem", input.privateKey);
    write("config.json", `${JSON.stringify(config)}\n`);
    write("provisioning.json", `${JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(),
      previousCustody: "absent", appId: config.appId, installationId: config.installationId, validatedProfiles: ["admission", "security"] })}\n`);
    fs.renameSync(staging, TARGET);
    const descriptor = fs.openSync(path.dirname(TARGET), "r"); try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    process.stdout.write(`${JSON.stringify({ status: "provisioned", appId: config.appId, installationId: config.installationId, profiles: ["admission", "security"] })}\n`);
  } finally {
    input.privateKey = "";
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await main(); }
  catch { process.stderr.write("Native GitHub App custody provisioning failed closed; no secret material emitted.\n"); process.exitCode = 1; }
}
