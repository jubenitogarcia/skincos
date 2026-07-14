// @ts-nocheck

import { resolveCrmTables } from '../d1Store.js';

const ROLE_ANY = ['CONSULTOR', 'OPERADOR', 'GERENTE', 'GESTOR', 'ADMIN'];

function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function jsonBytes(value) {
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return String(value || '').length;
  }
}

export async function handlePrefsRoutes({
  request,
  url,
  env,
  appOrigin,
  withCORS,
  requireRoles,
}) {
  if (!url.pathname.startsWith('/prefs')) return null;

  const auth = await requireRoles(ROLE_ANY);
  if (!auth.ok) return auth.response;

  if (!env?.DB) {
    return withCORS(JSON.stringify({ success: false, error: 'DB_NOT_CONFIGURED' }), { status: 500 }, appOrigin);
  }

  const username = String(auth?.user?.username || '').trim();
  if (!username) {
    return withCORS(JSON.stringify({ success: false, error: 'Not authenticated' }), { status: 401 }, appOrigin);
  }

  const { userPrefsTable } = await resolveCrmTables(env);

  // GET /prefs
  if (url.pathname === '/prefs' && request.method === 'GET') {
    try {
      const row = await env.DB.prepare(
        `SELECT prefs_json, updated_at FROM ${userPrefsTable} WHERE username = ? LIMIT 1`
      )
        .bind(username)
        .first();

      const prefs = safeJsonParse(row?.prefs_json) || null;
      return withCORS(
        JSON.stringify({ success: true, prefs, updatedAt: row?.updated_at || null }),
        { status: 200 },
        appOrigin
      );
    } catch (err) {
      return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
    }
  }

  // PUT /prefs
  if (url.pathname === '/prefs' && request.method === 'PUT') {
    try {
      const payload = await request.json();
      const prefs = payload?.prefs ?? {};
      const prefsJson = JSON.stringify(prefs ?? {});
      if (jsonBytes(prefsJson) > 100 * 1024) {
        return withCORS(JSON.stringify({ success: false, error: 'PREFS_TOO_LARGE' }), { status: 413 }, appOrigin);
      }

      await env.DB.prepare(
        `INSERT INTO ${userPrefsTable} (username, prefs_json, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(username) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = excluded.updated_at`
      )
        .bind(username, prefsJson)
        .run();

      return withCORS(JSON.stringify({ success: true }), { status: 200 }, appOrigin);
    } catch (err) {
      return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 400 }, appOrigin);
    }
  }

  // DELETE /prefs
  if (url.pathname === '/prefs' && request.method === 'DELETE') {
    try {
      await env.DB.prepare(`DELETE FROM ${userPrefsTable} WHERE username = ?`).bind(username).run();
      return withCORS(JSON.stringify({ success: true }), { status: 200 }, appOrigin);
    } catch (err) {
      return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
    }
  }

  return withCORS(JSON.stringify({ success: false, error: 'NOT_FOUND' }), { status: 404 }, appOrigin);
}
