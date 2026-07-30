export function matchesDispatchedRun(item, {
  workflowId,
  expectedPath,
  orchestratorHeadSha,
  correlation,
  dispatchRequestedAt,
  expectedDisplayTitle,
  dispatchNonce,
}) {
  return item?.workflow_id === workflowId
    && item?.path === `${expectedPath}@refs/heads/main`
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
