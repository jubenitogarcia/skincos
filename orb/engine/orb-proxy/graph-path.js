const GRAPH_PATH = /^(?:[A-Za-z0-9_.-]+)(?:\/[A-Za-z0-9_.-]+)*$/;

function normalizeGraphPath(value) {
  const normalized = String(value || '').trim();
  if (!GRAPH_PATH.test(normalized) || normalized.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Invalid Graph API path.');
  }
  return normalized;
}

module.exports = { normalizeGraphPath };
