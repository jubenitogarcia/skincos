function s(value) {
  return value == null ? '' : String(value).trim();
}

const unique = [];
const seen = new Set();

for (const item of items) {
  const json = item.json || {};
  const key = [s(json.account_id), s(json.api_version)].join('::');
  if (!key || seen.has(key)) continue;
  seen.add(key);
  unique.push({
    json: {
      ...json,
      inventory_scope_key: key,
      inventory_scope_source: 'google_sheets_deduplicated',
    },
  });
}

return unique;
