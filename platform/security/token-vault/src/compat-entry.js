import { handleRequest } from './index.js';

const TOKEN_PREFIX = '/internal/token-vault';
const LEGACY_TOKEN_METADATA_PATH = '/v1/token-metadata';
const CANONICAL_TOKEN_LIST_PATH = '/v1/tokens';

function normalizedPath(pathname) {
  if (pathname === TOKEN_PREFIX) return '/';
  if (pathname.startsWith(`${TOKEN_PREFIX}/`)) return pathname.slice(TOKEN_PREFIX.length);
  return pathname;
}

export function rewriteLegacyTokenMetadataRequest(request) {
  if (request.method !== 'GET') return request;

  const url = new URL(request.url);
  if (normalizedPath(url.pathname) !== LEGACY_TOKEN_METADATA_PATH) return request;

  url.pathname = url.pathname.replace(/\/v1\/token-metadata$/, CANONICAL_TOKEN_LIST_PATH);
  return new Request(url.toString(), {
    method: 'GET',
    headers: request.headers,
    redirect: request.redirect,
  });
}

export async function handleCompatRequest(request, env, ctx) {
  return handleRequest(rewriteLegacyTokenMetadataRequest(request), env, ctx);
}

export default {
  async fetch(request, env, ctx) {
    return handleCompatRequest(request, env, ctx);
  },
};
