function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function key(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 190); }

const outputs = [];
for (const item of $input.all()) {
  const group = item.json || {};
  const runId = text(group.run_id);
  for (const video of list(group.videos)) {
    const inventory = list(group.media_inventory).find((entry) => text(entry.source_file_id || entry.id) === text(video.id));
    const processing = inventory?.media_processing || video.media_processing || {};
    const fileSize = Number(processing.output_bytes || video.output_bytes || item.binary?.[video.binary_key]?.fileSize || 0);
    const normalizedFile = text(processing.normalized_file || video.normalized_file);
    if (!runId || !fileSize || !normalizedFile) throw new Error(`Video ${video.id} sem run_id, tamanho ou caminho normalizado.`);
    for (const destination of list(group.destinations)) {
      const accountId = text(destination.destination_ad_account_id || destination.account_id).replace(/^act_/, '');
      const tokenId = text(destination.token_id);
      const apiVersion = text(destination.destination_api_version || destination.api_version || 'v25.0');
      outputs.push({ json: {
        run_id: runId,
        job_key: text(group.job_key),
        source_file_id: text(video.id),
        source_file_name: text(video.original_name || video.name),
        normalized_file: normalizedFile,
        output_dir: text(processing.output_dir || normalizedFile.replace(/\/[^/]+$/, '')),
        file_size: fileSize,
        checksum_sha256: text(processing.output_checksum_sha256 || video.output_checksum_sha256),
        account_id: accountId,
        _gateway_account_id: accountId,
        token_id: tokenId,
        api_version: apiVersion,
        gateway_request: {
          action: 'start_video_upload',
          operation_key: key(`video-start:${runId}:${accountId}:${video.id}:${processing.output_checksum_sha256 || video.output_checksum_sha256}`),
          token_id: tokenId,
          account_id: accountId,
          api_version: apiVersion,
          source_file_id: text(video.id),
          file_size: fileSize,
          file_checksum: text(processing.output_checksum_sha256 || video.output_checksum_sha256),
        },
      } });
    }
  }
}
return outputs;
