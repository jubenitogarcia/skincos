import {
  attestPagesIncumbentState,
  isTerminalPagesDeployment,
  latestProductionPagesDeployment,
} from "./ponto-rollback-ownership.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/;
const PENDING = new Set(["active", "queued", "waiting", "pending", "building", "initializing"]);

const aliasHosts = (deployment) => new Set((deployment?.aliases || []).map((alias) => {
  try {
    return new URL(alias).hostname;
  } catch {
    return String(alias).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}));

const commitSha = (deployment) =>
  String(deployment?.deployment_trigger?.metadata?.commit_hash || "").toLowerCase();

function exactDeploymentMetadata(deployment, {
  deploymentId,
  project,
  branch,
  commit,
}) {
  return deployment?.id === deploymentId
    && deployment?.project_name === project
    && deployment?.environment === "production"
    && deployment?.deployment_trigger?.metadata?.branch === branch
    && commitSha(deployment) === commit;
}

function exactActiveDeployment(deployment, expected) {
  return exactDeploymentMetadata(deployment, expected)
    && isTerminalPagesDeployment(deployment)
    && aliasHosts(deployment).has(expected.alias);
}

export async function rollbackPagesWithReconciliation({
  request,
  accountId,
  project,
  branch,
  alias,
  candidateDeploymentId,
  candidateCommitSha,
  incumbentDeploymentId,
  mutationAllowed = true,
  knownRestoredDeploymentId = "",
  persistAttempt = async () => {},
  persistCreatedId = async () => {},
  persistExistingIncumbentId = async () => {},
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs = 180_000,
  pollMs = 5_000,
}) {
  const candidateId = String(candidateDeploymentId || "").toLowerCase();
  const candidateCommit = String(candidateCommitSha || "").toLowerCase();
  const incumbentId = String(incumbentDeploymentId || "").toLowerCase();
  const knownRestoredId = String(knownRestoredDeploymentId || "").toLowerCase();
  if (
    typeof request !== "function"
    || !/^[0-9a-f]{32}$/i.test(String(accountId || ""))
    || !project
    || !branch
    || !alias
    || !UUID.test(candidateId)
    || !SHA.test(candidateCommit)
    || !UUID.test(incumbentId)
    || candidateId === incumbentId
    || typeof mutationAllowed !== "boolean"
    || (knownRestoredId && !UUID.test(knownRestoredId))
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1
    || !Number.isInteger(pollMs)
    || pollMs < 0
  ) throw new Error("Pages rollback reconciliation custody is invalid");

  const base = `/accounts/${accountId}/pages/projects/${encodeURIComponent(project)}/deployments`;
  const getDeployment = async (id) => {
    const payload = await request(`${base}/${id}`);
    return payload?.result;
  };
  const getLatest = async () => {
    const payload = await request(`${base}?env=production&per_page=25`);
    const listed = latestProductionPagesDeployment(payload, { alias });
    const id = String(listed?.id || "").toLowerCase();
    if (!UUID.test(id)) throw new Error("Pages latest production deployment identity is invalid");
    return getDeployment(id);
  };

  const incumbent = await getDeployment(incumbentId);
  const incumbentCommit = commitSha(incumbent);
  if (
    !SHA.test(incumbentCommit)
    || !exactDeploymentMetadata(incumbent, {
      deploymentId: incumbentId,
      project,
      branch,
      commit: incumbentCommit,
    })
    || !isTerminalPagesDeployment(incumbent)
  ) throw new Error("requested Pages incumbent is not an exact terminal deployment");

  const waitForExactIncumbent = async (deploymentId) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const active = await getDeployment(deploymentId);
      const attestation = attestPagesIncumbentState(incumbent, active, {
        incumbentDeploymentId: incumbentId,
        activeDeploymentId: deploymentId,
        project,
        branch,
        alias,
      });
      if (attestation.passed) return active;
      const status = String(active?.latest_stage?.status || "").toLowerCase();
      if (
        !exactDeploymentMetadata(active, {
          deploymentId,
          project,
          branch,
          commit: incumbentCommit,
        })
        || active?.is_skipped !== false
        || !PENDING.has(status)
      ) throw new Error("Pages incumbent rollback entered an invalid or conflicting state");
      await sleep(pollMs);
    }
    throw new Error("Pages incumbent rollback did not reach exact terminal success");
  };

  const reconcileIndeterminate = async () => {
    const deadline = Date.now() + timeoutMs;
    let candidate;
    while (Date.now() < deadline) {
      const latest = await getLatest();
      const latestId = String(latest?.id || "").toLowerCase();
      if (latestId === candidateId) {
        if (!exactActiveDeployment(latest, {
          deploymentId: candidateId,
          project,
          branch,
          commit: candidateCommit,
          alias,
        })) throw new Error("Pages candidate drifted while rollback response was indeterminate");
        candidate = latest;
        await sleep(pollMs);
        continue;
      }
      if (
        !exactDeploymentMetadata(latest, {
          deploymentId: latestId,
          project,
          branch,
          commit: incumbentCommit,
        })
        || latest?.is_skipped !== false
      ) throw new Error("Pages rollback response was indeterminate and latest deployment is unrelated");
      const active = isTerminalPagesDeployment(latest)
        && aliasHosts(latest).has(alias)
        ? latest
        : await waitForExactIncumbent(latestId);
      const attestation = attestPagesIncumbentState(incumbent, active, {
        incumbentDeploymentId: incumbentId,
        activeDeploymentId: latestId,
        project,
        branch,
        alias,
      });
      if (!attestation.passed) {
        throw new Error("reconciled Pages deployment does not attest the exact incumbent");
      }
      const restoredExistingIncumbent = latestId === incumbentId;
      if (restoredExistingIncumbent) {
        await persistExistingIncumbentId(latestId, "reconciled-indeterminate-response");
      } else {
        await persistCreatedId(latestId, "reconciled-indeterminate-response");
      }
      return {
        disposition: restoredExistingIncumbent
          ? "restored-existing-incumbent-after-indeterminate-response"
          : "restored-after-indeterminate-response",
        active,
        restoredExistingIncumbent,
      };
    }
    return { disposition: "candidate-still-active", active: candidate };
  };

  if (knownRestoredId) {
    const active = await waitForExactIncumbent(knownRestoredId);
    const latest = await getLatest();
    if (
      String(latest?.id || "").toLowerCase() !== knownRestoredId
      || !exactActiveDeployment(latest, {
        deploymentId: knownRestoredId,
        project,
        branch,
        commit: incumbentCommit,
        alias,
      })
    ) throw new Error("durable Pages rollback deployment no longer owns the exact incumbent alias");
    const restoredExistingIncumbent = knownRestoredId === incumbentId;
    if (restoredExistingIncumbent) {
      await persistExistingIncumbentId(knownRestoredId, "durable-intent-existing-incumbent");
    } else {
      await persistCreatedId(knownRestoredId, "durable-intent-created-id");
    }
    return {
      active,
      activeDeploymentId: knownRestoredId,
      incumbentCommitSha: incumbentCommit,
      mutationPerformed: true,
      attempts: 0,
      disposition: restoredExistingIncumbent
        ? "durable-intent-existing-incumbent-restored"
        : "durable-intent-restored",
      restoredExistingIncumbent,
    };
  }

  if (!mutationAllowed) {
    const reconciled = await reconcileIndeterminate();
    if (reconciled.disposition !== "candidate-still-active") {
      return {
        active: reconciled.active,
        activeDeploymentId: String(reconciled.active.id).toLowerCase(),
        incumbentCommitSha: incumbentCommit,
        mutationPerformed: true,
        attempts: 0,
        disposition: "durable-intent-reconciled",
        restoredExistingIncumbent: Boolean(reconciled.restoredExistingIncumbent),
      };
    }
    throw new Error(
      "durable Pages rollback intent remains indeterminate; exact candidate is still observed and a second POST is forbidden",
    );
  }

  const candidate = await getLatest();
  if (!exactActiveDeployment(candidate, {
    deploymentId: candidateId,
    project,
    branch,
    commit: candidateCommit,
    alias,
  })) throw new Error("Pages candidate no longer owns the exact active production alias");

  await persistAttempt();
  try {
    const response = await request(`${base}/${incumbentId}/rollback`, {
      method: "POST",
      body: "{}",
    });
    const createdId = String(response?.result?.id || "").toLowerCase();
    if (!UUID.test(createdId)) {
      throw new Error("Pages rollback response omitted deployment id");
    }
    await persistCreatedId(createdId, "response");
    const active = await waitForExactIncumbent(createdId);
    const latest = await getLatest();
    if (String(latest?.id || "").toLowerCase() !== createdId) {
      throw new Error("Pages rollback is not the latest production deployment");
    }
    if (!exactActiveDeployment(latest, {
      deploymentId: createdId,
      project,
      branch,
      commit: incumbentCommit,
      alias,
    })) throw new Error("Pages rollback latest deployment attestation failed");
    return {
      active,
      activeDeploymentId: createdId,
      incumbentCommitSha: incumbentCommit,
      mutationPerformed: true,
      attempts: 1,
      disposition: "rollback-response-attested",
    };
  } catch (error) {
    const reconciled = await reconcileIndeterminate();
    if (reconciled.disposition !== "candidate-still-active") {
      return {
        active: reconciled.active,
        activeDeploymentId: String(reconciled.active.id).toLowerCase(),
        incumbentCommitSha: incumbentCommit,
        mutationPerformed: true,
        attempts: 1,
        disposition: reconciled.disposition,
        restoredExistingIncumbent: Boolean(reconciled.restoredExistingIncumbent),
      };
    }
    throw new Error(
      `Pages rollback response was indeterminate; exact candidate remains observed and retry is refused: ${String(error?.message || error)}`,
    );
  }
}
