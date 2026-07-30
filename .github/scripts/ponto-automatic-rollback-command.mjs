export function buildWorkerRollbackArgs({
  incumbentVersionId,
  workerName,
  releaseSha,
  orchestratorRunId,
}) {
  return [
    "--yes",
    "wrangler@4.112.0",
    "rollback",
    incumbentVersionId,
    "--name",
    workerName,
    "--message",
    `ponto:auto-abort:${releaseSha}:orchestrator-${orchestratorRunId}`,
    "--yes",
  ];
}
