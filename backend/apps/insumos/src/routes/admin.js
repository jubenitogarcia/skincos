// @ts-nocheck

const ROLE_ADMIN = ['ADMIN', 'GESTOR', 'GERENTE'];
const ROLE_INVITES = ['ADMIN', 'GESTOR'];

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

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function publicInvite(row) {
  if (!row) return null;
  const allowedUnits = normalizeAllowedUnits(row.allowed_units_json || row.allowedUnitsJson || '');
  return {
    id: row.id,
    tokenHint: row.token_hint || row.tokenHint || '',
    role: normalizeRole(row.role || 'CONSULTOR'),
    allowedUnits,
    maxUses: Number(row.max_uses ?? row.maxUses ?? 1) || 1,
    usesCount: Number(row.uses_count ?? row.usesCount ?? 0) || 0,
    expiresAt: row.expires_at ?? row.expiresAt ?? null,
    revoked: Number(row.revoked ?? 0) ? true : false,
    note: row.note || '',
    createdBy: row.created_by || row.createdBy || '',
    createdAt: row.created_at || row.createdAt || null,
  };
}

function randomInviteToken() {
  // 24 chars, human-friendly alphabet; good enough entropy for invites
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 24; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input || ''));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function canIssueRole({ actorRole, targetRole }) {
  const actor = normalizeRole(actorRole);
  const target = normalizeRole(targetRole);
  if (actor === 'ADMIN') return true;
  if (actor === 'GESTOR') return target !== 'ADMIN';
  return false;
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

  // GET /admin/invites
  if (url.pathname === '/admin/invites' && request.method === 'GET') {
    try {
      if (!ROLE_INVITES.includes(normalizeRole(auth?.user?.role))) {
        return withCORS(JSON.stringify({ success: false, error: 'Sem permissão', code: 'RBAC_DENIED' }), { status: 403 }, appOrigin);
      }
      const includeRevoked = String(url.searchParams.get('includeRevoked') || '').trim() === 'true';
      const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
      const where = includeRevoked ? '' : 'WHERE revoked = 0';
      const rows = await env.DB.prepare(
        `SELECT id, token_hint, role, allowed_units_json, max_uses, uses_count, expires_at, revoked, note, created_by, created_at
         FROM insumos_invites
         ${where}
         ORDER BY created_at DESC
         LIMIT ?`
      )
        .bind(limit)
        .all();
      const data = (rows?.results || []).map(publicInvite).filter(Boolean);
      return withCORS(JSON.stringify({ success: true, data }), { status: 200 }, appOrigin);
    } catch (err) {
      return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
    }
  }

  // POST /admin/invites
  if (url.pathname === '/admin/invites' && request.method === 'POST') {
    try {
      if (!ROLE_INVITES.includes(normalizeRole(auth?.user?.role))) {
        return withCORS(JSON.stringify({ success: false, error: 'Sem permissão', code: 'RBAC_DENIED' }), { status: 403 }, appOrigin);
      }
      const body = await request.json().catch(() => ({}));
      const role = normalizeRole(body.role || 'OPERADOR');
      const allowedUnits = normalizeAllowedUnits(body.allowedUnits);
      const maxUses = Math.max(1, Math.min(50, parseInt(String(body.maxUses ?? '1'), 10) || 1));
      const expiresInDays = body.expiresInDays === null || body.expiresInDays === undefined
        ? 30
        : Math.max(1, Math.min(365, parseInt(String(body.expiresInDays), 10) || 30));
      const note = String(body.note || '').trim().slice(0, 200);

      if (!canIssueRole({ actorRole: auth?.user?.role, targetRole: role })) {
        return withCORS(JSON.stringify({ success: false, error: 'Não permitido criar token para esta hierarquia', code: 'ROLE_DENIED' }), { status: 403 }, appOrigin);
      }

      const token = randomInviteToken();
      const tokenHash = await sha256Hex(token);
      const tokenHint = `${token.slice(0, 4)}…${token.slice(-4)}`;
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

      await env.DB.prepare(
        `INSERT INTO insumos_invites
         (id, token_hash, token_hint, role, allowed_units_json, max_uses, uses_count, expires_at, revoked, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)`
      )
        .bind(
          id,
          tokenHash,
          tokenHint,
          role,
          JSON.stringify(allowedUnits),
          maxUses,
          expiresAt,
          note,
          String(auth?.user?.username || ''),
          createdAt
        )
        .run();

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
          action: 'CREATE_INVITE',
          entity: 'INVITE',
          entityId: id,
          unidade: '',
          before: null,
          after: { role, allowedUnits, maxUses, expiresAt, tokenHint, note }
        });
      } catch {}

      const invite = publicInvite({
        id,
        token_hint: tokenHint,
        role,
        allowed_units_json: JSON.stringify(allowedUnits),
        max_uses: maxUses,
        uses_count: 0,
        expires_at: expiresAt,
        revoked: 0,
        note,
        created_by: String(auth?.user?.username || ''),
        created_at: createdAt,
      });

      // IMPORTANT: token is returned only once at creation time
      return withCORS(JSON.stringify({ success: true, data: invite, token }), { status: 201 }, appOrigin);
    } catch (err) {
      const msg = String(err?.message || err);
      if (/UNIQUE constraint failed: insumos_invites\.token_hash/i.test(msg)) {
        return withCORS(JSON.stringify({ success: false, error: 'TOKEN_COLLISION' }), { status: 409 }, appOrigin);
      }
      return withCORS(JSON.stringify({ success: false, error: msg }), { status: 500 }, appOrigin);
    }
  }

  // POST /admin/invites/:id/revoke
  if (url.pathname.startsWith('/admin/invites/') && url.pathname.endsWith('/revoke') && request.method === 'POST') {
    try {
      if (!ROLE_INVITES.includes(normalizeRole(auth?.user?.role))) {
        return withCORS(JSON.stringify({ success: false, error: 'Sem permissão', code: 'RBAC_DENIED' }), { status: 403 }, appOrigin);
      }
      const id = decodeURIComponent(url.pathname.slice('/admin/invites/'.length, -'/revoke'.length)).trim();
      if (!id) return withCORS(JSON.stringify({ success: false, error: 'ID_REQUIRED' }), { status: 400 }, appOrigin);

      const existing = await env.DB.prepare(
        `SELECT id, role, token_hint, allowed_units_json, max_uses, uses_count, expires_at, revoked, note, created_by, created_at
         FROM insumos_invites WHERE id = ? LIMIT 1`
      )
        .bind(id)
        .first();
      if (!existing?.id) return withCORS(JSON.stringify({ success: false, error: 'NOT_FOUND' }), { status: 404 }, appOrigin);

      await env.DB.prepare(`UPDATE insumos_invites SET revoked=1 WHERE id=?`).bind(id).run();

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
          action: 'REVOKE_INVITE',
          entity: 'INVITE',
          entityId: id,
          unidade: '',
          before: publicInvite(existing),
          after: { revoked: true }
        });
      } catch {}

      return withCORS(JSON.stringify({ success: true }), { status: 200 }, appOrigin);
    } catch (err) {
      return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
    }
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
