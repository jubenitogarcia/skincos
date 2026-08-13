function text(value) {
  return String(value ?? "").trim();
}
function list(value) {
  return Array.isArray(value) ? value : [];
}

// The run fingerprint must change when the Meta creative contract changes;
// otherwise a corrected payload collides with a failed operation for the same
// Drive lot and cannot be retried safely by the idempotency gateway.
const PUBLISH_CONTRACT_REVISION =
  "creative_payload_v14_tracking_reconciliation";

const groups = $input.all().map((item) => item.json || {});
if (!groups.length) throw new Error("Prepare Publish Run recebeu zero grupos.");

const revisions = [
  ...new Set(
    groups.map((group) => text(group.config_revision)).filter(Boolean),
  ),
];
if (revisions.length !== 1)
  throw new Error(
    `Revisao de configuracao inconsistente: ${JSON.stringify(revisions)}`,
  );
const trackingBindingRevisions = [
  ...new Set(
    groups
      .map((group) =>
        text(group.tracking_binding_revision || group.config_revision),
      )
      .filter(Boolean),
  ),
];
if (
  trackingBindingRevisions.length !== 1 ||
  trackingBindingRevisions[0] !== revisions[0]
) {
  throw new Error(
    `Revisao estavel de tracking inconsistente: ${JSON.stringify(trackingBindingRevisions)}.`,
  );
}
const workflowRevisions = [
  ...new Set(
    groups
      .map((group) => text(group.workflow_contract_revision))
      .filter(Boolean),
  ),
];
if (
  workflowRevisions.length !== 1 ||
  workflowRevisions[0] !==
    "meta_destination_contract_v20_tracking_reconciliation"
) {
  throw new Error(
    `Revisao de contrato do workflow inconsistente: ${JSON.stringify(workflowRevisions)}.`,
  );
}

const byId = new Map();
for (const group of groups) {
  for (const file of list(group.batch_files)) {
    const id = text(file.id);
    if (!id) continue;
    const normalized = {
      id,
      name: text(file.name),
      md5_checksum: text(file.md5_checksum || file.md5Checksum),
      modified_time: `${text(file.modified_time || file.modifiedTime)}#${PUBLISH_CONTRACT_REVISION}`,
      size: text(file.size),
    };
    const previous = byId.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) {
      throw new Error(`Metadados divergentes para o arquivo ${id}.`);
    }
    byId.set(id, normalized);
  }
}

const files = [...byId.values()].sort((left, right) =>
  left.id.localeCompare(right.id),
);
if (!files.length)
  throw new Error(
    "Prepare Publish Run nao encontrou arquivos para o fingerprint.",
  );

return [
  {
    json: {
      config_revision: revisions[0],
      tracking_binding_revision: trackingBindingRevisions[0],
      workflow_contract_revision: workflowRevisions[0],
      workflow_execution_id: String($execution.id),
      files,
      group_count: groups.length,
      group_keys: groups.map((group) =>
        text(group.creative_group_key || group.group_key),
      ),
    },
  },
];
