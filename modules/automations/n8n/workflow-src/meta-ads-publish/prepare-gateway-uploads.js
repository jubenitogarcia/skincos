function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function key(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 160); }

const outputs = [];
for (const item of $input.all()) {
  const group = item.json || {};
  const runId = text(group.run_id);
  if (!runId) throw new Error('Prepare Gateway Uploads sem run_id.');
  const accounts = new Map();
  for (const destination of list(group.destinations)) {
    const accountId = text(destination.destination_ad_account_id || destination.account_id).replace(/^act_/, '');
    const tokenId = text(destination.token_id);
    const apiVersion = text(destination.destination_api_version || destination.api_version || 'v25.0');
    if (!accountId || !tokenId) throw new Error(`Destino incompleto em ${group.job_key}.`);
    accounts.set(accountId, { accountId, tokenId, apiVersion });
  }
  for (const image of list(group.imagens)) {
    const binaryKey = text(image.binary_key || 'data');
    const binary = item.binary && item.binary[binaryKey];
    if (!binary) throw new Error(`Binario ${binaryKey} ausente para ${image.original_name || image.name}.`);
    for (const account of accounts.values()) {
      const operationKey = key(`upload:${runId}:${account.accountId}:${image.id}`);
      outputs.push({
        json: {
          run_id: runId,
          job_key: text(group.job_key),
          ratio: text(image.proporcao),
          source_file_id: text(image.id),
          source_file_name: text(image.original_name || image.name),
          account_id: account.accountId,
          _gateway_account_id: account.accountId,
          gateway_request: {
            action: 'upload_image',
            operation_key: operationKey,
            token_id: account.tokenId,
            account_id: account.accountId,
            api_version: account.apiVersion,
            file_name: text(image.original_name || image.name),
          },
        },
        binary: { data: binary },
      });
    }
  }
}
if (!outputs.length) throw new Error('Prepare Gateway Uploads terminou sem itens.');
return outputs;
