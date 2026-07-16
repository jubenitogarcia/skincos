import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProxyUrl } from '../src/utils/makeProxyAgent';
import { constantTimeTokenMatch, validMetaChallenge } from '../src/utils/metaWebhookVerification';

test('proxy configuration accepts bounded supported endpoints', () => {
  const proxy = buildProxyUrl({
    protocol: 'https',
    host: 'proxy.example.com',
    port: '8443',
    username: 'operator@example.com',
    password: 'private/value',
  });
  assert.equal(proxy.protocol, 'https:');
  assert.equal(proxy.hostname, 'proxy.example.com');
  assert.equal(proxy.port, '8443');
  assert.equal(proxy.username, 'operator%40example.com');
});

test('proxy configuration rejects injected URL components', () => {
  assert.throws(() => buildProxyUrl({ protocol: 'file', host: 'localhost', port: '80' }));
  assert.throws(() => buildProxyUrl({ protocol: 'http', host: 'proxy.example/path', port: '80' }));
  assert.throws(() => buildProxyUrl('http://proxy.example.com:8080/path'));
  assert.throws(() => buildProxyUrl('http://proxy.example.com:8080?target=internal'));
  assert.throws(() => buildProxyUrl({ protocol: 'http', host: 'proxy.example.com', port: '99999' }));
});

test('Meta webhook verification requires an exact token and inert challenge', () => {
  assert.equal(constantTimeTokenMatch('secret', 'secret'), true);
  assert.equal(constantTimeTokenMatch('secrex', 'secret'), false);
  assert.equal(validMetaChallenge('challenge_123-abc'), true);
  assert.equal(validMetaChallenge('<script>alert(1)</script>'), false);
  assert.equal(validMetaChallenge('x'.repeat(257)), false);
});
