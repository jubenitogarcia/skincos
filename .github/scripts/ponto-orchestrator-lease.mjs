import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [command, ...args] = process.argv.slice(2);
const apiBase = String(process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
const token = String(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "").trim();
const UUIDISH_KEY = /^[a-z][a-z0-9-]{1,63}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const request = async (pathname, init = {}) => {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${init.method || "GET"} ${pathname} returned ${response.status}`);
  return response.status === 204 ? null : response.json();
};

if (command === "issue") {
  const [directory, tokensFile, ...keys] = args;
  const runId = String(process.env.GITHUB_RUN_ID || "");
  const releaseSha = String(process.env.RELEASE_SHA || "").trim().toLowerCase();
  const stage = String(process.env.STAGE || "").trim().toLowerCase();
  if (
    !directory
    || !tokensFile
    || !/^[0-9]+$/.test(runId)
    || !FULL_SHA.test(releaseSha)
    || !["staging", "pilot", "canary", "production", "rollback"].includes(stage)
    || !keys.length
    || new Set(keys).size !== keys.length
    || keys.some(key => !UUIDISH_KEY.test(key))
  ) {
    throw new Error("invalid orchestrator lease issue request");
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tokens = {};
  // The coordinator may run for 330 minutes and must still retain enough
  // bounded custody for cancellation, compensation, and evidence upload.
  // Every capability is also run/stage/SHA/key-bound and single-use.
  const expiresAt = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();
  for (const key of keys) {
    const leaseToken = crypto.randomBytes(32).toString("base64url");
    const lease = {
      schemaVersion: 1,
      orchestratorRunId: runId,
      repository,
      stage,
      releaseSha,
      leaseKey: key,
      nonceSha256: sha256(leaseToken),
      expiresAt,
      singleUse: true,
    };
    fs.writeFileSync(path.join(directory, `${key}.json`), `${JSON.stringify(lease, null, 2)}\n`, { mode: 0o600 });
    tokens[key] = leaseToken;
    process.stdout.write(`::add-mask::${leaseToken}\n`);
  }
  fs.mkdirSync(path.dirname(tokensFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(tokensFile, `${JSON.stringify(tokens)}\n`, { mode: 0o600 });
  process.stdout.write(`Issued ${keys.length} masked single-use orchestrator capabilities.\n`);
} else if (command === "consume") {
  const [leaseFile, leaseKey, stage, releaseShaRaw, orchestratorRunId, leaseToken] = args;
  const releaseSha = String(releaseShaRaw || "").trim().toLowerCase();
  const currentHeadSha = String(process.env.GITHUB_SHA || "").trim().toLowerCase();
  if (
    !leaseFile
    || !UUIDISH_KEY.test(leaseKey || "")
    || !["staging", "pilot", "canary", "production", "rollback"].includes(stage || "")
    || !FULL_SHA.test(releaseSha)
    || !FULL_SHA.test(currentHeadSha)
    || !/^[0-9]+$/.test(orchestratorRunId || "")
    || !/^[A-Za-z0-9_-]{43}$/.test(leaseToken || "")
    || !token
    || !repository.includes("/")
  ) {
    throw new Error("invalid orchestrator lease consume request");
  }
  const lease = JSON.parse(fs.readFileSync(leaseFile, "utf8"));
  if (
    lease?.schemaVersion !== 1
    || lease.singleUse !== true
    || lease.orchestratorRunId !== orchestratorRunId
    || lease.repository !== repository
    || lease.stage !== stage
    || lease.releaseSha !== releaseSha
    || lease.leaseKey !== leaseKey
    || !safeEqual(lease.nonceSha256, sha256(leaseToken))
    || Date.parse(String(lease.expiresAt || "")) <= Date.now()
  ) {
    throw new Error("orchestrator capability claims or nonce differ");
  }
  const [workflow, run] = await Promise.all([
    request(`/repos/${repository}/actions/workflows/ponto-progressive-release.yml`),
    request(`/repos/${repository}/actions/runs/${orchestratorRunId}`),
  ]);
  if (
    workflow?.state !== "active"
    || workflow?.path !== ".github/workflows/ponto-progressive-release.yml"
    || run?.workflow_id !== workflow.id
    || run?.path !== `${workflow.path}@refs/heads/main`
    || run?.status !== "in_progress"
    || run?.conclusion != null
    || run?.event !== "workflow_dispatch"
    || run?.head_branch !== "main"
    || run?.head_sha !== currentHeadSha
    || run?.name !== "Ponto progressive release"
    || run?.repository?.full_name !== repository
    || run?.head_repository?.full_name !== repository
    || run?.display_title !== `Ponto ${stage} ${releaseSha} orchestrator=${orchestratorRunId}`
  ) {
    throw new Error("canonical orchestrator run is not the exact active issuer");
  }
  const artifactName = `ponto-orchestrator-lease-${orchestratorRunId}-${leaseKey}`;
  const artifacts = await request(`/repos/${repository}/actions/runs/${orchestratorRunId}/artifacts?name=${encodeURIComponent(artifactName)}&per_page=10`);
  const candidates = (artifacts?.artifacts || []).filter(artifact => artifact?.name === artifactName && artifact?.expired === false);
  if (candidates.length !== 1 || !Number.isInteger(candidates[0]?.id)) {
    throw new Error("single-use orchestrator capability artifact is absent or ambiguous");
  }
  await request(`/repos/${repository}/actions/artifacts/${candidates[0].id}`, { method: "DELETE" });
  const after = await request(`/repos/${repository}/actions/runs/${orchestratorRunId}/artifacts?name=${encodeURIComponent(artifactName)}&per_page=10`);
  if ((after?.artifacts || []).some(artifact => artifact?.id === candidates[0].id)) {
    throw new Error("single-use orchestrator capability was not consumed");
  }
  process.stdout.write(`Consumed single-use orchestrator capability ${leaseKey}.\n`);
} else {
  throw new Error("usage: ponto-orchestrator-lease.mjs issue|consume ...");
}
