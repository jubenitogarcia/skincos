function pairedIndex(item, fallback) { const p = item?.pairedItem; return Number((Array.isArray(p) ? p[0]?.item : p?.item) ?? fallback); }
function isNineBySixteen(widthValue, heightValue) {
  const width = Number(widthValue);
  const height = Number(heightValue);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && Math.abs((width / height) - (9 / 16)) <= 0.002;
}
const sourceItems = $items('Write Video Source') || [];
return $input.all().map((item, index) => {
  const value = item.json || {};
  if (Number(value.exitCode) !== 0 || value.error) throw new Error(`Processamento de video falhou: ${value.stderr || value.error}`);
  let processing;
  try { processing = JSON.parse(String(value.stdout || '{}')); } catch { throw new Error('Saida do processador de video invalida.'); }
  if (processing.ok !== true || !processing.normalized_file || !processing.contact_sheet_file || !processing.thumbnail_file) throw new Error(`Processamento de video incompleto: ${JSON.stringify(processing)}`);
  if (!isNineBySixteen(processing.width, processing.height)) throw new Error(`Video vertical precisa ser 9:16 apos normalizacao; recebido ${processing.width}x${processing.height}.`);
  const source = sourceItems[pairedIndex(item, index)]?.json || {};
  return { json: { ...source, media_processing: { ...processing, output_dir: source.media_staging?.output_dir, aspect_ratio: '9x16', recommended_aspect_ratio: '9x16', transcript: '', transcription_status: processing.has_audio ? 'pending' : 'not_applicable' } } };
});
