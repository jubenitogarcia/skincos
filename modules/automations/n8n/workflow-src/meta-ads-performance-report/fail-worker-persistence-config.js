function safeString(value) {
  return value == null ? '' : String(value).trim();
}

const outputs = $input.all().map((item) => {
  const json = item.json || {};
  return {
    metrics_group_key: safeString(json.metrics_group_key),
    report_date: safeString(json.report_date),
    run_id: safeString(json.run_context?.run_id),
    persistence_target_url: safeString(json.persistence_target_url),
    persistence_error: safeString(json.persistence_error || 'Persistência não habilitada.'),
  };
});

throw new Error(JSON.stringify({
  type: 'worker_persistence_config_error',
  items: outputs,
}));
