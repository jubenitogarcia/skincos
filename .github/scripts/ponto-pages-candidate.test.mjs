import assert from "node:assert/strict";
import test from "node:test";
import { selectPagesCandidate } from "./ponto-pages-candidate.mjs";

const project = "skincos-staging";
const branch = "staging";
const releaseSha = "a".repeat(40);
const alias = "crm-staging.skincos.com.br";
const startedAt = "2026-08-03T00:00:00.000Z";

const deployment = ({
  id,
  sha = releaseSha,
  createdOn,
  environment = "production",
  deploymentBranch = branch,
  status = "success",
  aliases = [`https://${alias}`],
  url = `https://${id.slice(0, 8)}.skincos-staging.pages.dev`,
  skipped = false,
} = {}) => ({
  id,
  project_name: project,
  environment,
  created_on: createdOn,
  deployment_trigger: { metadata: { branch: deploymentBranch, commit_hash: sha } },
  latest_stage: { name: "deploy", status, ended_on: status === "success" ? createdOn : null },
  is_skipped: skipped,
  aliases,
  url,
});

test("selects the newest exact terminal candidate from the Pages inventory", () => {
  const old = deployment({
    id: "11111111-1111-4111-8111-111111111111",
    createdOn: "2026-07-30T00:00:00.000Z",
  });
  const newest = deployment({
    id: "22222222-2222-4222-8222-222222222222",
    createdOn: "2026-08-03T00:02:00.000Z",
  });
  const staleSha = deployment({
    id: "33333333-3333-4333-8333-333333333333",
    sha: "b".repeat(40),
    createdOn: "2026-08-03T00:03:00.000Z",
  });

  assert.deepEqual(
    selectPagesCandidate([old, staleSha, newest], { project, branch, releaseSha, startedAt, alias }),
    {
      id: newest.id,
      url: newest.url,
      createdOn: newest.created_on,
    },
  );
});

test("rejects a same-SHA deployment that is stale, pending, or not aliased", () => {
  const stale = deployment({
    id: "11111111-1111-4111-8111-111111111111",
    createdOn: "2026-07-31T00:00:00.000Z",
  });
  const pending = deployment({
    id: "22222222-2222-4222-8222-222222222222",
    createdOn: "2026-08-03T00:01:00.000Z",
    status: "active",
  });
  const unaliased = deployment({
    id: "33333333-3333-4333-8333-333333333333",
    createdOn: "2026-08-03T00:02:00.000Z",
    aliases: [],
  });

  assert.equal(
    selectPagesCandidate([stale, pending, unaliased], { project, branch, releaseSha, startedAt, alias }),
    null,
  );
});

test("requires the production project and exact source identity", () => {
  const candidate = deployment({
    id: "11111111-1111-4111-8111-111111111111",
    createdOn: "2026-08-03T00:01:00.000Z",
  });
  assert.equal(
    selectPagesCandidate([{ ...candidate, environment: "preview" }], { project, branch, releaseSha, startedAt, alias }),
    null,
  );
  assert.equal(
    selectPagesCandidate([candidate], { project, branch: "main", releaseSha, startedAt, alias }),
    null,
  );
});
