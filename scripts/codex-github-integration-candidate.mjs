import { buildWorkflowLeaseRequest } from "./codex-global-coordination-workflow.mjs";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const MAX_COORDINATION_REQUEST_BYTES = 48 * 1024;

function requiredToken(token = process.env.GH_TOKEN) {
  const value = String(token || "").trim();
  if (!value) throw new Error("GH_TOKEN is required");
  return value;
}

function apiUrl(repository, suffix = "") {
  return `https://api.github.com/repos/${repository}${suffix}`;
}

export async function githubJson(repository, suffix, options = {}, token = process.env.GH_TOKEN) {
  const response = await fetch(apiUrl(repository, suffix), {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${requiredToken(token)}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`GitHub API returned invalid JSON (${response.status})`);
  }
  if (!response.ok) throw new Error(`GitHub API request failed (${response.status}): ${String(body?.message || "unknown error")}`);
  return body;
}

function assertSha(value, label) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!FULL_SHA.test(normalized)) throw new Error(`${label} must be a full SHA`);
  return normalized;
}

export async function pullRequestFiles({ repository, pullNumber, token = process.env.GH_TOKEN }) {
  const files = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await githubJson(repository, `/pulls/${pullNumber}/files?per_page=100&page=${page}`, {}, token);
    if (!Array.isArray(batch)) throw new Error("GitHub pull request file response is invalid");
    files.push(...batch);
    if (batch.length < 100) break;
    if (files.length >= 2_000) throw new Error("pull request changed-file set is too large to attest safely");
  }
  const changedPaths = [...new Set(files.flatMap((entry) => [entry?.filename, entry?.previous_filename]
    .map((value) => String(value || "").trim().replaceAll("\\", "/"))
    .filter(Boolean)))].sort();
  if (!changedPaths.length) throw new Error("pull request changed-file set is unavailable");
  return changedPaths;
}

export function assertCoordinationPayloadSize(request) {
  const bytes = Buffer.byteLength(JSON.stringify(request), "utf8");
  if (bytes > MAX_COORDINATION_REQUEST_BYTES) {
    throw new Error(`pull request coordination attestation exceeds the ${MAX_COORDINATION_REQUEST_BYTES}-byte payload budget`);
  }
  return bytes;
}

export async function loadMergeCandidateIdentity({ repository, pullNumber, expectedHeadSha = null, token = process.env.GH_TOKEN }) {
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) throw new Error("repository is invalid");
  if (!/^[1-9][0-9]*$/.test(String(pullNumber))) throw new Error("pull number is invalid");
  const pull = await githubJson(repository, `/pulls/${pullNumber}`, {}, token);
  const headSha = assertSha(pull?.head?.sha, "pull request head SHA");
  const baseSha = assertSha(pull?.base?.sha, "pull request base SHA");
  if (
    pull.state !== "open"
    || pull.base?.ref !== "main"
    || pull.head?.repo?.full_name !== repository
    || (expectedHeadSha && headSha !== assertSha(expectedHeadSha, "expected head SHA"))
  ) throw new Error("pull request is not an open same-repository main integration candidate");
  return { pull, headSha, baseSha };
}

export async function loadMergeCandidate({
  repository,
  pullNumber,
  expectedHeadSha = null,
  token = process.env.GH_TOKEN,
  identity = null,
}) {
  const candidateIdentity = identity || await loadMergeCandidateIdentity({ repository, pullNumber, expectedHeadSha, token });
  const { pull, headSha, baseSha } = candidateIdentity;
  const changedPaths = await pullRequestFiles({ repository, pullNumber, token });
  const { request, closure } = buildWorkflowLeaseRequest({
    resource: "merge:main",
    module: "merge",
    source: baseSha,
    operation: "mutation",
    idempotencyKey: `merge:${repository}:${pullNumber}:${headSha}`,
    inputs: { pullNumber: String(pullNumber), expectedHeadSha: headSha, baseSha, changedPaths },
  });
  assertCoordinationPayloadSize(request);
  return { pull, headSha, baseSha, changedPaths, request, closure };
}
