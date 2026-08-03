import crypto from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/;
const STATES = new Set(["attempted", "created", "restored"]);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
};
const stableJson = (value) => JSON.stringify(canonicalize(value));
const signature = (claims, secret) =>
  crypto.createHmac("sha256", secret).update(stableJson(claims)).digest("hex");
const externalId = (base) =>
  `ponto-pages-rollback:${crypto.createHash("sha256").update(stableJson(base)).digest("hex")}`;

const checkName = ({ coordinatorRunId, stage }) =>
  `ponto-pages-rollback-intent/${coordinatorRunId}/${stage}`;

function baseClaims(input) {
  const value = {
    schemaVersion: 1,
    domain: "skincos/ponto/pages-rollback-intent/v1",
    repositoryId: String(input.repositoryId || ""),
    repository: String(input.repository || ""),
    coordinatorRunId: String(input.coordinatorRunId || ""),
    sourceSha: String(input.sourceSha || "").toLowerCase(),
    stage: String(input.stage || ""),
    project: String(input.project || ""),
    branch: String(input.branch || ""),
    alias: String(input.alias || ""),
    candidateDeploymentId: String(input.candidateDeploymentId || "").toLowerCase(),
    incumbentDeploymentId: String(input.incumbentDeploymentId || "").toLowerCase(),
    oneShot: true,
    credentialsIncluded: false,
    piiIncluded: false,
  };
  if (
    !/^[1-9][0-9]*$/.test(value.repositoryId)
    || !value.repository.includes("/")
    || !/^[1-9][0-9]*$/.test(value.coordinatorRunId)
    || !SHA.test(value.sourceSha)
    || !["staging", "pilot", "canary", "production"].includes(value.stage)
    || !value.project
    || !value.branch
    || !value.alias
    || !UUID.test(value.candidateDeploymentId)
    || !UUID.test(value.incumbentDeploymentId)
    || value.candidateDeploymentId === value.incumbentDeploymentId
  ) throw new Error("Pages rollback intent identity is invalid");
  return value;
}

function verifyDocument(document, expectedBase, secret) {
  const claims = document?.claims;
  if (
    stableJson(Object.fromEntries(Object.keys(expectedBase).map((key) => [key, claims?.[key]])))
      !== stableJson(expectedBase)
    || !STATES.has(claims?.state)
    || !Number.isFinite(Date.parse(String(claims?.attemptedAt || "")))
    || !/^[1-9][0-9]*$/.test(String(claims?.recoveryRunId || ""))
    || (claims.state === "attempted" && claims.restoredDeploymentId !== "")
    || (
      claims.restoredExistingIncumbent !== undefined
      && typeof claims.restoredExistingIncumbent !== "boolean"
    )
    || (
      ["created", "restored"].includes(claims.state)
      && !UUID.test(String(claims.restoredDeploymentId || ""))
    )
    || (
      ["created", "restored"].includes(claims.state)
      && [
        expectedBase.candidateDeploymentId,
        expectedBase.incumbentDeploymentId,
      ].includes(String(claims.restoredDeploymentId || "").toLowerCase())
      && !(
        claims.state === "restored"
        && claims.restoredExistingIncumbent === true
        && String(claims.restoredDeploymentId || "").toLowerCase() === expectedBase.incumbentDeploymentId
      )
    )
    || (
      claims.restoredExistingIncumbent === true
      && (
        claims.state !== "restored"
        || String(claims.restoredDeploymentId || "").toLowerCase() !== expectedBase.incumbentDeploymentId
      )
    )
    || (claims.state === "restored" && !Number.isFinite(Date.parse(String(claims.restoredAt || ""))))
    || !/^[0-9a-f]{64}$/.test(String(document?.signatureHmacSha256 || ""))
    || document.signatureHmacSha256 !== signature(claims, secret)
  ) throw new Error("Pages rollback intent claims or HMAC differ");
  return claims;
}

function verifyCheck(check, expectedBase, secret) {
  const expectedName = checkName(expectedBase);
  if (
    !Number.isInteger(check?.id)
    || check?.name !== expectedName
    || check?.head_sha !== expectedBase.sourceSha
    || check?.external_id !== externalId(expectedBase)
    || check?.app?.slug !== "github-actions"
  ) throw new Error("Pages rollback intent check identity differs");
  const document = JSON.parse(String(check?.output?.summary || ""));
  const claims = verifyDocument(document, expectedBase, secret);
  if (
    (claims.state !== "restored"
      && (check?.status !== "in_progress" || check?.conclusion != null))
    || (
      claims.state === "restored"
      && (check?.status !== "completed" || check?.conclusion !== "success")
    )
  ) throw new Error("Pages rollback intent check status differs");
  return { checkId: check.id, claims, document };
}

async function listChecks(request, base) {
  const name = checkName(base);
  const payload = await request(
    `/repos/${base.repository}/commits/${base.sourceSha}/check-runs?check_name=${encodeURIComponent(name)}&filter=all&per_page=100`,
  );
  const matches = (payload?.check_runs || []).filter((check) => check?.name === name);
  if (matches.length > 1) throw new Error("Pages rollback intent check is ambiguous");
  return matches;
}

export async function readPagesRollbackIntent({ request, secret, ...input }) {
  if (typeof request !== "function" || Buffer.byteLength(String(secret || ""), "utf8") < 32) {
    throw new Error("Pages rollback intent custody is unavailable");
  }
  const base = baseClaims(input);
  const matches = await listChecks(request, base);
  if (!matches.length) return null;
  const detail = await request(`/repos/${base.repository}/check-runs/${matches[0].id}`);
  return { ...verifyCheck(detail, base, secret), base };
}

export async function createPagesRollbackIntent({
  request,
  secret,
  recoveryRunId,
  now = new Date(),
  ...input
}) {
  const base = baseClaims(input);
  const existing = await readPagesRollbackIntent({ request, secret, ...base });
  if (existing) return { ...existing, created: false };
  if (!/^[1-9][0-9]*$/.test(String(recoveryRunId || ""))) {
    throw new Error("Pages rollback recovery run identity is invalid");
  }
  const attemptedAt = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(attemptedAt.getTime())) throw new Error("Pages rollback attempt time is invalid");
  const claims = {
    ...base,
    state: "attempted",
    attemptedAt: attemptedAt.toISOString(),
    recoveryRunId: String(recoveryRunId),
    restoredDeploymentId: "",
    restoredExistingIncumbent: false,
    restoredAt: "",
  };
  const document = { claims, signatureHmacSha256: signature(claims, secret) };
  try {
    const created = await request(`/repos/${base.repository}/check-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: checkName(base),
        head_sha: base.sourceSha,
        status: "in_progress",
        external_id: externalId(base),
        output: {
          title: "Ponto Pages rollback one-shot intent",
          summary: JSON.stringify(document),
        },
      }),
    });
    const verified = verifyCheck(created, base, secret);
    const listed = await listChecks(request, base);
    if (listed.length !== 1 || listed[0]?.id !== verified.checkId) {
      throw new Error("Pages rollback intent was not uniquely persisted");
    }
    return { ...verified, base, created: true };
  } catch (error) {
    // A Check Run POST (or its immediate persistence check) can fail after
    // GitHub has committed the intent. Re-read the unique HMAC-bound document
    // and allow only this exact recovery run to cross the one-shot boundary.
    let reconciled = null;
    try {
      reconciled = await readPagesRollbackIntent({ request, secret, ...base });
    } catch {
      throw error;
    }
    if (
      reconciled?.claims?.recoveryRunId !== String(recoveryRunId)
      || reconciled?.claims?.state !== "attempted"
    ) throw error;
    return {
      ...reconciled,
      created: true,
      reconciledAfterIndeterminateCreate: true,
    };
  }
}

async function transitionIntent({
  request,
  secret,
  intent,
  state,
  restoredDeploymentId,
  allowExistingIncumbent = false,
  now = new Date(),
}) {
  if (!intent?.base || !Number.isInteger(intent?.checkId)) {
    throw new Error("Pages rollback intent transition subject is invalid");
  }
  const current = await request(
    `/repos/${intent.base.repository}/check-runs/${intent.checkId}`,
  );
  const verified = verifyCheck(current, intent.base, secret);
  const restoredId = String(restoredDeploymentId || "").toLowerCase();
  if (!UUID.test(restoredId)) throw new Error("Pages rollback restored deployment ID is invalid");
  if (restoredId === intent.base.candidateDeploymentId) {
    throw new Error("Pages rollback restored deployment must be a distinct rollback clone");
  }
  if (restoredId === intent.base.incumbentDeploymentId && (!allowExistingIncumbent || state !== "restored")) {
    throw new Error("Pages rollback restored deployment must be a distinct rollback clone");
  }
  if (
    ["created", "restored"].includes(verified.claims.state)
    && verified.claims.restoredDeploymentId !== restoredId
  ) throw new Error("Pages rollback intent already binds a different restored deployment");
  if (verified.claims.state === "restored") return { ...verified, base: intent.base };
  const transitionedAt = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(transitionedAt.getTime())) throw new Error("Pages rollback intent transition time is invalid");
  const claims = {
    ...verified.claims,
    state,
    restoredDeploymentId: restoredId,
    restoredExistingIncumbent: restoredId === intent.base.incumbentDeploymentId,
    restoredAt: state === "restored" ? transitionedAt.toISOString() : "",
  };
  const document = { claims, signatureHmacSha256: signature(claims, secret) };
  await request(`/repos/${intent.base.repository}/check-runs/${intent.checkId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: state === "restored" ? "completed" : "in_progress",
      ...(state === "restored" ? { conclusion: "success" } : {}),
      output: {
        title: state === "restored"
          ? "Ponto Pages rollback restored and attested"
          : "Ponto Pages rollback created deployment observed",
        summary: JSON.stringify(document),
      },
    }),
  });
  const detail = await request(`/repos/${intent.base.repository}/check-runs/${intent.checkId}`);
  const transitioned = verifyCheck(detail, intent.base, secret);
  if (
    transitioned.claims.state !== state
    || transitioned.claims.restoredDeploymentId !== restoredId
  ) throw new Error("Pages rollback intent competing transition detected");
  return { ...transitioned, base: intent.base };
}

export const recordCreatedPagesRollbackIntent = (input) =>
  transitionIntent({ ...input, state: "created" });

export const completePagesRollbackIntent = (input) =>
  transitionIntent({ ...input, state: "restored" });
