const crypto = require('crypto');

function normalizeInstagramHandle(value) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9._]{1,30}$/.test(normalized)) {
    throw new Error('Invalid Instagram handle.');
  }
  return normalized;
}

function isAuthorizedToken(candidate, configuredToken) {
  const provided = Buffer.from(String(candidate || ''), 'utf8');
  const expected = Buffer.from(String(configuredToken || ''), 'utf8');
  return expected.length > 0 && provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

module.exports = { isAuthorizedToken, normalizeInstagramHandle };
