function pairedIndex(item, fallback) {
  const paired = item?.pairedItem;
  if (Array.isArray(paired) && paired.length) return Number(paired[0].item ?? fallback);
  return Number(paired?.item ?? fallback);
}
function key(value) { return String(value ?? '').trim().replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 190); }
const sliced = $items('Parse Video Slice') || [];
return $input.all().map((item, index) => {
  const sourceIndex = pairedIndex(item, index);
  const slice = sliced[sourceIndex]?.json || {};
  const state = slice.state || {};
  if (!item.binary?.data) throw new Error('Chunk lido sem binario data.');
  return {
    json: {
      ...state,
      chunk_file: slice.chunk_file,
      chunk_size: Number(slice.chunk_size),
      gateway_request: {
        action: 'transfer_video_chunk',
        operation_key: key(`video-transfer:${state.run_id}:${state.account_id}:${state.source_file_id}:${state.upload_session_id}:${state.start_offset}`),
        token_id: state.token_id,
        account_id: state.account_id,
        api_version: state.api_version,
        source_file_id: state.source_file_id,
        upload_session_id: state.upload_session_id,
        start_offset: Number(state.start_offset),
        file_name: `video-${state.start_offset}.part`,
        file_checksum: state.checksum_sha256,
      },
    },
    binary: { data: item.binary.data },
  };
});
