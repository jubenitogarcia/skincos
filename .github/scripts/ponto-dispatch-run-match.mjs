export function matchesDispatchedRun(item, {
  workflowId,
  expectedPath,
  orchestratorHeadSha,
  correlation,
  dispatchRequestedAt,
}) {
  return item?.workflow_id === workflowId
    && item?.path === `${expectedPath}@refs/heads/main`
    && item?.head_sha === orchestratorHeadSha
    && Number.isFinite(Date.parse(String(item?.created_at || "")))
    && Date.parse(String(item.created_at)) >= Date.parse(dispatchRequestedAt) - 2_000
    && String(item?.display_title || "").endsWith(`orchestrator=${correlation}`);
}
