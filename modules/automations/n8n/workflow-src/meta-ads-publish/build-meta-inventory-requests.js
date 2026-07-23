function text(value) { return String(value ?? '').trim(); }

const byAccount = new Map();
for (const item of $input.all()) {
  const row = item.json || {};
  const accountId = text(row.account_id).replace(/^act_/, '');
  const tokenId = text(row.token_id);
  const apiVersion = text(row.api_version || 'v25.0');
  if (!accountId || !tokenId) throw new Error(`Destino sem account_id/token_id: ${row.destination_group || 'desconhecido'}.`);
  const key = `${accountId}:${apiVersion}`;
  if (!byAccount.has(key)) {
    byAccount.set(key, {
      token_id: tokenId,
      account_id: accountId,
      api_version: apiVersion,
      destination_groups: [],
      adsets: [],
    });
  }
  const request = byAccount.get(key);
  request.destination_groups.push(text(row.destination_group));
  request.adsets.push({
    adset_id: text(row.adset_id),
    destination_group: text(row.destination_group),
  });
  request.alternate_token_ids = [
    ...new Set([...(request.alternate_token_ids || []), tokenId]),
  ];
}

return [...byAccount.values()].map((request) => ({
  json: {
    ...request,
    destination_groups: [...new Set(request.destination_groups.filter(Boolean))],
    alternate_token_ids: [...new Set(request.alternate_token_ids || [])],
    adsets: [...new Map(request.adsets.filter((entry) => entry.adset_id)
      .map((entry) => [entry.adset_id, entry])).values()],
  },
}));
