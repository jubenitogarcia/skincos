function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function stableHash(value) {
  let hash = 2166136261;
  for (const char of text(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

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
    // Destinations may represent different units that publish through the
    // same ad account. Video upload is account-scoped, just like image
    // upload, so starting it once per destination creates duplicate videos
    // and violates the aggregate's exact-count contract.
    const accounts = new Map();
    for (const destination of list(group.destinations)) {
      const accountId = text(destination.destination_ad_account_id || destination.account_id).replace(/^act_/, '');
      const tokenId = text(destination.token_id);
      const apiVersion = text(destination.destination_api_version || destination.api_version || 'v25.0');
      if (!accountId || !tokenId) throw new Error(`Destino de video incompleto em ${group.job_key}.`);
      accounts.set(accountId, { accountId, tokenId, apiVersion });
    }
    for (const { accountId, tokenId, apiVersion } of accounts.values()) {
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
          // A prior workflow revision used only the normalized asset identity.
          // Token, Graph version and normalized byte count are part of the
          // gateway request hash, so omit them here and a replay can collide
          // with a record produced by the old request shape. Keep the v3 key
          // stable for exact replays, yet distinct for every semantic request.
          operation_key: `video-start:v3:${stableHash([runId, accountId, tokenId, apiVersion, fileSize, video.id, processing.output_checksum_sha256 || video.output_checksum_sha256].map(text).join('|'))}`,
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
