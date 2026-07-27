function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function isNineBySixteen(widthValue, heightValue) {
  const width = Number(widthValue);
  const height = Number(heightValue);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && Math.abs((width / height) - (9 / 16)) <= 0.002;
}
function stableHash(value) {
  let hash = 2166136261;
  for (const char of text(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const VIDEO_NORMALIZATION_CONTRACT_REVISION = 'video9x16_h264_aac_v1';

function resumableVideoId(group, accountId, sourceFileId) {
  let restored = [];
  try { restored = $items('Restore Publish Groups') || []; } catch (error) { restored = []; }
  const candidates = restored
    .flatMap((entry) => list(entry?.json?.resume_jobs))
    .filter((job) => text(job.account_id || job.destination_ad_account_id).replace(/^act_/, '') === accountId)
    .filter((job) => text(job.asset_ids?.vertical_video) === sourceFileId)
    .filter((job) => text(job.video_status).toLowerCase() === 'ready')
    .map((job) => text(job.video_id))
    .filter((value) => /^\d{5,30}$/.test(value));
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : '';
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
    const width = Number(processing.width || video.width || 0);
    const height = Number(processing.height || video.height || 0);
    if (!isNineBySixteen(width, height)) throw new Error(`Video ${video.id} nao esta em 9:16 apos normalizacao: ${width}x${height}.`);
    const batchFile = list(group.batch_files).find((entry) => text(entry.id) === text(video.id)) || {};
    const sourceFingerprint = text(
      video.md5_checksum || inventory?.source_md5_checksum || batchFile.md5_checksum ||
      [video.id, video.modified_time || batchFile.modified_time, video.size || batchFile.size].map(text).join('|')
    );
    if (!sourceFingerprint) throw new Error(`Video ${video.id} sem fingerprint estavel do arquivo fonte.`);
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
      const resumeVideoId = resumableVideoId(group, accountId, text(video.id));
      outputs.push({ json: {
        run_id: runId,
        job_key: text(group.job_key),
        source_file_id: text(video.id),
        source_file_name: text(video.original_name || video.name),
        normalized_file: normalizedFile,
        output_dir: text(processing.output_dir || normalizedFile.replace(/\/[^/]+$/, '')),
        file_size: fileSize,
        video_width: width,
        video_height: height,
        video_aspect_ratio: '9x16',
        video_recommended_aspect_ratio: '9x16',
        checksum_sha256: text(processing.output_checksum_sha256 || video.output_checksum_sha256),
        source_fingerprint: sourceFingerprint,
        normalization_contract_revision: VIDEO_NORMALIZATION_CONTRACT_REVISION,
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
          operation_key: `video-start:v4:${stableHash([runId, accountId, tokenId, apiVersion, video.id, sourceFingerprint, VIDEO_NORMALIZATION_CONTRACT_REVISION].map(text).join('|'))}`,
          token_id: tokenId,
          account_id: accountId,
          api_version: apiVersion,
          source_file_id: text(video.id),
          file_size: fileSize,
          file_checksum: text(processing.output_checksum_sha256 || video.output_checksum_sha256),
          source_fingerprint: sourceFingerprint,
          normalization_contract_revision: VIDEO_NORMALIZATION_CONTRACT_REVISION,
          resume_video_id: resumeVideoId || undefined,
        },
      } });
    }
  }
}
return outputs;
