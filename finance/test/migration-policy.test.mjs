import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationDirectory = new URL('../migrations/', import.meta.url);

test('Finance production migrations contain no forbidden DROP statements', async () => {
  const files = (await readdir(migrationDirectory)).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
  assert.deepEqual(files.slice(-1), ['0013_finance_additive_trigger_contract.sql']);
  for (const file of files) {
    const source = await readFile(new URL(file, migrationDirectory), 'utf8');
    const statements = source.replace(/^--.*$/gm, '');
    assert.doesNotMatch(statements, /\bDROP\b/i, `${file} violates the additive migration policy`);
  }
});

test('fresh databases receive draft-aware guards without trigger replacement', async () => {
  const v7 = await readFile(new URL('0007_finance_security_integrity.sql', migrationDirectory), 'utf8');
  const v8 = await readFile(new URL('0008_finance_draft_revision.sql', migrationDirectory), 'utf8');
  const v13 = await readFile(new URL('0013_finance_additive_trigger_contract.sql', migrationDirectory), 'utf8');

  assert.match(
    v7,
    /finance_movements_immutable_fields BEFORE UPDATE OF scope_id,source,external_id,created_by,created_at,submitted_at/,
  );
  assert.match(v7, /finance_movement_splits_no_delete BEFORE DELETE[\s\S]+status='draft'[\s\S]+operational_status='pending'/);
  assert.match(v7, /finance_installments_immutable_fields BEFORE UPDATE[\s\S]+status='draft'[\s\S]+operational_status='pending'/);
  assert.doesNotMatch(v8.replace(/^--.*$/gm, ''), /\bDROP\b/i);
  for (const trigger of [
    'finance_movements_identity_immutable_v13',
    'finance_movement_splits_posted_no_delete_v13',
    'finance_installments_posted_immutable_v13',
  ]) {
    assert.match(v13, new RegExp(`CREATE TRIGGER IF NOT EXISTS ${trigger}`));
  }
});
