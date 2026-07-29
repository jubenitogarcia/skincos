function text(value) { return String(value ?? '').trim(); }
return $input.all().map((item) => {
  const state = item.json || {};
  const start = Number(state.start_offset);
  const end = Number(state.end_offset);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start || end - start > 16 * 1024 * 1024) {
    throw new Error(`Offsets de chunk invalidos ou acima de 16 MiB: ${start}-${end}.`);
  }
  const payload = {
    input_file: text(state.normalized_file),
    output_dir: `${text(state.output_dir)}/chunks_${text(state.account_id)}_${text(state.upload_session_id)}`,
    start_offset: start,
    end_offset: end,
    state,
  };
  return { json: { ...state, chunk_payload_b64: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64') } };
});
