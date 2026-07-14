#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');

const APPLY = process.argv.includes('--apply');
const CREDENTIAL_ID = 'metaPublishGatewayBearer';
const TOKEN_FILE = process.env.TOKEN_VAULT_N8N_TOKEN_FILE
  || '/mnt/c/CodexRuntime/n8n/secrets/token-vault-n8n-api-token';
const CONFIG_FILE = process.env.N8N_CONFIG_FILE
  || '/mnt/c/CodexRuntime/n8n/n8n-home/.n8n/config';

function getKeyAndIv(salt, encryptionKey) {
  const password = Buffer.concat([Buffer.from(encryptionKey, 'binary'), salt]);
  const hash1 = crypto.createHash('md5').update(password).digest();
  const hash2 = crypto.createHash('md5').update(Buffer.concat([hash1, password])).digest();
  const iv = crypto.createHash('md5').update(Buffer.concat([hash2, password])).digest();
  return [Buffer.concat([hash1, hash2]), iv];
}

function encryptCredentialData(payload, encryptionKey) {
  const salt = crypto.randomBytes(8);
  const [key, iv] = getKeyAndIv(salt, encryptionKey);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('Salted__'), salt, encrypted]).toString('base64');
}

async function main() {
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  if (token.length < 32) throw new Error('Operational token file is missing or too short.');
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  if (!config.encryptionKey) throw new Error('n8n encryptionKey is missing.');

  const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
  const client = new Client({ user: 'postgres', host: '/var/run/postgresql', database: 'n8n_runtime' });
  await client.connect();
  try {
    const current = await client.query(
      `SELECT id, name, type, length(data) AS encrypted_length
         FROM n8n_runtime.credentials_entity
        WHERE id=$1`,
      [CREDENTIAL_ID],
    );
    if (!current.rows[0]) throw new Error(`Credential ${CREDENTIAL_ID} not found.`);
    if (current.rows[0].type !== 'httpBearerAuth') throw new Error('Gateway credential has an unexpected type.');

    if (APPLY) {
      const encrypted = encryptCredentialData({ token }, config.encryptionKey);
      await client.query('BEGIN');
      try {
        await client.query(
          `UPDATE n8n_runtime.credentials_entity
              SET data=$1, "updatedAt"=CURRENT_TIMESTAMP
            WHERE id=$2 AND type='httpBearerAuth'`,
          [encrypted, CREDENTIAL_ID],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log(JSON.stringify({
      ok: true,
      apply: APPLY,
      credentialId: CREDENTIAL_ID,
      credentialType: 'httpBearerAuth',
      tokenSource: 'private_runtime_overlay',
      tokenLength: token.length,
      tokenPrinted: false,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
