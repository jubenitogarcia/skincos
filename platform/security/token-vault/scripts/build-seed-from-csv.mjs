#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: TOKEN_VAULT_API_TOKEN=... npm run seed:from-csv -- ./credentials.csv [baseUrl]');
  process.exit(1);
}

const csv = fs.readFileSync(inputPath, 'utf8');
const baseUrl = clean(process.argv[3] || process.env.TOKEN_VAULT_BASE_URL || 'https://api.skincos.com.br/internal/token-vault');
const apiToken = clean(process.env.TOKEN_VAULT_API_TOKEN);
if (!apiToken) {
  console.error('TOKEN_VAULT_API_TOKEN is required.');
  process.exit(1);
}

const rows = parseCsv(csv);
if (!rows.length) {
  console.error('No rows found.');
  process.exit(1);
}

const header = rows[0].map((value) => value.trim());
const bodyRows = rows.slice(1).map((row) => Object.fromEntries(header.map((key, index) => [key, row[index] || ''])));
const payloads = [];
const stats = { threads: 0, instagram: 0, facebook: 0 };

for (const row of bodyRows) {
  const unit = slug(row.Unit || row.unit || '');
  const thId = clean(row.thId);
  const thToken = clean(row.thToken);
  const igId = clean(row.igId);
  const igToken = clean(row.igToken);
  const fbId = clean(row.fbId);
  const fbToken = clean(row.fbToken);

  if (thId && thToken) {
    stats.threads += 1;
    payloads.push(buildPayload({ provider: 'threads', unit, externalAccountId: thId, token: thToken, source: row }));
  }
  if (igId && igToken) {
    stats.instagram += 1;
    payloads.push(buildPayload({ provider: 'instagram', unit, externalAccountId: igId, token: igToken, source: row }));
  }
  if (fbId && fbToken) {
    stats.facebook += 1;
    payloads.push(buildPayload({ provider: 'facebook', unit, externalAccountId: fbId, token: fbToken, source: row }));
  }
}

console.error(`Importing token rows through API: threads=${stats.threads} instagram=${stats.instagram} facebook=${stats.facebook}`);

for (const payload of payloads) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/tokens`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    console.error(`Import failed for ${payload.provider}:${payload.external_account_id}: ${response.status} ${body.error || 'unknown_error'}`);
    process.exit(1);
  }
  console.error(`Imported ${payload.provider}:${payload.external_account_id} token=[redacted:${payload.token.length}]`);
}

console.error('Import completed.');

function buildPayload({ provider, unit, externalAccountId, token, source }) {
  const id = `${provider}_${externalAccountId}`;
  const metadata = {
    imported_from: 'token-manager-google-sheets',
    imported_file: path.basename(inputPath),
    legacy_columns: Object.fromEntries(
      Object.entries(source).filter(([key]) => !['thToken', 'igToken', 'fbToken'].includes(key)),
    ),
  };
  return {
    id,
    provider,
    unit,
    external_account_id: externalAccountId,
    token_type: 'long_lived_access_token',
    token,
    active: true,
    imported: true,
    metadata,
  };
}

function parseCsv(value) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((item) => item.some((fieldValue) => fieldValue.trim()));
}

function clean(value) {
  return String(value ?? '').trim();
}

function slug(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
