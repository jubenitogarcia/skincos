function pairedIndex(item, fallback) {
  const paired = item?.pairedItem;
  if (Array.isArray(paired) && paired.length) return Number(paired[0].item ?? fallback);
  return Number(paired?.item ?? fallback);
}
const prepared = $items('Prepare Video Upload Starts') || [];
return $input.all().map((item, index) => {
  const sourceIndex = pairedIndex(item, index);
  const source = prepared[sourceIndex]?.json || {};
  const response = item.json || {};
  if (response.ok !== true || response.operation?.status !== 'completed') throw new Error(`Inicio de upload de video falhou: ${JSON.stringify(response.detail || response.error || response)}`);
  const result = response.operation.result || {};
  if (!result.upload_session_id || !result.video_id) throw new Error('Inicio de upload sem sessao ou video_id.');
  const semanticReplay = response.semantic_replay === true;
  const replayCompletionOffset = Number(source.file_size || 0);
  if (semanticReplay && (!Number.isSafeInteger(replayCompletionOffset) || replayCompletionOffset <= 0)) {
    throw new Error('Replay semantico de video sem tamanho normalizado valido.');
  }
  return { json: {
    ...source,
    upload_session_id: String(result.upload_session_id),
    video_id: String(result.video_id),
    // A semantic replay is selected only from resume_jobs whose video was
    // already validated as ready. Do not reopen an old chunk session against
    // a newly normalized temporary file; jump to the idempotent finish/status
    // checks for the same persisted video_id.
    start_offset: semanticReplay ? replayCompletionOffset : Number(result.start_offset),
    end_offset: semanticReplay ? replayCompletionOffset : Number(result.end_offset),
    upload_generation: 1,
    transfer_count: 0,
    start_operation_key: response.operation.operation_key,
    replayed_start: response.replayed === true,
    semantic_replay_video_id: response.replayed === true ? String(result.video_id) : '',
    semantic_replay_ready: semanticReplay,
    upload_bytes_complete: semanticReplay,
  } };
});
