function key(value) { return String(value ?? '').trim().replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 190); }
return $input.all().map((item) => {
  const state = item.json || {};
  if (Number(state.start_offset) !== Number(state.end_offset)) throw new Error('Finish solicitado antes do upload completo.');
  return { json: { ...state, gateway_request: {
    action: 'finish_video_upload',
    operation_key: key(`video-finish:${state.run_id}:${state.account_id}:${state.source_file_id}:${state.upload_session_id}`),
    token_id: state.token_id,
    account_id: state.account_id,
    api_version: state.api_version,
    source_file_id: state.source_file_id,
    upload_session_id: state.upload_session_id,
    title: state.source_file_name,
  } } };
});
