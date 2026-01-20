// @ts-nocheck

const ROLE_ADMIN = ['ADMIN', 'GESTOR', 'GERENTE'];

function normalizeRole(role) {
  return String(role || 'CONSULTOR').trim().toUpperCase();
}

function normalizeAllowedUnits(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(String).map((x) => x.trim()).filter(Boolean);
    } catch { }
    return s.split(/[,;|]/g).map((x) => String(x || '').trim()).filter(Boolean);
  }
  return [];
}

function publicUser(user) {
  if (!user) return null;
  return {
    username: user.username,
    displayName: user.displayName || user.username,
    email: user.email || '',
    role: normalizeRole(user.role || 'CONSULTOR'),
    photoUrl: user.photoUrl || '',
    allowedUnits: Array.isArray(user.allowedUnits) ? user.allowedUnits : [],
    ativo: !!user.ativo,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

function randomPassword() {
  // human-friendly enough + avoids ambiguous chars; returned only once
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 14; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function handleAdminRoutes({
  request,
  url,
  env,
  appOrigin,
  withCORS,
  requireRoles,
  appendAuditLog,
  spreadsheetId,
  accessToken,
  ip,
  userAgent,
  idempotencyKey,
  bcrypt,
  validateUsername,
}) {
  if (!url.pathname.startsWith('/admin/')) return null;

  const auth = await requireRoles(ROLE_ADMIN);
  if (!auth.ok) return auth.response;

  if (!env?.DB) {
    return withCORS(JSON.stringify({ success: false, error: 'DB_NOT_CONFIGURED' }), { status: 500 }, appOrigin);
  }

  // GET /admin/users
  if (url.pathname === '/admin/users' && request.method === 'GET') {
    try {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') || '100', 10) || 100));
      const pagina = Math.max(1, parseInt(url.searchParams.get('pagina') || '1', 10) || 1);
      const offset = (pagina - 1) * limit;

      const where = [];
      const binds = [];
      if (q) {
        where.push('(LOWER(username) LIKE ? OR LOWER(email) LIKE ? OR LOWER(display_name) LIKE ?)');
        binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const totalRow = await env.DB.prepare(`SELECT COUNT(1) as total FROM insumos_users ${whereSql}`).bind(...binds).first();
      const total = Number(totalRow?.total || 0);

      const rows = await env.DB.prepare(
        `SELECT username, email, display_name as displayName, role, photo_url as photoUrl, allowed_units_json as allowedUnitsJson,
                ativo, created_at as createdAt, updated_at as updatedAt
         FROM insumos_users
         ${whereSql}
         ORDER BY LOWER(username) ASC
         LIMIT ? OFFSET ?`
      )
        .bind(...binds, limit, offset)
        .all();

      const data = (rows?.results || []).map((r) => ({
        username: r.username,
        displayName: r.displayName || r.username,
        email: r.email || '',
        role: normalizeRole(r.role || 'CONSULTOR'),
        photoUrl: r.photoUrl || '',
        allowedUnits: normalizeAllowedUnits(r.allowedUnitsJson),
        ativo: Number(r.ativo || 0) ? true : false,
        createdAt: r.createdAt || null,
        updatedAt: r.updatedAt || null,
      }));
      return withCORS(JSON.stringify({ success: true, data, resumo: { total, pagina, limit } }), { status: 200 }, appOrigin);
    } catch (err) {
      return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
    }
  }

  // POST /admin/users
  if (url.pathname === '/admin/users' && request.method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}));
      const username = String(body.username || '').trim();
      const displayName = String(body.displayName || '').trim();
      const email = String(body.email || '').trim();
      const role = normalizeRole(body.role || 'CONSULTOR');
      const allowedUnits = normalizeAllowedUnits(body.allowedUnits);
      const ativo = body.ativo === false ? 0 : 1;
      const password = String(body.password || '').trim() || randomPassword();

      if (!validateUsername(username)) {
        return withCORS(JSON.stringify({ success: false, error: 'USERNAME_INVALID' }), { status: 400 }, appOrigin);
      }
      if (password.length < 6) {
        return withCORS(JSON.stringify({ success: false, error: 'PASSWORD_TOO_SHORT' }), { status: 400 }, appOrigin);
      }

      const taken = await env.DB.prepare('SELECT 1 FROM insumos_users WHERE LOWER(username) = LOWER(?) LIMIT 1').bind(username).first();
      if (taken) {
        return withCORS(JSON.stringify({ success: false, error: 'USERNAME_TAKEN' }), { status: 409 }, appOrigin);
      }

      const now = new Date().toISOString();
      const hash = await bcrypt.hash(password, 10);
      await env.DB.prepare(
        `INSERT INTO insumos_users
         (username, email, display_name, password_hash, role, photo_url, allowed_units_json, ativo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          username,
          email,
          displayName,
          hash,
          role,
          String(body.photoUrl || ''),
          JSON.stringify(allowedUnits),
          ativo,
          now,
          now
        )
        .run();

      const user = publicUser({ username, displayName, email, role, allowedUnits, ativo: !!ativo, createdAt: now, updatedAt: now, photoUrl: String(body.photoUrl || '') });
      try {
        await appendAuditLog?.({
          env,
          spreadsheetId,
          accessToken,
          actor: auth.user.username,
          role: auth.user.role,
          ip,
          userAgent,
          idempotencyKey,
          action: 'CREATE_USER',
          entity: 'USER',
          entityId: username,
          unidade: '',
          before: null,
          after: { username, email, displayName, role, allowedUnits, ativo: !!ativo }
        });
      } catch {}
      return withCORS(JSON.stringify({ success: true, data: user, oneTimePassword: password }), { status: 201 }, appOrigin);
    } catch (err) {
      return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
    }
  }

  // PUT /admin/users/:username
  if (url.pathname.startsWith('/admin/users/') && request.method === 'PUT') {
    try {
      const target = decodeURIComponent(url.pathname.slice('/admin/users/'.length)).trim();
      if (!target) return withCORS(JSON.stringify({ success: false, error: 'USERNAME_REQUIRED' }), { status: 400 }, appOrigin);
      const body = await request.json().catch(() => ({}));

      const exists = await env.DB.prepare('SELECT username FROM insumos_users WHERE LOWER(username) = LOWER(?) LIMIT 1').bind(target).first();
      if (!exists?.username) return withCORS(JSON.stringify({ success: false, error: 'USER_NOT_FOUND' }), { status: 404 }, appOrigin);

      const email = body.email !== undefined ? String(body.email || '').trim() : null;
      const displayName = body.displayName !== undefined ? String(body.displayName || '').trim() : null;
      const role = body.role !== undefined ? normalizeRole(body.role || 'CONSULTOR') : null;
      const photoUrl = body.photoUrl !== undefined ? String(body.photoUrl || '') : null;
      const allowedUnits = body.allowedUnits !== undefined ? JSON.stringify(normalizeAllowedUnits(body.allowedUnits)) : null;
      const ativo = body.ativo === undefined ? null : (body.ativo ? 1 : 0);
      const now = new Date().toISOString();

      await env.DB.prepare(
        `UPDATE insumos_users
         SET email = COALESCE(?, email),
             display_name = COALESCE(?, display_name),
             role = COALESCE(?, role),
             photo_url = COALESCE(?, photo_url),
             allowed_units_json = COALESCE(?, allowed_units_json),
             ativo = COALESCE(?, ativo),
             updated_at = ?
         WHERE LOWER(username) = LOWER(?)`
      )
        .bind(email, displayName, role, photoUrl, allowedUnits, ativo, now, target)
        .run();

      const row = await env.DB.prepare(
        `SELECT username, email, display_name as displayName, role, photo_url as photoUrl, allowed_units_json as allowedUnitsJson, ativo, created_at as createdAt, updated_at as updatedAt
         FROM insumos_users WHERE LOWER(username) = LOWER(?) LIMIT 1`
      )
        .bind(target)
        .first();
      const out = {
        username: row.username,
        displayName: row.displayName || row.username,
        email: row.email || '',
        role: normalizeRole(row.role || 'CONSULTOR'),
        photoUrl: row.photoUrl || '',
        allowedUnits: normalizeAllowedUnits(row.allowedUnitsJson),
        ativo: Number(row.ativo || 0) ? true : false,
        createdAt: row.createdAt || null,
        updatedAt: row.updatedAt || null,
      };

      try {
        await appendAuditLog?.({
          env,
          spreadsheetId,
          accessToken,
          actor: auth.user.username,
          role: auth.user.role,
          ip,
          userAgent,
          idempotencyKey,
          action: 'UPDATE_USER',
          entity: 'USER',
          entityId: out.username,
          unidade: '',
          before: null,
          after: { username: out.username, email: out.email, displayName: out.displayName, role: out.role, allowedUnits: out.allowedUnits, ativo: out.ativo }
        });
      } catch {}
      return withCORS(JSON.stringify({ success: true, data: out }), { status: 200 }, appOrigin);
    } catch (err) {
      return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
    }
  }

  // POST /admin/users/:username/reset-password
  if (url.pathname.startsWith('/admin/users/') && url.pathname.endsWith('/reset-password') && request.method === 'POST') {
    try {
      const target = decodeURIComponent(url.pathname.slice('/admin/users/'.length, -'/reset-password'.length)).trim();
      if (!target) return withCORS(JSON.stringify({ success: false, error: 'USERNAME_REQUIRED' }), { status: 400 }, appOrigin);
      const body = await request.json().catch(() => ({}));
      const password = String(body.newPassword || '').trim() || randomPassword();
      if (password.length < 6) {
        return withCORS(JSON.stringify({ success: false, error: 'PASSWORD_TOO_SHORT' }), { status: 400 }, appOrigin);
      }
      const hash = await bcrypt.hash(password, 10);
      const now = new Date().toISOString();
      const r = await env.DB.prepare(
        `UPDATE insumos_users SET password_hash=?, updated_at=? WHERE LOWER(username)=LOWER(?)`
      )
        .bind(hash, now, target)
        .run();
      if ((r?.meta?.changes || 0) === 0) {
        return withCORS(JSON.stringify({ success: false, error: 'USER_NOT_FOUND' }), { status: 404 }, appOrigin);
      }
      try {
        await appendAuditLog?.({
          env,
          spreadsheetId,
          accessToken,
          actor: auth.user.username,
          role: auth.user.role,
          ip,
          userAgent,
          idempotencyKey,
          action: 'RESET_PASSWORD',
          entity: 'USER',
          entityId: target,
          unidade: '',
          before: null,
          after: { username: target }
        });
      } catch {}
      return withCORS(JSON.stringify({ success: true, oneTimePassword: password }), { status: 200 }, appOrigin);
    } catch (err) {
      return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
    }
  }

  return null;
}
