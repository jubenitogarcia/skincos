function text(value) {
  return String(value ?? "").trim();
}
function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
function key(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_.:-]+/g, "_")
    .slice(0, 190);
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((name) => `${JSON.stringify(name)}:${stable(value[name])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function stableHash(value) {
  let hash = 2166136261;
  for (const char of text(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// The Token Vault is the authorization boundary. Carry only the public
// contract selectors that let it bind this creative to its private authorized
// destination/profile; Pixel, conversion-event and dataset IDs never leave it.
function trackingGatewayFields(job, payload) {
  const destination = object(job.destination_contract);
  const tracking = object(job.tracking_contract);
  const destinationKind = text(
    destination.kind || tracking.destination_kind,
  ).toLowerCase();
  const urlTags =
    payload && payload.url_tags !== undefined && payload.url_tags !== null
      ? String(payload.url_tags)
      : "";
  if (!["website", "whatsapp"].includes(destinationKind)) {
    throw new Error(
      `Prepare Creative Operation recebeu destino de tracking invalido: ${job.job_key || "sem-chave"}.`,
    );
  }
  return {
    workflow_contract_revision: text(job.workflow_contract_revision),
    destination_kind: destinationKind,
    destination_adset_id: text(job.destination_adset_id),
    profile_ref:
      destinationKind === "website" ? text(tracking.profile_ref) : "",
    url_tags: destinationKind === "website" ? urlTags : "",
  };
}

return $input.all().map((item) => {
  const job = item.json || {};
  if (!text(job.run_id) || !text(job.token_id) || !job.creativePayload) {
    throw new Error(
      `Prepare Creative Operation recebeu job incompleto: ${job.job_key || "sem-chave"}.`,
    );
  }
  const payloadHash = stableHash(stable(job.creativePayload));
  return {
    json: {
      ...job,
      gateway_request: {
        action: "create_creative",
        operation_key: key(
          `creative:v3:${payloadHash}:${job.run_id}:${job.destination_group}:${job.media_variant || "static_flexible"}`,
        ),
        token_id: text(job.token_id),
        account_id: text(job.account_id),
        api_version: text(job.api_version || "v25.0"),
        ...trackingGatewayFields(job, job.creativePayload),
        payload: job.creativePayload,
      },
    },
    binary: item.binary,
  };
});
