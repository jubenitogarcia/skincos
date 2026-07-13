function safeString(value) {
  return value == null ? '' : String(value).trim();
}

return items.map((item) => {
  const source = item.json || {};
  const persistence = source.report_history_persistence || {};
  const endpointUnavailable = persistence.endpoint_unavailable === true;
  const idempotentReplay = persistence.idempotent_replay === true;
  const inProgress = persistence.in_progress === true;
  const supported = endpointUnavailable !== true;
  const shouldSend = source.should_send_whatsapp !== false && (!supported || (!idempotentReplay && !inProgress));

  let idempotencyStatus = 'fresh_send';
  let idempotencyNote = 'Nenhum replay detectado no persist layer.';

  if (endpointUnavailable) {
    idempotencyStatus = 'not_checked_runtime';
    idempotencyNote = 'O endpoint dedicado de report history ainda nao esta publicado no Worker live; envio mantido sem bloqueio de replay remoto.';
  } else if (idempotentReplay) {
    idempotencyStatus = 'already_persisted_skip_send';
    idempotencyNote = 'O Worker retornou idempotentReplay=true para este report_key.';
  } else if (inProgress) {
    idempotencyStatus = 'in_progress_skip_send';
    idempotencyNote = 'O Worker retornou inProgress=true; envio suprimido para evitar duplicidade concorrente.';
  }

  return {
    json: {
      ...source,
      idempotency_status: idempotencyStatus,
      idempotency_check_supported: supported,
      idempotency_note: idempotencyNote,
      should_send_whatsapp: shouldSend,
      ready_for_whatsapp: source.ready_for_whatsapp !== false && shouldSend,
    },
  };
});
