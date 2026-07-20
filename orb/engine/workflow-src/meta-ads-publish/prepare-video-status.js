function key(value) { return String(value ?? '').trim().replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 190); }
return $input.all().map((item) => {
  const state = item.json || {};
  const attempt = Number(state.status_attempt || 0) + 1;
  if (attempt > 60) throw new Error(`Video ${state.video_id} nao ficou ready apos 60 consultas.`);
  return { json: { ...state, status_attempt: attempt, gateway_request: {
    action: 'get_video_status',
    operation_key: key(`video-status:${state.run_id}:${state.account_id}:${state.video_id}:${attempt}`),
    token_id: state.token_id,
    account_id: state.account_id,
    api_version: state.api_version,
    object_id: state.video_id,
    source_file_id: state.source_file_id,
  } } };
});
