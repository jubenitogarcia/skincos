return $input.all().map((item) => {
  const value = item.json || {};
  if (Number(value.exitCode) !== 0 || value.error) throw new Error(`Falha ao fatiar video: ${value.stderr || value.error}`);
  let parsed;
  try { parsed = JSON.parse(String(value.stdout || '{}')); } catch { throw new Error('Saida do fatiador de video invalida.'); }
  if (!parsed.chunk_file || !parsed.state) throw new Error('Fatiador nao retornou chunk_file/state.');
  return { json: parsed };
});
