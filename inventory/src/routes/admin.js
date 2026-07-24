// @ts-nocheck

import { restoreBackupPayload } from '../services/backup.js';
import { resolveCrmTables } from '../d1Store.js';
import { sendAccountInviteEmail } from '../smtpMailer.js';
import { normalizeInviteEmail, normalizeInviteScope, validateInviteDelegation } from '../invitePolicy.js';
import { normalizeAllowedUnits as normalizeCanonicalAllowedUnits, unknownUnitScopes } from '../../../shared/identity-contract/index.js';
import { canCreateEmployee, displayJobTitle, publicOnboarding, validateOnboardingInput } from '../../../identity/policy/employeeOnboarding.js';

const ROLE_ADMIN = ['ADMIN', 'GESTOR', 'GERENTE', 'SUPERVISOR'];
const ROLE_INVITES = ['GESTOR'];
const PASSWORD_MIN_LENGTH = 12;

function slugifyCategory(value) {
  const s0 = String(value || '').trim().toLowerCase();
  if (!s0) return '';
  return s0
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toBoolInt(v) {
  if (v === true || v === 1 || v === '1') return 1;
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'true' || s === 'yes' || s === 'y' || s === 'sim') return 1;
  return 0;
}

function normalizeRole(role) {
  return String(role || 'CONSULTOR').trim().toUpperCase();
}

function normalizeAllowedUnits(value) {
  return normalizeCanonicalAllowedUnits(value);
}

function invalidUnitScopes(value) {
  return unknownUnitScopes(value);
}

function normalizeAllowedModules(value) {
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

async function tableHasColumn(env, tableName, columnName) {
  if (!env?.DB || !tableName || !columnName) return false;
  const t = String(tableName);
  if (!['crm_users', 'insumos_users', 'crm_invites', 'insumos_invites'].includes(t)) return false;
  try {
    const res = await env.DB.prepare(`PRAGMA table_info(${t})`).all();
    const cols = (res?.results || []).map((r) => String(r?.name || '').toLowerCase());
    return cols.includes(String(columnName).toLowerCase());
  } catch {
    return false;
  }
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
    allowedModules: Array.isArray(user.allowedModules) ? user.allowedModules : [],
    ativo: !!user.ativo,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

function randomPassword() {
  // human-friendly enough + avoids ambiguous chars; returned only once
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  const randomIndex = (maxExclusive) => {
    const max = Math.max(1, Math.floor(Number(maxExclusive) || 1));
    const range = max;
    const u32 = new Uint32Array(1);
    const maxUint = 0xffffffff;
    const limit = maxUint - (maxUint % range);
    while (true) {
      crypto.getRandomValues(u32);
      const x = u32[0];
      if (x < limit) return x % range;
    }
  };
  for (let i = 0; i < 14; i++) out += alphabet[randomIndex(alphabet.length)];
  return out;
}

function bytesToB64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hashPasswordPBKDF2(env, password) {
  const toInt = (value, fallback) => {
    const n = parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) ? n : fallback;
  };
  // Cloudflare Workers PBKDF2 max iters is 100k; higher values break auth.
  const iters = Math.max(50_000, Math.min(100_000, toInt(env?.AUTH_PBKDF2_ITERS, 100_000)));
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password || '')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters },
    key,
    256,
  );
  const dk = new Uint8Array(bits);
  return `pbkdf2_sha256$${iters}$${bytesToB64Url(salt)}$${bytesToB64Url(dk)}`;
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
  const allowedModules = normalizeAllowedModules(row.allowed_modules_json || row.allowedModulesJson || '');
  return {
    id: row.id,
    inviteeEmail: row.invitee_email || row.inviteeEmail || '',
    tokenHint: row.token_hint || row.tokenHint || '',
    role: normalizeRole(row.role || 'CONSULTOR'),
    allowedUnits,
    allowedModules,
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
  const randomIndex = (maxExclusive) => {
    const max = Math.max(1, Math.floor(Number(maxExclusive) || 1));
    const range = max;
    const u32 = new Uint32Array(1);
    const maxUint = 0xffffffff;
    const limit = maxUint - (maxUint % range);
    while (true) {
      crypto.getRandomValues(u32);
      const x = u32[0];
      if (x < limit) return x % range;
    }
  };
  for (let i = 0; i < 24; i++) out += alphabet[randomIndex(alphabet.length)];
  return out;
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input || ''));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToB64UrlPii(bytes) {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function encryptOnboardingPii(env, value) {
  const secret = String(env?.IDENTITY_PII_KEY || '').trim();
  if (!secret) throw new Error('IDENTITY_PII_KEY_NOT_CONFIGURED');
  const rawKey = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(value || '')));
  return `v1.${bytesToB64UrlPii(iv)}.${bytesToB64UrlPii(new Uint8Array(encrypted))}`;
}

export async function handleAdminRoutes({
  request,
  url,
  env,
  appOrigin,
  withCORS,
  requireRoles,
  appendAuditLog,
  ip,
  userAgent,
  idempotencyKey,
  bcrypt,
  validateUsername,
}) {
  if (!url.pathname.startsWith('/admin/')) return null;

  if (url.pathname === '/admin/seed' && request.method === 'POST') {
    const allowSeed = String(env?.ALLOW_DEV_SEED || '').trim().toLowerCase() === 'true';
    const seedToken = String(env?.INSUMOS_SEED_TOKEN || '').trim();
    const headerToken = String(request.headers.get('x-seed-token') || request.headers.get('x-insumos-seed-token') || '').trim();
    if (!allowSeed || !seedToken || headerToken !== seedToken) {
      return withCORS(JSON.stringify({ success: false, error: 'Not found' }), { status: 404 }, appOrigin);
    }

    try {
      const body = await request.json().catch(() => ({}));
      const payload = body?.payload ?? body;
      if (!payload || typeof payload !== 'object') {
        return withCORS(JSON.stringify({ success: false, error: 'Payload inválido' }), { status: 400 }, appOrigin);
      }
      await restoreBackupPayload({ env, payload });
      return withCORS(JSON.stringify({ success: true, data: { restored: true } }), { status: 200 }, appOrigin);
    } catch (err) {
      const msg = String(err?.message || err || 'Erro ao restaurar');
      const status = msg === 'PAYLOAD_INVALID' ? 400 : 500;
      return withCORS(JSON.stringify({ success: false, error: msg }), { status }, appOrigin);
    }
  }

  const auth = await requireRoles(ROLE_ADMIN);
  if (!auth.ok) return auth.response;

  if (!env?.DB) {
    return withCORS(JSON.stringify({ success: false, error: 'DB_NOT_CONFIGURED' }), { status: 500 }, appOrigin);
  }

  const { usersTable, invitesTable } = await resolveCrmTables(env);
  const usersHasModules = await tableHasColumn(env, usersTable, 'allowed_modules_json');
  const invitesHasModules = await tableHasColumn(env, invitesTable, 'allowed_modules_json');
  const invitesHasInviteeEmail = await tableHasColumn(env, invitesTable, 'invitee_email');

  // POST /admin/onboarding
  // The client supplies employment facts only. Profile, scopes and invite state
  // are derived here so no browser can grant modules or a wider unit scope.
  if (url.pathname === '/admin/onboarding' && request.method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}));
      const input = validateOnboardingInput(body);
      if (!input) return withCORS(JSON.stringify({ success: false, error: 'Dados de cadastro inválidos', code: 'ONBOARDING_INVALID' }), { status: 400 }, appOrigin);
      const denied = canCreateEmployee({ actorRole: auth?.user?.role, actorAllowedUnits: auth?.user?.allowedUnits, targetProfile: input.profile, units: input.units });
      if (denied) return withCORS(JSON.stringify({ success: false, error: 'Sem permissão para cadastrar este cargo ou unidade', code: denied }), { status: 403 }, appOrigin);
      if (!invitesHasModules || !invitesHasInviteeEmail) return withCORS(JSON.stringify({ success: false, error: 'Migração de convites pendente', code: 'INVITE_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);

      const idempotency = String(request.headers.get('idempotency-key') || body.idempotencyKey || '').trim().slice(0, 180);
      if (idempotency) {
        const existing = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE idempotency_key=? LIMIT 1').bind(idempotency).first();
        if (existing) return withCORS(JSON.stringify({ success: true, data: publicOnboarding(existing), replayed: true }), { status: 200 }, appOrigin);
      }
      const existingUser = await env.DB.prepare(`SELECT username FROM ${usersTable} WHERE LOWER(email)=LOWER(?) LIMIT 1`).bind(input.corporateEmail).first();
      if (existingUser?.username) return withCORS(JSON.stringify({ success: false, error: 'Este e-mail corporativo já está cadastrado', code: 'EMAIL_TAKEN' }), { status: 409 }, appOrigin);
      const existingOnboarding = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE LOWER(corporate_email)=LOWER(?) LIMIT 1').bind(input.corporateEmail).first();
      if (existingOnboarding) return withCORS(JSON.stringify({ success: true, data: publicOnboarding(existingOnboarding), replayed: true }), { status: 200 }, appOrigin);

      const at = new Date().toISOString();
      const id = crypto.randomUUID();
      const needsAccessConfiguration = input.accountStatus === 'PENDING_ACCESS';
      // Fail before creating a usable invite if the PII encryption boundary is
      // not configured in this deployment.
      const encryptedPersonal = await encryptOnboardingPii(env, input.personalEmail);
      const encryptedPhone = await encryptOnboardingPii(env, input.mobilePhone);
      let inviteId = null;
      if (!needsAccessConfiguration) {
        const token = randomInviteToken();
        const tokenHash = await sha256Hex(token);
        inviteId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare(`INSERT INTO ${invitesTable} (id, token_hash, token_hint, invitee_email, role, allowed_units_json, allowed_modules_json, max_uses, uses_count, expires_at, revoked, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, 0, ?, ?, ?)`).bind(
          inviteId, tokenHash, `${token.slice(0, 4)}…${token.slice(-4)}`, input.corporateEmail, input.profile, JSON.stringify(input.units), JSON.stringify(input.modules), expiresAt, `Onboarding ${input.department}`, String(auth?.user?.username || ''), at,
        ).run();
        try {
          // The invite is bound to the corporate identity, but delivered to the
          // protected personal contact address.
          await sendAccountInviteEmail({ env, to: input.personalEmail, token, expiresAt, appUrl: String(env?.AUTH_INVITE_APP_URL || appOrigin) });
        } catch (error) {
          await env.DB.prepare(`UPDATE ${invitesTable} SET revoked=1 WHERE id=?`).bind(inviteId).run();
          throw error;
        }
      }
      await env.DB.prepare(`INSERT INTO crm_employee_onboarding (id, full_name, corporate_email, personal_email_encrypted, personal_email_hash, mobile_phone_encrypted, mobile_phone_hash, profile, job_title, department_name, units_json, account_status, invite_id, idempotency_key, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        id, input.fullName, input.corporateEmail, encryptedPersonal, await sha256Hex(input.personalEmail), encryptedPhone, await sha256Hex(input.mobilePhone), input.profile, displayJobTitle(input.profile), input.department, JSON.stringify(input.units), input.accountStatus, inviteId, idempotency || null, String(auth?.user?.username || ''), at, at,
      ).run();
      const created = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=?').bind(id).first();
      await appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, idempotencyKey: idempotency, action: 'EMPLOYEE_ONBOARDING_CREATE', entity: 'EMPLOYEE_ONBOARDING', entityId: id, unidade: input.units.join(','), after: { profile: input.profile, jobTitle: displayJobTitle(input.profile), department: input.department, units: input.units, accountStatus: input.accountStatus, inviteIssued: !!inviteId } });
      return withCORS(JSON.stringify({ success: true, data: publicOnboarding(created) }), { status: 201 }, appOrigin);
    } catch (error) {
      const message = String(error?.message || 'ONBOARDING_FAILED');
      const status = message === 'IDENTITY_PII_KEY_NOT_CONFIGURED' ? 503 : 500;
      return withCORS(JSON.stringify({ success: false, error: status === 503 ? 'Configuração segura de cadastro pendente' : 'Não foi possível concluir o cadastro', code: message }), { status }, appOrigin);
    }
  }

  if (url.pathname === '/admin/onboarding' && request.method === 'GET') {
    try {
      const rows = await env.DB.prepare('SELECT * FROM crm_employee_onboarding ORDER BY created_at DESC LIMIT 100').all();
      return withCORS(JSON.stringify({ success: true, data: (rows?.results || []).map(publicOnboarding) }), { status: 200 }, appOrigin);
    } catch {
      return withCORS(JSON.stringify({ success: false, error: 'ONBOARDING_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);
    }
  }

  // GET /admin/categories
  if (url.pathname === '/admin/categories' && request.method === 'GET') {
    try {
      const includeSuggestions = String(url.searchParams.get('includeSuggestions') || '').trim() === 'true';
      const rows = await env.DB.prepare(
        `SELECT slug, label, requires_lot, requires_expiry, fefo, created_at, updated_at
         FROM insumos_categories
         ORDER BY COALESCE(NULLIF(label, ''), slug) COLLATE NOCASE ASC`
      ).all();

      const data = (rows?.results || []).map((r) => ({
        slug: String(r.slug || ''),
        label: String(r.label || ''),
        requiresLot: Number(r.requires_lot || 0) ? true : false,
        requiresExpiry: Number(r.requires_expiry || 0) ? true : false,
        fefo: Number(r.fefo || 0) ? true : false,
        createdAt: r.created_at || null,
        updatedAt: r.updated_at || null,
      }));

      let suggestions = [];
      if (includeSuggestions) {
        const sugRows = await env.DB.prepare(
          `SELECT DISTINCT categoria
           FROM insumos_items
           WHERE categoria IS NOT NULL AND TRIM(categoria) != ''
           ORDER BY categoria COLLATE NOCASE ASC
           LIMIT 250`
        ).all();
        suggestions = (sugRows?.results || [])
          .map((r) => String(r.categoria || '').trim())
          .filter(Boolean)
          .map((label) => ({ label, slug: slugifyCategory(label) }))
          .filter((x) => x.slug);
      }

      return withCORS(JSON.stringify({ success: true, data, suggestions }), { status: 200 }, appOrigin);
    } catch (err) {
      return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
    }
  }

  // POST /admin/categories (upsert)
  if (url.pathname === '/admin/categories' && request.method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}));
      const label = String(body.label || body.name || '').trim();
      const slug = slugifyCategory(body.slug || label);
      if (!slug) {
        return withCORS(JSON.stringify({ success: false, error: 'SLUG_REQUIRED' }), { status: 400 }, appOrigin);
      }

      const requiresLot = toBoolInt(body.requiresLot ?? body.requires_lot);
      const requiresExpiry = toBoolInt(body.requiresExpiry ?? body.requires_expiry);
      const fefo = toBoolInt(body.fefo);
      if (fefo && !requiresExpiry) {
        return withCORS(JSON.stringify({ success: false, error: 'FEFO_REQUIRES_EXPIRY' }), { status: 400 }, appOrigin);
      }

      const now = new Date().toISOString();
      const existing = await env.DB.prepare(
        `SELECT slug, label, requires_lot, requires_expiry, fefo, created_at, updated_at
         FROM insumos_categories
         WHERE slug = ? LIMIT 1`
      ).bind(slug).first();

      const createdAt = existing?.created_at || now;

      await env.DB.prepare(
        `INSERT OR REPLACE INTO insumos_categories
         (slug, label, requires_lot, requires_expiry, fefo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(slug, label, requiresLot, requiresExpiry, fefo, createdAt, now)
        .run();

      try {
        await appendAuditLog?.({
          env,
          actor: auth.user.username,
          role: auth.user.role,
          ip,
          userAgent,
          idempotencyKey,
          action: existing ? 'UPDATE_CATEGORY_POLICY' : 'CREATE_CATEGORY_POLICY',
          entity: 'CATEGORY_POLICY',
          entityId: slug,
          unidade: '',
          before: existing || null,
          after: { slug, label, requiresLot: !!requiresLot, requiresExpiry: !!requiresExpiry, fefo: !!fefo }
        });
      } catch { }

      return withCORS(
        JSON.stringify({
          success: true,
          data: { slug, label, requiresLot: !!requiresLot, requiresExpiry: !!requiresExpiry, fefo: !!fefo, createdAt, updatedAt: now }
        }),
        { status: 200 },
        appOrigin
      );
    } catch (err) {
      return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
    }
  }

  // DELETE /admin/categories/:slug
  if (url.pathname.startsWith('/admin/categories/') && request.method === 'DELETE') {
    try {
      const slug = decodeURIComponent(url.pathname.slice('/admin/categories/'.length)).trim();
      if (!slug) {
        return withCORS(JSON.stringify({ success: false, error: 'SLUG_REQUIRED' }), { status: 400 }, appOrigin);
      }
      const existing = await env.DB.prepare(
        `SELECT slug, label, requires_lot, requires_expiry, fefo, created_at, updated_at
         FROM insumos_categories
         WHERE slug = ? LIMIT 1`
      ).bind(slug).first();
      if (!existing?.slug) {
        return withCORS(JSON.stringify({ success: false, error: 'NOT_FOUND' }), { status: 404 }, appOrigin);
      }

      await env.DB.prepare('DELETE FROM insumos_categories WHERE slug = ?').bind(slug).run();

      try {
        await appendAuditLog?.({
          env,
          actor: auth.user.username,
          role: auth.user.role,
          ip,
          userAgent,
          idempotencyKey,
          action: 'DELETE_CATEGORY_POLICY',
          entity: 'CATEGORY_POLICY',
          entityId: slug,
          unidade: '',
          before: existing,
          after: null
        });
      } catch { }

      return withCORS(JSON.stringify({ success: true }), { status: 200 }, appOrigin);
    } catch (err) {
      return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
    }
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
        `SELECT id, token_hint, role, allowed_units_json${invitesHasModules ? ', allowed_modules_json' : ''}${invitesHasInviteeEmail ? ', invitee_email' : ''}, max_uses, uses_count, expires_at, revoked, note, created_by, created_at
         FROM ${invitesTable}
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
      if (!invitesHasModules || !invitesHasInviteeEmail) {
        return withCORS(JSON.stringify({ success: false, error: 'Migração de convites pendente', code: 'INVITE_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);
      }
      const body = await request.json().catch(() => ({}));
      const inviteeEmail = normalizeInviteEmail(body.email ?? body.inviteeEmail);
      const role = normalizeRole(body.role || 'CONSULTOR');
      const invalidUnits = invalidUnitScopes(body.allowedUnits);
      if (invalidUnits.length) return withCORS(JSON.stringify({ success: false, error: 'Unidade inválida', code: 'UNIT_INVALID' }), { status: 400 }, appOrigin);
      const allowedUnits = normalizeAllowedUnits(body.allowedUnits);
      const allowedModules = normalizeInviteScope(body.allowedModules ?? body.allowed_modules ?? body.modules ?? body.scopes);
      const requestedMaxUses = body.maxUses === undefined ? 1 : Number.parseInt(String(body.maxUses), 10);
      const maxUses = 1;
      const expiresInDays = body.expiresInDays === null || body.expiresInDays === undefined
        ? 30
        : Math.max(1, Math.min(365, parseInt(String(body.expiresInDays), 10) || 30));
      const note = String(body.note || '').trim().slice(0, 200);

      if (!inviteeEmail) {
        return withCORS(JSON.stringify({ success: false, error: 'Informe um e-mail corporativo válido', code: 'INVITEE_EMAIL_INVALID' }), { status: 400 }, appOrigin);
      }
      if (requestedMaxUses !== 1) return withCORS(JSON.stringify({ success: false, error: 'Convites são pessoais e de uso único', code: 'INVITE_SINGLE_USE_REQUIRED' }), { status: 400 }, appOrigin);
      const policyError = validateInviteDelegation({
        actorRole: auth?.user?.role,
        targetRole: role,
        actorAllowedUnits: auth?.user?.allowedUnits,
        actorAllowedModules: auth?.user?.allowedModules,
        allowedUnits,
        allowedModules,
      });
      if (policyError) {
        const policyMessages = {
          RBAC_DENIED: 'Somente gestores podem emitir convites.',
          ROLE_DENIED: 'O gestor só pode convidar papéis abaixo de gestor.',
          INVITE_UNITS_REQUIRED: 'Selecione ao menos uma unidade para o convite.',
          INVITE_MODULES_REQUIRED: 'Selecione ao menos um módulo para o convite.',
          INVITER_SCOPE_REQUIRED: 'Seu próprio acesso precisa ter unidades e módulos definidos antes de emitir convites.',
          INVITE_UNITS_DENIED: 'O convite contém uma unidade fora do seu escopo.',
          INVITE_MODULES_DENIED: 'O convite contém um módulo fora do seu escopo.',
        };
        return withCORS(JSON.stringify({ success: false, error: policyMessages[policyError] || 'Convite não permitido.', code: policyError }), { status: policyError === 'RBAC_DENIED' || policyError === 'ROLE_DENIED' || policyError.endsWith('_DENIED') ? 403 : 400 }, appOrigin);
      }

      const existingUser = await env.DB.prepare(`SELECT username FROM ${usersTable} WHERE LOWER(email) = LOWER(?) LIMIT 1`).bind(inviteeEmail).first();
      if (existingUser?.username) return withCORS(JSON.stringify({ success: false, error: 'Este e-mail já está cadastrado', code: 'EMAIL_TAKEN' }), { status: 409 }, appOrigin);

      const token = randomInviteToken();
      const tokenHash = await sha256Hex(token);
      const tokenHint = `${token.slice(0, 4)}…${token.slice(-4)}`;
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

      await env.DB.prepare(
        `INSERT INTO ${invitesTable}
         (id, token_hash, token_hint, invitee_email, role, allowed_units_json, allowed_modules_json, max_uses, uses_count, expires_at, revoked, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, 0, ?, ?, ?)`
      )
        .bind(id, tokenHash, tokenHint, inviteeEmail, role, JSON.stringify(allowedUnits), JSON.stringify(allowedModules), expiresAt, note, String(auth?.user?.username || ''), createdAt)
        .run();

      try {
        await sendAccountInviteEmail({ env, to: inviteeEmail, token, expiresAt, appUrl: String(env?.AUTH_INVITE_APP_URL || appOrigin) });
      } catch (mailError) {
        await env.DB.prepare(`UPDATE ${invitesTable} SET revoked = 1 WHERE id = ? AND uses_count = 0`).bind(id).run();
        const reason = String(mailError?.message || mailError || 'SMTP_ERROR_UNKNOWN').replace(/[\r\n]+/g, ' ').slice(0, 160);
        console.error(JSON.stringify({ event: 'AUTH_INVITE_EMAIL_FAILED', invite_id: id, reason }));
        return withCORS(JSON.stringify({ success: false, error: 'EMAIL_DELIVERY_FAILED' }), { status: 503 }, appOrigin);
      }

      try {
        await appendAuditLog?.({
          env,
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
          after: { inviteeEmail, role, allowedUnits, allowedModules, maxUses, expiresAt, tokenHint, note, delivery: 'smtp' }
        });
      } catch { }

      const invite = publicInvite({
        id,
        token_hint: tokenHint,
        invitee_email: inviteeEmail,
        role,
        allowed_units_json: JSON.stringify(allowedUnits),
        allowed_modules_json: invitesHasModules ? JSON.stringify(allowedModules) : null,
        max_uses: maxUses,
        uses_count: 0,
        expires_at: expiresAt,
        revoked: 0,
        note,
        created_by: String(auth?.user?.username || ''),
        created_at: createdAt,
      });

      return withCORS(JSON.stringify({ success: true, data: invite, delivery: 'smtp' }), { status: 201 }, appOrigin);
    } catch (err) {
      const msg = String(err?.message || err);
      if (/UNIQUE constraint failed: (?:insumos_invites|crm_invites)\.token_hash/i.test(msg)) {
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
        `SELECT id, role, token_hint, allowed_units_json${invitesHasModules ? ', allowed_modules_json' : ''}${invitesHasInviteeEmail ? ', invitee_email' : ''}, max_uses, uses_count, expires_at, revoked, note, created_by, created_at
         FROM ${invitesTable} WHERE id = ? LIMIT 1`
      )
        .bind(id)
        .first();
      if (!existing?.id) return withCORS(JSON.stringify({ success: false, error: 'NOT_FOUND' }), { status: 404 }, appOrigin);

      await env.DB.prepare(`UPDATE ${invitesTable} SET revoked=1 WHERE id=?`).bind(id).run();

      try {
        await appendAuditLog?.({
          env,
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
      } catch { }

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
      const totalRow = await env.DB.prepare(`SELECT COUNT(1) as total FROM ${usersTable} ${whereSql}`).bind(...binds).first();
      const total = Number(totalRow?.total || 0);

      const rows = await env.DB.prepare(
        `SELECT username, email, display_name as displayName, role, photo_url as photoUrl, allowed_units_json as allowedUnitsJson${usersHasModules ? ', allowed_modules_json as allowedModulesJson' : ''},
                ativo, created_at as createdAt, updated_at as updatedAt
         FROM ${usersTable}
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
        allowedModules: normalizeAllowedModules(r.allowedModulesJson),
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
      if (normalizeRole(auth?.user?.role) !== 'ADMIN' || String(env?.ALLOW_ADMIN_USER_PROVISIONING || '').trim().toLowerCase() !== 'true') {
        return withCORS(JSON.stringify({ success: false, error: 'Criação direta desabilitada. Use um convite autorizado.', code: 'INVITE_REQUIRED' }), { status: 403 }, appOrigin);
      }
      const body = await request.json().catch(() => ({}));
      const username = String(body.username || '').trim();
      const displayName = String(body.displayName || '').trim();
      const email = String(body.email || '').trim();
      const role = normalizeRole(body.role || 'CONSULTOR');
      const invalidUnits = invalidUnitScopes(body.allowedUnits);
      if (invalidUnits.length) return withCORS(JSON.stringify({ success: false, error: 'UNIT_INVALID' }), { status: 400 }, appOrigin);
      const allowedUnits = normalizeAllowedUnits(body.allowedUnits);
      const allowedModules = normalizeAllowedModules(body.allowedModules ?? body.allowed_modules ?? body.modules ?? body.scopes);
      const ativo = body.ativo === false ? 0 : 1;
      const password = String(body.password || '').trim() || randomPassword();

      if (!validateUsername(username)) {
        return withCORS(JSON.stringify({ success: false, error: 'USERNAME_INVALID' }), { status: 400 }, appOrigin);
      }
      if (password.length < PASSWORD_MIN_LENGTH) {
        return withCORS(JSON.stringify({ success: false, error: 'PASSWORD_TOO_SHORT' }), { status: 400 }, appOrigin);
      }

      const taken = await env.DB.prepare(`SELECT 1 FROM ${usersTable} WHERE LOWER(username) = LOWER(?) LIMIT 1`).bind(username).first();
      if (taken) {
        return withCORS(JSON.stringify({ success: false, error: 'USERNAME_TAKEN' }), { status: 409 }, appOrigin);
      }

      const now = new Date().toISOString();
      const hash = await hashPasswordPBKDF2(env, password);
      if (usersHasModules) {
        await env.DB.prepare(
          `INSERT INTO ${usersTable}
           (username, email, display_name, password_hash, role, photo_url, allowed_units_json, allowed_modules_json, ativo, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            username,
            email,
            displayName,
            hash,
            role,
            String(body.photoUrl || ''),
            JSON.stringify(allowedUnits),
            JSON.stringify(allowedModules),
            ativo,
            now,
            now
          )
          .run();
      } else {
        await env.DB.prepare(
          `INSERT INTO ${usersTable}
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
      }

      const user = publicUser({ username, displayName, email, role, allowedUnits, allowedModules, ativo: !!ativo, createdAt: now, updatedAt: now, photoUrl: String(body.photoUrl || '') });
      try {
        await appendAuditLog?.({
          env,
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
          after: { username, email, displayName, role, allowedUnits, allowedModules, ativo: !!ativo }
        });
      } catch { }
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

      const exists = await env.DB.prepare(`SELECT username FROM ${usersTable} WHERE LOWER(username) = LOWER(?) LIMIT 1`).bind(target).first();
      if (!exists?.username) return withCORS(JSON.stringify({ success: false, error: 'USER_NOT_FOUND' }), { status: 404 }, appOrigin);

      const email = body.email !== undefined ? String(body.email || '').trim() : null;
      const displayName = body.displayName !== undefined ? String(body.displayName || '').trim() : null;
      const role = body.role !== undefined ? normalizeRole(body.role || 'CONSULTOR') : null;
      if (role !== null && normalizeRole(auth?.user?.role) !== 'ADMIN') {
        return withCORS(JSON.stringify({ success: false, error: 'Somente o provisionamento administrativo pode alterar hierarquia.', code: 'ROLE_MANAGEMENT_DENIED' }), { status: 403 }, appOrigin);
      }
      const photoUrl = body.photoUrl !== undefined ? String(body.photoUrl || '') : null;
      if (body.allowedUnits !== undefined && invalidUnitScopes(body.allowedUnits).length) {
        return withCORS(JSON.stringify({ success: false, error: 'UNIT_INVALID' }), { status: 400 }, appOrigin);
      }
      const allowedUnits = body.allowedUnits !== undefined ? JSON.stringify(normalizeAllowedUnits(body.allowedUnits)) : null;
      const allowedModules = body.allowedModules !== undefined ? JSON.stringify(normalizeAllowedModules(body.allowedModules)) : null;
      const ativo = body.ativo === undefined ? null : (body.ativo ? 1 : 0);
      const now = new Date().toISOString();

      const updateSql = usersHasModules
        ? `UPDATE ${usersTable}
           SET email = COALESCE(?, email),
               display_name = COALESCE(?, display_name),
               role = COALESCE(?, role),
               photo_url = COALESCE(?, photo_url),
               allowed_units_json = COALESCE(?, allowed_units_json),
               allowed_modules_json = COALESCE(?, allowed_modules_json),
               ativo = COALESCE(?, ativo),
               session_version = COALESCE(session_version, 0) + 1,
               updated_at = ?
           WHERE LOWER(username) = LOWER(?)`
        : `UPDATE ${usersTable}
           SET email = COALESCE(?, email),
               display_name = COALESCE(?, display_name),
               role = COALESCE(?, role),
               photo_url = COALESCE(?, photo_url),
               allowed_units_json = COALESCE(?, allowed_units_json),
               ativo = COALESCE(?, ativo),
               session_version = COALESCE(session_version, 0) + 1,
               updated_at = ?
           WHERE LOWER(username) = LOWER(?)`;

      const binds = usersHasModules
        ? [email, displayName, role, photoUrl, allowedUnits, allowedModules, ativo, now, target]
        : [email, displayName, role, photoUrl, allowedUnits, ativo, now, target];
      await env.DB.prepare(updateSql).bind(...binds).run();

      const row = await env.DB.prepare(
        `SELECT username, email, display_name as displayName, role, photo_url as photoUrl, allowed_units_json as allowedUnitsJson${usersHasModules ? ', allowed_modules_json as allowedModulesJson' : ''}, ativo, created_at as createdAt, updated_at as updatedAt
         FROM ${usersTable} WHERE LOWER(username) = LOWER(?) LIMIT 1`
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
        allowedModules: normalizeAllowedModules(row.allowedModulesJson),
        ativo: Number(row.ativo || 0) ? true : false,
        createdAt: row.createdAt || null,
        updatedAt: row.updatedAt || null,
      };

      try {
        await appendAuditLog?.({
          env,
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
          after: { username: out.username, email: out.email, displayName: out.displayName, role: out.role, allowedUnits: out.allowedUnits, allowedModules: out.allowedModules, ativo: out.ativo }
        });
      } catch { }
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
      if (password.length < PASSWORD_MIN_LENGTH) {
        return withCORS(JSON.stringify({ success: false, error: 'PASSWORD_TOO_SHORT' }), { status: 400 }, appOrigin);
      }
      const hash = await hashPasswordPBKDF2(env, password);
      const now = new Date().toISOString();
      const r = await env.DB.prepare(
        `UPDATE ${usersTable}
         SET password_hash=?, session_version=COALESCE(session_version, 0) + 1, updated_at=?
         WHERE LOWER(username)=LOWER(?)`
      )
        .bind(hash, now, target)
        .run();
      if ((r?.meta?.changes || 0) === 0) {
        return withCORS(JSON.stringify({ success: false, error: 'USER_NOT_FOUND' }), { status: 404 }, appOrigin);
      }
      try {
        await appendAuditLog?.({
          env,
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
      } catch { }
      return withCORS(JSON.stringify({ success: true, oneTimePassword: password }), { status: 200 }, appOrigin);
    } catch (err) {
      return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
    }
  }

  return null;
}
