function pairedIndex(item, fallback) {
  const paired = item?.pairedItem;
  return Number((Array.isArray(paired) ? paired[0]?.item : paired?.item) ?? fallback);
}

const sourceItems = $items('Is Video?') || [];

return $input.all().map((item, index) => {
  const result = item.json || {};
  if (Number(result.exitCode) !== 0 || result.error) {
    throw new Error(`Nao foi possivel preparar o diretorio temporario do video: ${result.stderr || result.error || 'comando sem detalhes'}`);
  }
  const source = sourceItems[pairedIndex(item, index)];
  if (!source?.json?.media_staging?.input_file || !source?.json?.media_staging?.base_dir) {
    throw new Error('Contexto de staging de video ausente apos preparar o diretorio.');
  }
  return { json: source.json, binary: source.binary, pairedItem: source.pairedItem };
});
