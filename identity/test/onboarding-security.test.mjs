import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('hierarchical auth keeps recovery anti-enumeration and personal contact private', async () => {
  const source = await readFile(new URL('../routes/auth.js', import.meta.url), 'utf8');
  assert.match(source, /Se a conta existir, enviaremos instruções ao contato cadastrado/);
  assert.match(source, /decryptOnboardingPersonalEmail\(env, contact\.personal_email_encrypted\)/);
  assert.match(source, /session_version = COALESCE\(session_version, 0\) \+ 1/);
  assert.match(source, /AUTH_SESSIONS_REVOKE_ALL/);
});
