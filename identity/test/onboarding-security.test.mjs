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

test('team accounts accept both the unique username and corporate email at login', async () => {
  const auth = await readFile(new URL('../routes/auth.js', import.meta.url), 'utf8');
  const store = await readFile(new URL('../store/d1.js', import.meta.url), 'utf8');
  assert.match(auth, /body\.username \|\| body\.user \|\| body\.email/);
  assert.match(auth, /d1\.getUserByIdentifier\(usernameInput\)/);
  assert.match(store, /LOWER\(username\) = LOWER\(\?\) OR \(email IS NOT NULL AND email != '' AND LOWER\(email\) = LOWER\(\?\)\)/);
});

test('authentication failures do not disclose inactive or passwordless account state', async () => {
  const auth = await readFile(new URL('../routes/auth.js', import.meta.url), 'utf8');
  assert.match(auth, /if \(!userDb\.ativo\)[\s\S]*Invalid credentials/);
  assert.match(auth, /if \(!userDb\.passwordHash\)[\s\S]*Invalid credentials/);
  assert.doesNotMatch(auth, /error: "User inactive"/);
  assert.doesNotMatch(auth, /error: "Password not set"/);
  assert.match(auth, /Do not return the expiry before the one-time code is proven/);
});
