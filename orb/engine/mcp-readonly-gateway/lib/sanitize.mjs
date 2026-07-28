const MAX_TEXT = 800;

const sensitiveKey = /(?:authorization|cookie|credential|secret|clientsecret|token|password|api[_-]?key|refresh|binary|payload|body|form|patient|cpf|email|phone|telefone|message|mensagem|clinical|clinico|medical|medic|query|sql|env)/i;
const secretValue = /\b(?:bearer\s+|basic\s+|api[_ -]?key\s*[=:]\s*|token\s*[=:]\s*|password\s*[=:]\s*|client[_ -]?secret\s*[=:]\s*|refresh[_ -]?token\s*[=:]\s*|secret\s*[=:]\s*)[^\s,;"'}]+/gi;
const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const cpf = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const phone = /(?<![A-Za-z0-9])(?:\+?55\s?)?\(?[1-9]\d\)?\s?9?\d{4}[-\s]?\d{4}(?![A-Za-z0-9])/g;
const signedUrl = /https?:\/\/[^\s"']*(?:[?&](?:signature|sig|token|access_token|x-amz-signature)=)[^\s"']*/gi;
const urlPassword = /([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;
const authorizationHeader = /(authorization\s*:\s*)(?:bearer|basic)\s+[^\s,;]+/gi;
const apiKeyQuery = /([?&](?:api[_-]?key|apikey|access_token|refresh_token)=)[^&\s]+/gi;
const envAssignment = /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|COOKIE|AUTH)[A-Z0-9_]*\s*=\s*[^\s,;]+/g;
const sqlLiteral = /\b(?:select|insert|update|delete|from|where|set|values|execute|alter|drop)\b[\s\S]{0,240}?(['"])(?:\\.|(?!\1).)*\1/gi;

export function sanitizeText(value, maxLength = MAX_TEXT) {
  if (value === null || value === undefined) return '';
  let text = String(value)
    .replace(signedUrl, '[redacted-signed-url]')
    .replace(urlPassword, '$1[redacted-url-credentials]@')
    .replace(authorizationHeader, '$1[redacted-authorization]')
    .replace(/\b(?:authorization|cookie)\s*:\s*/gi, '[redacted-header]')
    .replace(apiKeyQuery, '$1[redacted-api-key]')
    .replace(envAssignment, '[redacted-env]')
    .replace(secretValue, '[redacted-secret]')
    .replace(sqlLiteral, '[redacted-sql]')
    .replace(email, '[redacted-email]')
    .replace(cpf, '[redacted-cpf]')
    .replace(phone, '[redacted-phone]');
  if (text.length > maxLength) text = `${text.slice(0, maxLength)}…[truncated]`;
  return text;
}

export function sanitizeValue(value, depth = 0) {
  if (depth > 8) return '[truncated-depth]';
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value !== 'object') return '[unsupported]';
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveKey.test(key))
      .slice(0, 100)
      .map(([key, item]) => [sanitizeText(key, 120), sanitizeValue(item, depth + 1)]),
  );
}

export function sanitizeErrorMessage(value) {
  return sanitizeText(value, 600)
    .replace(/\{[\s\S]{80,}\}/g, '[redacted-structured-payload]')
    .replace(/\[[\s\S]{120,}\]/g, '[redacted-list-payload]');
}

export function hasSensitiveMaterial(value) {
  let text;
  try { text = JSON.stringify(value); } catch { return true; }
  const unmasked = text.replace(/\[redacted-[^\]]+\]/gi, '');
  return /(?:Bearer\s+[A-Za-z0-9._-]{8,}|api[_-]?key\s*[=:]|password\s*[=:]|client[_ -]?secret\s*[=:]|refresh[_ -]?token\s*[=:]|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:authorization|cookie)\s*:\s*[^\s,;]+)/i.test(unmasked);
}
