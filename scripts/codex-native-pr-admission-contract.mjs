import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const REPOSITORY = "jubenitogarcia/skincos";
export const REPOSITORY_ID = 1060913632;
export const STATUS_CONTEXTS = Object.freeze({
  merge: "global-merge-authority",
  integration: "skincos-integration-gate",
});

const SHA = /^[0-9a-f]{40}$/;
const BLOCKED_EVENTS = new Set(["status", "check_run", "check_suite", "pull_request_target"]);
const APP_PERMISSIONS = Object.freeze({ contents: "read", pull_requests: "read", statuses: "write" });

export function exactSha(value, label) {
  const sha = String(value || "").toLowerCase();
  if (!SHA.test(sha)) throw new Error(`${label} must be a full lowercase commit SHA`);
  return sha;
}

export function workflowEvents(source) {
  const lines = String(source).replace(/^\ufeff/, "").split(/\r?\n/);
  const declarations = lines.flatMap((line, index) => /^on:\s*(?:#.*)?$/.test(line) ? [index] : []);
  if (declarations.length !== 1) throw new Error("workflow must contain one explicit block-style on trigger");
  const events = [];
  for (let i = declarations[0] + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (!/^\s/.test(line)) break;
    const match = /^  ([A-Za-z_][A-Za-z0-9_]*):(?:\s|$)/.exec(line)
      || /^  - ([A-Za-z_][A-Za-z0-9_]*)\s*(?:#.*)?$/.exec(line);
    if (match) events.push(match[1]);
    else if (!/^ {4,}\S/.test(line)) throw new Error("workflow trigger has unsupported indentation or syntax");
  }
  if (!events.length) throw new Error("workflow has no parseable triggers");
  return events;
}

export function auditAdmissionTriggers(root, read = fs.readFileSync) {
  const directory = path.join(root, ".github", "workflows");
  const files = fs.readdirSync(directory).filter((name) => /\.ya?ml$/.test(name));
  if (files.length < 2) throw new Error("GitHub workflow inventory is incomplete");
  const blocked = [];
  for (const name of files) {
    const events = workflowEvents(read(path.join(directory, name), "utf8"));
    for (const event of events) if (BLOCKED_EVENTS.has(event)) blocked.push(`${name}:${event}`);
  }
  if (blocked.length) throw new Error(`native PR admission cannot publish while Actions event triggers remain: ${blocked.join(", ")}`);
  return { workflowCount: files.length, statusEventTriggers: 0, prTargetTriggers: 0 };
}

export function installationTokenRequest() {
  return { repository_ids: [REPOSITORY_ID], permissions: { ...APP_PERMISSIONS } };
}

export function assertInstallationToken(body, now = Date.now()) {
  if (!body || typeof body.token !== "string" || body.token.length < 24
    || !Array.isArray(body.repositories) || body.repositories.length !== 1
    || body.repositories[0]?.id !== REPOSITORY_ID
    || body.repositories[0]?.full_name !== REPOSITORY) {
    throw new Error("GitHub App installation token has an unexpected repository scope");
  }
  const permissions = body.permissions;
  if (!permissions || Object.entries(APP_PERMISSIONS).some(([name, permission]) => permissions[name] !== permission)
    || Object.entries(permissions).some(([name, permission]) => name !== "metadata" && APP_PERMISSIONS[name] !== permission)
    || (permissions.metadata !== undefined && permissions.metadata !== "read")) {
    throw new Error("GitHub App installation token has an unexpected permission scope");
  }
  const expires = Date.parse(String(body.expires_at || ""));
  if (!Number.isFinite(expires) || expires <= now + 5 * 60_000 || expires > now + 61 * 60_000) {
    throw new Error("GitHub App installation token has an invalid lifetime");
  }
  return body.token;
}

export function latestContexts(statuses) {
  if (!Array.isArray(statuses)) throw new Error("GitHub commit status readback is invalid");
  const latest = new Map();
  for (const row of statuses) {
    if (!row || !Object.values(STATUS_CONTEXTS).includes(row.context)) continue;
    const previous = latest.get(row.context);
    if (!previous || Date.parse(row.updated_at) > Date.parse(previous.updated_at)) latest.set(row.context, row);
  }
  return latest;
}

export function statusNeeded(current, desired, { appBotLogin = "", now = Date.now() } = {}) {
  if (!Object.values(STATUS_CONTEXTS).includes(desired?.context)
    || !["failure", "pending", "success"].includes(desired?.state)
    || !/^https:\/\/github\.com\/jubenitogarcia\/skincos\/blob\/[0-9a-f]{40}\/docs\/runbooks\/native-pr-admission\.md$/.test(desired?.target_url || "")) {
    throw new Error("native PR admission status is outside its fixed contract");
  }
  if (desired.context === STATUS_CONTEXTS.merge && current?.state === "success"
    && current.creator?.login === appBotLogin && appBotLogin
    && /^https:\/\/github\.com\/jubenitogarcia\/skincos\/blob\/[0-9a-f]{40}\/docs\/runbooks\/native-merge-authority\.md$/.test(current.target_url || "")
    && now >= Date.parse(current.updated_at)
    && now - Date.parse(current.updated_at) < 2 * 60_000) return false;
  if (appBotLogin && current?.creator?.login !== appBotLogin) return true;
  return current?.state !== desired.state || current?.description !== desired.description
    || current?.target_url !== desired.target_url;
}

export function statusDigest(status) {
  return crypto.createHash("sha256").update(JSON.stringify({
    context: status.context, state: status.state, description: status.description, target_url: status.target_url,
  })).digest("hex");
}
