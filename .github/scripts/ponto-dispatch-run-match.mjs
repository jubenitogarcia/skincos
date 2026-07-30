export function matchesDispatchedRun(item, {
  workflowId,
  expectedPath,
  orchestratorHeadSha,
  correlation,
  dispatchRequestedAt,
  expectedDisplayTitle,
  dispatchNonce,
}) {
  // REST workflow-run objects expose the canonical workflow file path without
  // a ref suffix. Branch and immutable source are attested independently below.
  return item?.workflow_id === workflowId
    && item?.path === expectedPath
    && item?.head_sha === orchestratorHeadSha
    && Number.isFinite(Date.parse(String(item?.created_at || "")))
    && Date.parse(String(item.created_at)) >= Date.parse(dispatchRequestedAt) - 2_000
    && (
      expectedDisplayTitle
        ? (
          /^[0-9a-f]{32}$/.test(String(dispatchNonce || ""))
          && item?.display_title === expectedDisplayTitle
          && expectedDisplayTitle.endsWith(`orchestrator=${correlation} nonce=${dispatchNonce}`)
        )
        : String(item?.display_title || "").includes(`orchestrator=${correlation}`)
    );
}
