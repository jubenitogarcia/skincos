const crypto = require('crypto');

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function sha256(value) {
  const input = typeof value === 'string' ? value : canonicalize(value);
  return crypto.createHash('sha256').update(input).digest('hex');
}

function semanticCopy(value) {
  if (Array.isArray(value)) return value.map(semanticCopy);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['created_at', 'updated_at', 'generated_at', 'timestamp'].includes(key)).map(([key, item]) => [key, semanticCopy(item)]));
}

module.exports = { canonicalize, sha256, semanticCopy };
