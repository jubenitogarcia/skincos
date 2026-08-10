// @ts-nocheck

import {
  getInsumosPreviewSnapshotMetadata,
  restoreBackupPayload,
  verifyInsumosPreviewSnapshotIntegrity,
  verifyInsumosPreviewRestore,
} from '../services/backup.js';
import { isAuthorizedDevSeedRequest } from '../lib/devSeed.js';
import { resolveCrmTables } from '../d1Store.js';
import { hasAuthMailerConfig, sendAccountInviteEmail } from '../smtpMailer.js';
import { normalizeInviteEmail, normalizeInviteScope, validateInviteDelegation } from '../invitePolicy.js';
import { normalizeAllowedUnits as normalizeCanonicalAllowedUnits, unknownUnitScopes } from '../../../shared/identity-contract/index.js';
import { buildEmployeeOnboardingFingerprintPayload, canCreateEmployee, displayJobTitle, publicOnboarding, resolveEmployeeProfile, suggestEmployeeUsername, validateOnboardingInput } from '../../../shared/identity-runtime/inventory-compat.js';
import { syncIdentityWorkforceOnboarding, syncIdentityWorkforceStatus } from '../../../shared/identity-runtime/workforce-onboarding.js';
import { isValidAccountTransition, normalizeAccountState, shouldIssueInvite } from '../../../shared/identity-runtime/onboarding-state.js';
import { recordTeamTelemetry } from '../services/teamTelemetry.js';
import { buildTeamReadiness } from '../services/teamReadiness.js';
import {
  SCHEDULE_SYNC_STATES,
  buildScheduleSyncRecord,
  fallbackScheduleSync,
  latestScheduleSyncByMember,
  normalizeScheduleSyncErrorCode,
  normalizeScheduleSyncOperationKey,
  normalizeScheduleSyncResult,
  normalizeScheduleSyncState,
  scheduleSyncOperationMatches,
} from '../services/teamScheduleSync.js';

const ROLE_ADMIN = ['ADMIN', 'GESTOR', 'GERENTE', 'SUPERVISOR'];
const ROLE_INVITES = ['ADMIN', 'GESTOR', 'GERENTE'];
const TEAM_ADMIN_ROLES = ['ADMIN', 'GESTOR', 'GERENTE'];
const TEAM_READ_ROLES = [...TEAM_ADMIN_ROLES, 'SUPERVISOR'];
const PASSWORD_MIN_LENGTH = 12;

function isOnboardingDependencyError(value) {
  const code = String(value || '').trim().toUpperCase();
  return code === 'IDENTITY_PII_KEY_NOT_CONFIGURED'
    || code === 'AUTH_EMAIL_NOT_CONFIGURED'
    || /^(WORKFORCE_|IDENTITY_WORKFORCE_|SMTP_|EMAIL_|MODULE_|TIMEKEEPING_|RELEASE_AFFINITY_|RUNTIME_BINDINGS_|SERVICE_|DATABASE_UNAVAILABLE|ONBOARDING_MIGRATION_REQUIRED)/.test(code)
    || code === 'DOMAIN_SERVICE_DEGRADED'
    || code === 'SERVICE_DEGRADED';
}

function unifiedTeamEnabled(env) {
  const value = String(env?.UNIFIED_TEAM_ENABLED || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function legacyUserRoutesDisabled(env) {
  return unifiedTeamEnabled(env);
}

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

function normalizeCrmUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePersonalEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  const e164 = digits.startsWith('55') ? digits : `55${digits}`;
  return e164.length >= 12 && e164.length <= 13 ? `+${e164}` : '';
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
  if (!['crm_users', 'insumos_users', 'crm_invites', 'insumos_invites', 'crm_employee_onboarding', 'crm_employee_team', 'crm_employee_identity_links', 'crm_employee_account_links'].includes(t)) return false;
  try {
    const res = await env.DB.prepare(`PRAGMA table_info(${t})`).all();
    const cols = (res?.results || []).map((r) => String(r?.name || '').toLowerCase());
    return cols.includes(String(columnName).toLowerCase());
  } catch {
    return false;
  }
}

async function tableExists(env, tableName) {
  const t = String(tableName || '');
  if (!['crm_employee_onboarding', 'crm_employee_team', 'crm_employee_identity_links', 'crm_employee_account_links', 'crm_team_operations', 'crm_team_telemetry'].includes(t)) return false;
  try {
    const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").bind(t).first();
    return String(row?.name || '') === t;
  } catch {
    return false;
  }
}

function normalizeTeamData(value, fallbackUnits = [], fallback = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const clean = (item, max = 160) => String(item ?? '').trim().slice(0, max);
  const valueOrFallback = (key, alias) => input[key] !== undefined ? input[key] : alias && input[alias] !== undefined ? input[alias] : fallback[key];
  const units = normalizeAllowedUnits(input.units !== undefined ? input.units : fallback.units ?? fallbackUnits);
  return {
    professionalId: clean(valueOrFallback('professionalId', 'scheduleProfessionalId'), 120),
    status: clean(valueOrFallback('status'), 40),
    role: clean(valueOrFallback('role'), 80),
    shift: clean(valueOrFallback('shift'), 120),
    nickname: clean(valueOrFallback('nickname'), 120),
    instagram: clean(valueOrFallback('instagram'), 160),
    color: clean(valueOrFallback('color'), 20),
    units,
  };
}

function publicTeamMember(row, links = [], scheduleSync = null) {
  const fallback = fallbackScheduleSync(row.schedule_professional_id || '');
  const normalizedSync = scheduleSync
    ? normalizeScheduleSyncResult(scheduleSync, row.schedule_professional_id || '')
    : fallback;
  const crmAccountReviewStatus = String(row.crm_account_review_status || '').trim().toUpperCase() || null;
  return {
    ...publicOnboarding(row),
    workforceEmployeeId: row.workforce_employee_id || null,
    crmAccountLinked: crmAccountReviewStatus === 'CONFIRMED' && Boolean(String(row.crm_account_username || '').trim()),
    crmAccountUsername: row.crm_account_username || null,
    crmAccountReviewStatus,
    crmAccountLinkId: row.crm_account_link_id || null,
    schedule: {
      professionalId: row.schedule_professional_id || null,
      status: row.schedule_status || '',
      role: row.schedule_role || '',
      shift: row.schedule_shift || '',
      nickname: row.schedule_nickname || '',
      instagram: row.schedule_instagram || '',
      color: row.schedule_color || '',
      units: normalizeAllowedUnits(row.schedule_units_json || row.units_json),
    },
    scheduleSync: {
      state: normalizedSync.state,
      professionalId: normalizedSync.professionalId,
      errorCode: normalizedSync.errorCode,
      attempt: normalizedSync.attempt,
      updatedAt: normalizedSync.updatedAt,
    },
    identityLinks: links,
  };
}

function publicIdentityLink(row) {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.source_id,
    matchMethod: row.match_method,
    confidence: row.confidence,
    reviewStatus: row.review_status,
    metadata: safeJsonParse(row.metadata_json, {}),
    createdBy: row.created_by || '',
    createdAt: row.created_at || null,
  };
}

function publicAccountLink(row) {
  if (!row) return null;
  return {
    id: row.id,
    crmUsername: row.crm_username || '',
    linkMethod: row.link_method || '',
    reviewStatus: String(row.review_status || '').trim().toUpperCase(),
    reviewNote: row.review_note || null,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    createdBy: row.created_by || '',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function publicTeamAudit(row) {
  return {
    id: row.id,
    timestamp: row.ts || null,
    actor: row.actor || '',
    role: String(row.role || '').trim().toUpperCase(),
    action: row.action || '',
    entity: row.entity || '',
    idempotencyKey: row.idempotency_key || null,
    units: row.unidade || '',
    before: safeJsonParse(row.before_json, null),
    after: safeJsonParse(row.after_json, null),
  };
}

function teamRoleAllowed(auth) {
  return TEAM_READ_ROLES.includes(normalizeRole(auth?.user?.role));
}

function teamWriteRoleAllowed(auth) {
  return TEAM_ADMIN_ROLES.includes(normalizeRole(auth?.user?.role));
}

function teamUnitsVisible(auth, units) {
  if (normalizeRole(auth?.user?.role) === 'ADMIN') return true;
  const actorUnits = normalizeAllowedUnits(auth?.user?.allowedUnits);
  const targetUnits = normalizeAllowedUnits(units);
  return actorUnits.length > 0 && targetUnits.length > 0 && targetUnits.every((unit) => actorUnits.includes(unit));
}

function teamPendingItems(rows) {
  const items = [];
  for (const row of rows || []) {
    const memberId = String(row?.id || '').trim();
    if (!memberId) continue;
    const provisioningState = String(row?.provisioningState || '').trim().toUpperCase();
    if (['PROVISIONING', 'WORKFORCE_SYNCED', 'INVITE_PENDING', 'FAILED'].includes(provisioningState)) {
      items.push({ memberId, kind: 'PROVISIONING', status: provisioningState });
    }
    const compensationState = String(row?.compensationState || '').trim().toUpperCase();
    if (compensationState) {
      items.push({ memberId, kind: 'COMPENSATION', status: compensationState });
    }
    if (!row?.crmAccountLinked && ['ACTIVE', 'SUSPENDED', 'TERMINATED'].includes(String(row?.accountStatus || '').toUpperCase())) {
      items.push({ memberId, kind: 'CRM_ACCOUNT_LINK', status: 'PENDING' });
    }
    for (const link of row?.identityLinks || []) {
      if (String(link?.reviewStatus || '').toUpperCase() === 'PENDING_REVIEW') {
        items.push({ memberId, kind: 'IDENTITY_LINK', source: String(link?.source || '').toUpperCase(), status: 'PENDING_REVIEW' });
      }
    }
    const scheduleState = normalizeScheduleSyncState(row?.scheduleSync?.state, row?.schedule?.professionalId ? 'SYNCED' : 'PENDING');
    if (['PENDING', 'FAILED', 'BLOCKED'].includes(scheduleState) && !['TERMINATED'].includes(String(row?.accountStatus || '').toUpperCase())) {
      items.push({ memberId, kind: 'ESCALA_SYNC', status: scheduleState });
    } else if (!row?.schedule?.professionalId && scheduleState !== 'NOT_CONFIGURED' && !['TERMINATED'].includes(String(row?.accountStatus || '').toUpperCase())) {
      items.push({ memberId, kind: 'ESCALA_LINK', status: 'PENDING' });
    }
  }
  return items.slice(0, 100);
}

function hasScheduleIntent(teamData) {
  return [
    teamData?.professionalId,
    teamData?.status,
    teamData?.role,
    teamData?.shift,
    teamData?.nickname,
    teamData?.instagram,
    teamData?.color,
  ].some((value) => String(value || '').trim() !== '');
}

function internalScheduleOperationKey(onboardingId, state) {
  return normalizeScheduleSyncOperationKey(`escala-sync:${String(onboardingId || '').trim()}:${String(state || 'PENDING').toLowerCase()}:${crypto.randomUUID()}`);
}

async function persistScheduleSyncOperation({
  env,
  onboardingId,
  state,
  professionalId = '',
  errorCode = '',
  operationKey,
}) {
  const normalizedOnboardingId = String(onboardingId || '').trim();
  const key = normalizeScheduleSyncOperationKey(operationKey);
  if (!normalizedOnboardingId || !key) throw new Error('ESCALA_SYNC_IDEMPOTENCY_REQUIRED');

  const existing = await env.DB.prepare('SELECT * FROM crm_team_operations WHERE operation_key=? LIMIT 1').bind(key).first();
  if (existing) {
    if (!scheduleSyncOperationMatches(existing, {
      onboardingId: normalizedOnboardingId,
      state,
      professionalId,
      errorCode,
    })) {
      throw new Error('ESCALA_SYNC_IDEMPOTENCY_CONFLICT');
    }
    return { replayed: true, scheduleSync: normalizeScheduleSyncResult(safeJsonParse(existing.result_json, {})) };
  }

  const latestRow = await env.DB.prepare(`SELECT operation_key, operation_type, member_ids_json, result_json, created_at
    FROM crm_team_operations
    WHERE operation_type='ESCALA_SYNC' AND member_ids_json = ?
    ORDER BY created_at DESC LIMIT 1`).bind(JSON.stringify([normalizedOnboardingId])).first();
  const previous = latestScheduleSyncByMember(latestRow ? [latestRow] : []).get(normalizedOnboardingId);
  const at = new Date().toISOString();
  const record = buildScheduleSyncRecord({
    state,
    professionalId,
    errorCode,
    attempt: (previous?.attempt || 0) + 1,
    createdAt: at,
  });
  try {
    await env.DB.prepare(`INSERT INTO crm_team_operations
      (operation_key, operation_type, requested_status, member_ids_json, outcome, result_json, created_at)
      VALUES (?, 'ESCALA_SYNC', ?, ?, ?, ?, ?)`)
      .bind(key, record.requestedStatus, JSON.stringify([normalizedOnboardingId]), record.outcome, record.resultJson, record.createdAt)
      .run();
  } catch (error) {
    const raced = await env.DB.prepare('SELECT * FROM crm_team_operations WHERE operation_key=? LIMIT 1').bind(key).first();
    if (!raced) throw error;
    if (!scheduleSyncOperationMatches(raced, {
      onboardingId: normalizedOnboardingId,
      state,
      professionalId,
      errorCode,
    })) throw new Error('ESCALA_SYNC_IDEMPOTENCY_CONFLICT');
    return { replayed: true, scheduleSync: normalizeScheduleSyncResult(safeJsonParse(raced.result_json, {})) };
  }
  return { replayed: false, scheduleSync: record.result };
}

function publicScheduleSync(value, fallbackProfessionalId = '') {
  const normalized = normalizeScheduleSyncResult(value, fallbackProfessionalId);
  return {
    state: normalized.state,
    professionalId: normalized.professionalId,
    errorCode: normalized.errorCode,
    attempt: normalized.attempt,
    updatedAt: normalized.updatedAt,
  };
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

function b64UrlToBytes(value) {
  const raw = String(value || '').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value || '').length / 4) * 4, '=');
  return Uint8Array.from(atob(raw), (char) => char.charCodeAt(0));
}

async function decryptOnboardingToken(env, value) {
  const secret = String(env?.IDENTITY_PII_KEY || '').trim();
  const parts = String(value || '').split('.');
  if (!secret || parts.length !== 3 || parts[0] !== 'v1') return '';
  const rawKey = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64UrlToBytes(parts[1]) }, key, b64UrlToBytes(parts[2]));
  return new TextDecoder().decode(plain);
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
    if (!await isAuthorizedDevSeedRequest({ env, request, url })) {
      return withCORS(JSON.stringify({ success: false, error: 'Not found' }), { status: 404 }, appOrigin);
    }

    try {
      const body = await request.json().catch(() => ({}));
      const payload = body?.payload ?? body;
      if (!payload || typeof payload !== 'object') {
        return withCORS(JSON.stringify({ success: false, error: 'Payload inválido' }), { status: 400 }, appOrigin);
      }
      const previewSnapshot = getInsumosPreviewSnapshotMetadata(payload);
      // Verify the exact inventory-only payload before any local row is
      // touched. A syntactically valid digest field is not evidence that the
      // snapshot itself was not changed after export.
      if (previewSnapshot) await verifyInsumosPreviewSnapshotIntegrity(payload);
      await restoreBackupPayload({ env, payload, strict: !!previewSnapshot });
      const verification = previewSnapshot
        ? await verifyInsumosPreviewRestore({ env, payload })
        : null;
      return withCORS(JSON.stringify({
        success: true,
        data: { restored: true, snapshot: verification },
      }), { status: 200 }, appOrigin);
    } catch (err) {
      const msg = String(err?.message || err || 'Erro ao restaurar');
      const status = msg === 'PAYLOAD_INVALID' ? 400 : 500;
      return withCORS(JSON.stringify({ success: false, error: msg }), { status }, appOrigin);
    }
  }

  const isTeamRoute = url.pathname === '/admin/team' || url.pathname.startsWith('/admin/team/');
  const isOnboardingRoute = url.pathname === '/admin/onboarding' || url.pathname.startsWith('/admin/onboarding/');
  const auth = await requireRoles(ROLE_ADMIN, { skipUnit: isTeamRoute || isOnboardingRoute });
  if (!auth.ok) return auth.response;

  if (isTeamRoute && !teamRoleAllowed(auth)) {
    return withCORS(JSON.stringify({ success: false, error: 'Sem permissão para administrar a equipe', code: 'TEAM_ROLE_DENIED' }), { status: 403 }, appOrigin);
  }
  if ((isTeamRoute || isOnboardingRoute) && request.method !== 'GET' && !teamWriteRoleAllowed(auth)) {
    return withCORS(JSON.stringify({ success: false, error: 'Apenas gestores podem alterar a equipe', code: 'TEAM_WRITE_ROLE_DENIED' }), { status: 403 }, appOrigin);
  }

  if (!env?.DB) {
    return withCORS(JSON.stringify({ success: false, error: 'DB_NOT_CONFIGURED' }), { status: 500 }, appOrigin);
  }

  const { usersTable, invitesTable } = await resolveCrmTables(env);
  const usersHasModules = await tableHasColumn(env, usersTable, 'allowed_modules_json');
  const invitesHasModules = await tableHasColumn(env, invitesTable, 'allowed_modules_json');
  const invitesHasInviteeEmail = await tableHasColumn(env, invitesTable, 'invitee_email');
  const invitesHasCorporateEmail = await tableHasColumn(env, invitesTable, 'corporate_email');
  const onboardingHasUsername = await tableHasColumn(env, 'crm_employee_onboarding', 'requested_username');
  const onboardingHasRequestFingerprint = await tableHasColumn(env, 'crm_employee_onboarding', 'request_fingerprint');
  const invitesHasUsername = await tableHasColumn(env, invitesTable, 'requested_username');
  const onboardingHasSaga = await tableHasColumn(env, 'crm_employee_onboarding', 'provisioning_state') && await tableHasColumn(env, 'crm_employee_onboarding', 'invite_token_encrypted');
  const teamTablesReady = await tableExists(env, 'crm_employee_team')
    && await tableExists(env, 'crm_employee_identity_links')
    && await tableExists(env, 'crm_employee_account_links')
    && await tableExists(env, 'crm_team_operations')
    && await tableExists(env, 'crm_team_telemetry');

  const teamSchemaMissing = [
    !onboardingHasUsername && 'ONBOARDING_USERNAME',
    !onboardingHasRequestFingerprint && 'ONBOARDING_REQUEST_FINGERPRINT',
    !invitesHasUsername && 'INVITE_USERNAME',
    !invitesHasCorporateEmail && 'INVITE_CORPORATE_EMAIL',
    !onboardingHasSaga && 'ONBOARDING_SAGA',
    !teamTablesReady && 'TEAM_LINK_LEDGER',
  ].filter(Boolean);
  const teamReadiness = buildTeamReadiness({
    enabled: unifiedTeamEnabled(env),
    schemaReady: teamSchemaMissing.length === 0,
    schemaMissing: teamSchemaMissing,
    workforceBinding: Boolean(env?.WORKFORCE?.fetch),
    piiKey: Boolean(String(env?.IDENTITY_PII_KEY || '').trim()),
    inviteMailer: Boolean(hasAuthMailerConfig(env)),
  });

  if (isTeamRoute && url.pathname === '/admin/team' && request.method === 'GET' && ['config', 'readiness'].includes(url.searchParams.get('mode'))) {
    const mode = url.searchParams.get('mode');
    if (mode === 'readiness') {
      return withCORS(JSON.stringify({ success: true, data: teamReadiness }), { status: 200 }, appOrigin);
    }
    return withCORS(JSON.stringify({
      success: true,
      data: {
        enabled: unifiedTeamEnabled(env),
        legacyEscalaEditor: !unifiedTeamEnabled(env),
        readiness: teamReadiness,
      },
    }), { status: 200 }, appOrigin);
  }

  if (isTeamRoute && !unifiedTeamEnabled(env)) {
    return withCORS(JSON.stringify({ success: false, error: 'Gestão centralizada da equipe ainda não está liberada', code: 'TEAM_UNIFIED_DISABLED' }), { status: 404 }, appOrigin);
  }

  if (isTeamRoute && (!onboardingHasUsername || !onboardingHasRequestFingerprint || !invitesHasUsername || !invitesHasCorporateEmail || !onboardingHasSaga || !teamTablesReady)) {
    return withCORS(JSON.stringify({ success: false, error: 'Migração da equipe unificada pendente', code: 'TEAM_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);
  }

  // POST /admin/onboarding
  // The client supplies employment facts only. Profile, scopes and invite state
  // are derived here so no browser can grant modules or a wider unit scope.
  if ((url.pathname === '/admin/onboarding' || url.pathname === '/admin/team') && request.method === 'POST') {
    let onboardingId = '';
    let requestId = '';
    let workforceSynchronized = false;
    let localPersistenceStage = 'PREPARATION';
    try {
      const body = await request.json().catch(() => ({}));
      const input = validateOnboardingInput(body, {
        unified: url.pathname === '/admin/team',
        requireCorporateDomain: url.pathname === '/admin/team',
      });
      if (!input) return withCORS(JSON.stringify({ success: false, error: 'Dados de cadastro inválidos', code: 'ONBOARDING_INVALID' }), { status: 400 }, appOrigin);
      const requestedUsername = input.requestedUsername || suggestEmployeeUsername(input.fullName, input.corporateEmail);
      if (url.pathname === '/admin/team' && !teamWriteRoleAllowed(auth)) {
        return withCORS(JSON.stringify({ success: false, error: 'Sem permissão para cadastrar equipe', code: 'TEAM_ROLE_DENIED' }), { status: 403 }, appOrigin);
      }
      const denied = canCreateEmployee({ actorRole: auth?.user?.role, actorAllowedUnits: auth?.user?.allowedUnits, targetProfile: input.profile, units: input.units });
      if (denied) return withCORS(JSON.stringify({ success: false, error: 'Sem permissão para cadastrar este cargo ou unidade', code: denied }), { status: 403 }, appOrigin);
      if (!invitesHasModules || !invitesHasInviteeEmail || !onboardingHasSaga) return withCORS(JSON.stringify({ success: false, error: 'Migração de onboarding pendente', code: 'ONBOARDING_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);

      const teamData = normalizeTeamData(body.team, input.units);
      if (url.pathname === '/admin/team' && body?.team?.units !== undefined && unknownUnitScopes(body.team.units).length) {
        return withCORS(JSON.stringify({ success: false, error: 'Unidades operacionais inválidas', code: 'TEAM_UNITS_INVALID' }), { status: 400 }, appOrigin);
      }
      if (url.pathname === '/admin/team' && teamData.units.some((unit) => !input.units.includes(unit))) {
        return withCORS(JSON.stringify({ success: false, error: 'As unidades operacionais devem estar dentro do escopo do cadastro', code: 'TEAM_UNITS_DENIED' }), { status: 403 }, appOrigin);
      }
      if (url.pathname === '/admin/team' && (!input.requestedUsername || !onboardingHasUsername || !invitesHasUsername)) {
        return withCORS(JSON.stringify({ success: false, error: 'Migração de usuário da equipe pendente', code: 'TEAM_USERNAME_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);
      }

      const personalEmailHash = await sha256Hex(input.personalEmail);
      const mobilePhoneHash = await sha256Hex(input.mobilePhone);
      const requestFingerprint = onboardingHasRequestFingerprint
        ? await sha256Hex(JSON.stringify(buildEmployeeOnboardingFingerprintPayload({
          input,
          requestedUsername,
          personalEmailHash,
          mobilePhoneHash,
          team: url.pathname === '/admin/team' ? teamData : null,
        })))
        : '';
      const idempotency = String(request.headers.get('idempotency-key') || body.idempotencyKey || '').trim().slice(0, 180);
      if (idempotency) {
        const existing = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE idempotency_key=? LIMIT 1').bind(idempotency).first();
        if (existing && url.pathname === '/admin/team' && (!existing.request_fingerprint || existing.request_fingerprint !== requestFingerprint)) {
          throw new Error(existing.request_fingerprint ? 'ONBOARDING_IDEMPOTENCY_CONFLICT' : 'ONBOARDING_IDEMPOTENCY_FINGERPRINT_REQUIRED');
        }
        if (existing?.provisioning_state === 'COMPLETED') return withCORS(JSON.stringify({ success: true, data: publicOnboarding(existing), replayed: true }), { status: 200 }, appOrigin);
      }
      const id = await sha256Hex(`employee-onboarding:v1:${input.corporateEmail}`);
      onboardingId = id;
      const existingOnboarding = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=? OR LOWER(corporate_email)=LOWER(?) LIMIT 1').bind(id, input.corporateEmail).first();
      if (existingOnboarding && String(existingOnboarding.id || '').trim() !== id) {
        throw new Error('ONBOARDING_IDEMPOTENCY_CONFLICT');
      }
      if (existingOnboarding && url.pathname === '/admin/team') {
        if (!existingOnboarding.request_fingerprint) throw new Error('ONBOARDING_IDEMPOTENCY_FINGERPRINT_REQUIRED');
        if (existingOnboarding.request_fingerprint !== requestFingerprint) throw new Error('ONBOARDING_IDEMPOTENCY_CONFLICT');
      }
      const existingUser = await env.DB.prepare(`SELECT username FROM ${usersTable} WHERE LOWER(email)=LOWER(?) LIMIT 1`).bind(input.corporateEmail).first();
      if (existingUser?.username) return withCORS(JSON.stringify({ success: false, error: 'Este e-mail corporativo já está cadastrado', code: 'EMAIL_TAKEN' }), { status: 409 }, appOrigin);
      const generatedEmailCollision = url.pathname === '/admin/team' && input.generatedCorporateEmail && input.generatedCorporateEmail !== input.corporateEmail
        ? await env.DB.prepare(`SELECT 1 FROM ${usersTable} WHERE LOWER(email)=LOWER(?) LIMIT 1`).bind(input.generatedCorporateEmail).first()
        : null;
      const generatedOnboardingCollision = url.pathname === '/admin/team' && input.generatedCorporateEmail && input.generatedCorporateEmail !== input.corporateEmail
        ? await env.DB.prepare('SELECT 1 FROM crm_employee_onboarding WHERE LOWER(corporate_email)=LOWER(?) AND id<>? LIMIT 1').bind(input.generatedCorporateEmail, id).first()
        : null;
      const generatedInviteCollision = url.pathname === '/admin/team' && invitesHasCorporateEmail && input.generatedCorporateEmail && input.generatedCorporateEmail !== input.corporateEmail
        ? await env.DB.prepare(`SELECT 1 FROM ${invitesTable} WHERE LOWER(corporate_email)=LOWER(?) AND id<>? AND COALESCE(revoked, 0)=0 AND COALESCE(uses_count, 0)=0 AND expires_at>? LIMIT 1`).bind(input.generatedCorporateEmail, existingOnboarding?.invite_id || '', new Date().toISOString()).first()
        : null;
      const corporateInviteCollision = url.pathname === '/admin/team' && invitesHasCorporateEmail
        ? await env.DB.prepare(`SELECT 1 FROM ${invitesTable} WHERE LOWER(corporate_email)=LOWER(?) AND id<>? AND COALESCE(revoked, 0)=0 AND COALESCE(uses_count, 0)=0 AND expires_at>? LIMIT 1`).bind(input.corporateEmail, existingOnboarding?.invite_id || '', new Date().toISOString()).first()
        : null;
      if (corporateInviteCollision) return withCORS(JSON.stringify({ success: false, error: 'Este e-mail corporativo já está reservado por um convite ativo', code: 'EMAIL_TAKEN' }), { status: 409 }, appOrigin);
      if (url.pathname === '/admin/team' && input.corporateEmailOverridden && !generatedEmailCollision && !generatedOnboardingCollision && !generatedInviteCollision) {
        return withCORS(JSON.stringify({ success: false, error: 'O ajuste do e-mail só é aceito após uma colisão confirmada', code: 'CORPORATE_EMAIL_OVERRIDE_REQUIRES_COLLISION' }), { status: 409 }, appOrigin);
      }
      if (onboardingHasUsername) {
        const usernameTaken = await env.DB.prepare(`SELECT 1 FROM ${usersTable} WHERE LOWER(username)=LOWER(?) LIMIT 1`).bind(requestedUsername).first();
        if (usernameTaken) return withCORS(JSON.stringify({ success: false, error: 'Este nome de usuário já está cadastrado', code: 'USERNAME_TAKEN' }), { status: 409 }, appOrigin);
        // Usernames are immutable login identifiers and remain reserved after
        // suspension or termination so history and audit references cannot be
        // rebound to another person.
        const pendingUsername = await env.DB.prepare('SELECT 1 FROM crm_employee_onboarding WHERE LOWER(requested_username)=LOWER(?) AND id<>? LIMIT 1').bind(requestedUsername, id).first();
        if (pendingUsername) return withCORS(JSON.stringify({ success: false, error: 'Este nome de usuário já está reservado', code: 'USERNAME_TAKEN' }), { status: 409 }, appOrigin);
        if (invitesHasUsername) {
          const invitedUsername = await env.DB.prepare(`SELECT 1 FROM ${invitesTable} WHERE LOWER(requested_username)=LOWER(?) AND id<>? AND COALESCE(revoked, 0)=0 LIMIT 1`).bind(requestedUsername, existingOnboarding?.invite_id || '').first();
          if (invitedUsername) return withCORS(JSON.stringify({ success: false, error: 'Este nome de usuário já está reservado por um convite', code: 'USERNAME_TAKEN' }), { status: 409 }, appOrigin);
        }
      }
      const at = new Date().toISOString();
      requestId = String(request.headers.get('x-request-id') || `identity-onboarding-${id}`).slice(0, 180);
      let repairMissingTeam = false;
      if (existingOnboarding?.provisioning_state === 'COMPLETED') {
        if (url.pathname !== '/admin/team') {
          return withCORS(JSON.stringify({ success: true, data: publicOnboarding(existingOnboarding), replayed: true }), { status: 200 }, appOrigin);
        }
        const existingTeam = await env.DB.prepare('SELECT onboarding_id FROM crm_employee_team WHERE onboarding_id=? LIMIT 1').bind(existingOnboarding.id).first();
        if (existingTeam?.onboarding_id) {
          return withCORS(JSON.stringify({ success: true, data: publicOnboarding(existingOnboarding), replayed: true }), { status: 200 }, appOrigin);
        }
        // A prior request may have completed Identity and the invite while
        // failing before the canonical team projection was persisted. Keep the
        // same idempotency fingerprint and repair only the missing projection.
        repairMissingTeam = true;
      }
      const encryptedPersonal = await encryptOnboardingPii(env, input.personalEmail);
      const encryptedPhone = await encryptOnboardingPii(env, input.mobilePhone);
      if (!existingOnboarding) {
        try {
          const columns = [
            'id', 'full_name', 'corporate_email', 'personal_email_encrypted', 'personal_email_hash',
            'mobile_phone_encrypted', 'mobile_phone_hash', 'profile', 'job_title', 'department_name',
            'units_json', 'account_status', 'invite_id', 'workforce_employee_id', 'idempotency_key',
            'created_by', 'created_at', 'updated_at', 'provisioning_state', 'invite_token_encrypted',
            'compensation_state', 'correlation_id',
          ];
          const values = [
            id, input.fullName, input.corporateEmail, encryptedPersonal, personalEmailHash,
            encryptedPhone, mobilePhoneHash, input.profile, displayJobTitle(input.profile),
            input.department, JSON.stringify(input.units), input.accountStatus, null, null, idempotency || null,
            String(auth?.user?.username || ''), at, at, 'PROVISIONING', null, null, requestId,
          ];
          if (onboardingHasUsername) {
            columns.push('requested_username');
            values.push(requestedUsername);
          }
          if (onboardingHasRequestFingerprint) {
            columns.push('request_fingerprint');
            values.push(requestFingerprint);
          }
          await env.DB.prepare(`INSERT INTO crm_employee_onboarding (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).bind(...values).run();
        } catch (insertError) {
          const raced = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=? OR LOWER(corporate_email)=LOWER(?) LIMIT 1').bind(id, input.corporateEmail).first();
          if (!raced) throw insertError;
          if (url.pathname === '/admin/team' && (!raced.request_fingerprint || raced.request_fingerprint !== requestFingerprint)) {
            throw new Error(raced.request_fingerprint ? 'ONBOARDING_IDEMPOTENCY_CONFLICT' : 'ONBOARDING_IDEMPOTENCY_FINGERPRINT_REQUIRED');
          }
        }
      }

      let current = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=?').bind(id).first();
      let workforce = current?.workforce_employee_id ? { employeeId: current.workforce_employee_id } : null;
      workforceSynchronized = Boolean(workforce?.employeeId);
      if (!workforce) {
        try {
          localPersistenceStage = 'WORKFORCE_SYNC';
          workforce = await syncIdentityWorkforceOnboarding(env, {
            onboardingId: id,
            fullName: input.fullName,
            corporateEmail: input.corporateEmail,
            mobilePhoneHash: await sha256Hex(input.mobilePhone),
            units: input.units,
            profile: input.profile,
            accountStatus: input.accountStatus,
            jobTitle: displayJobTitle(input.profile),
            department: input.department,
            createdBy: String(auth?.user?.username || ''),
          }, requestId);
          await env.DB.prepare('UPDATE crm_employee_onboarding SET workforce_employee_id=?, provisioning_state=?, updated_at=?, last_error_code=NULL WHERE id=?').bind(workforce?.employeeId || null, 'WORKFORCE_SYNCED', new Date().toISOString(), id).run();
          workforceSynchronized = Boolean(workforce?.employeeId);
          localPersistenceStage = 'WORKFORCE_SYNCED';
        } catch (error) {
          await env.DB.prepare('UPDATE crm_employee_onboarding SET provisioning_state=?, last_error_code=?, updated_at=? WHERE id=?').bind('FAILED', String(error?.message || 'WORKFORCE_SYNC_FAILED').slice(0, 120), new Date().toISOString(), id).run().catch(() => {});
          await Promise.resolve(appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, idempotencyKey: idempotency, action: 'EMPLOYEE_ONBOARDING_FAILED', entity: 'EMPLOYEE_ONBOARDING', entityId: id, unidade: input.units.join(','), after: { stage: 'WORKFORCE_SYNC', compensated: false, requestId } })).catch(() => {});
          throw error;
        }
      }

      let inviteId = current?.invite_id || null;
      let token = '';
      let expiresAt = '';
      localPersistenceStage = 'INVITE_PROVISIONING';
      if (shouldIssueInvite(input.accountStatus)) {
        if (inviteId) {
          const invite = await env.DB.prepare(`SELECT id, expires_at, revoked FROM ${invitesTable} WHERE id=? LIMIT 1`).bind(inviteId).first();
          expiresAt = String(invite?.expires_at || '');
          if (Number(invite?.revoked || 0) || !expiresAt || Date.now() >= new Date(expiresAt).getTime()) inviteId = null;
        }
        if (!inviteId) {
          token = randomInviteToken();
          expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          inviteId = crypto.randomUUID();
          const inviteColumns = ['id', 'token_hash', 'token_hint', 'invitee_email', 'role', 'allowed_units_json', 'allowed_modules_json', 'max_uses', 'uses_count', 'expires_at', 'revoked', 'note', 'created_by', 'created_at'];
          const inviteValues = [
            inviteId, await sha256Hex(token), `${token.slice(0, 4)}…${token.slice(-4)}`, input.personalEmail,
            input.profile, JSON.stringify(input.units), JSON.stringify(input.modules), 1, 0, expiresAt, 0,
            `Onboarding ${input.department}`, String(auth?.user?.username || ''), at,
          ];
          if (url.pathname === '/admin/team') {
            inviteColumns.splice(4, 0, 'corporate_email');
            inviteValues.splice(4, 0, input.corporateEmail);
          }
          if (invitesHasUsername) {
            inviteColumns.push('requested_username');
            inviteValues.push(requestedUsername);
          }
          await env.DB.prepare(`INSERT INTO ${invitesTable} (${inviteColumns.join(', ')}) VALUES (${inviteColumns.map(() => '?').join(', ')})`).bind(...inviteValues).run();
          const encryptedToken = await encryptOnboardingPii(env, token);
          await env.DB.prepare('UPDATE crm_employee_onboarding SET invite_id=?, invite_token_encrypted=?, provisioning_state=?, updated_at=? WHERE id=?').bind(inviteId, encryptedToken, 'INVITE_PENDING', new Date().toISOString(), id).run();
        } else if (!token && current?.invite_token_encrypted) {
          token = await decryptOnboardingToken(env, current.invite_token_encrypted);
        }
        if (!token) throw new Error('INVITE_TOKEN_UNAVAILABLE');
        const reuseExistingInvite = repairMissingTeam && existingOnboarding?.invite_id && inviteId === existingOnboarding.invite_id;
        if (!reuseExistingInvite) {
          try {
            localPersistenceStage = 'INVITE_DELIVERY';
            await sendAccountInviteEmail({ env, to: input.personalEmail, token, expiresAt, appUrl: String(env?.AUTH_INVITE_APP_URL || appOrigin) });
          } catch (error) {
            await env.DB.prepare(`UPDATE ${invitesTable} SET revoked=1 WHERE id=?`).bind(inviteId).run().catch(() => {});
            await syncIdentityWorkforceStatus(env, { onboardingId: id, employeeId: workforce?.employeeId, accountStatus: 'PENDING_ACCESS' }, requestId).catch(() => {});
            await env.DB.prepare('UPDATE crm_employee_onboarding SET provisioning_state=?, compensation_state=?, last_error_code=?, updated_at=? WHERE id=?').bind('FAILED', 'WORKFORCE_PENDING_ACCESS', 'EMAIL_DELIVERY_FAILED', new Date().toISOString(), id).run().catch(() => {});
            await Promise.resolve(appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, idempotencyKey: idempotency, action: 'EMPLOYEE_ONBOARDING_COMPENSATED', entity: 'EMPLOYEE_ONBOARDING', entityId: id, unidade: input.units.join(','), after: { stage: 'EMAIL_DELIVERY', workforceAccessState: 'PENDING_ACCESS', inviteRevoked: true, requestId } })).catch(() => {});
            throw error;
          }
        }
      }
      localPersistenceStage = 'ONBOARDING_COMPLETE';
      await env.DB.prepare('UPDATE crm_employee_onboarding SET invite_id=?, workforce_employee_id=?, provisioning_state=?, updated_at=?, last_error_code=NULL WHERE id=?').bind(inviteId, workforce?.employeeId || null, 'COMPLETED', new Date().toISOString(), id).run();
      let scheduleSync = null;
      if (url.pathname === '/admin/team') {
        localPersistenceStage = 'TEAM_CREATE';
        const workforceEmployeeId = String(workforce?.employeeId || '').trim();
        if (!workforceEmployeeId) throw new Error('WORKFORCE_EMPLOYEE_ID_REQUIRED');
        const teamAt = new Date().toISOString();
        const existingTeam = await env.DB.prepare('SELECT workforce_employee_id FROM crm_employee_team WHERE onboarding_id=? LIMIT 1').bind(id).first();
        if (existingTeam?.workforce_employee_id) {
          await env.DB.prepare(`UPDATE crm_employee_team
            SET schedule_status=?, schedule_role=?, schedule_shift=?, schedule_nickname=?, schedule_instagram=?, schedule_color=?, units_json=?, updated_at=?
            WHERE onboarding_id=?`).bind(
            teamData.status || null, teamData.role || null, teamData.shift || null, teamData.nickname || null,
            teamData.instagram || null, teamData.color || null, JSON.stringify(teamData.units), teamAt, id,
          ).run();
        } else {
          await env.DB.prepare(`INSERT INTO crm_employee_team
            (workforce_employee_id, onboarding_id, schedule_professional_id, schedule_status, schedule_role, schedule_shift, schedule_nickname, schedule_instagram, schedule_color, units_json, created_by, created_at, updated_at)
            VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
            workforceEmployeeId, id, teamData.status || null, teamData.role || null, teamData.shift || null,
            teamData.nickname || null, teamData.instagram || null, teamData.color || null, JSON.stringify(teamData.units),
            String(auth?.user?.username || ''), teamAt, teamAt,
          ).run();
        }
        const scheduleState = hasScheduleIntent(teamData) ? 'PENDING' : 'NOT_CONFIGURED';
        scheduleSync = await persistScheduleSyncOperation({
          env,
          onboardingId: id,
          state: scheduleState,
          operationKey: internalScheduleOperationKey(id, scheduleState),
        }).catch(() => null);
      }
      const created = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=?').bind(id).first();
      await appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, idempotencyKey: idempotency, action: 'EMPLOYEE_ONBOARDING_CREATE', entity: 'EMPLOYEE_ONBOARDING', entityId: id, unidade: input.units.join(','), after: { profile: input.profile, jobTitle: displayJobTitle(input.profile), department: input.department, units: input.units, accountStatus: input.accountStatus, inviteIssued: !!inviteId, workforceEmployeeId: workforce?.employeeId || null, provisioningState: 'COMPLETED', scheduleSyncState: scheduleSync?.scheduleSync?.state || (url.pathname === '/admin/team' ? 'PENDING' : null) } });
      await recordTeamTelemetry({ env, eventName: 'EMPLOYEE_TEAM_CREATED', actorRole: auth.user.role, itemCount: 1, unitCount: input.units.length });
      return withCORS(JSON.stringify({ success: true, data: publicOnboarding(created), team: url.pathname === '/admin/team' ? { ...normalizeTeamData(teamData, input.units), scheduleSync: publicScheduleSync(scheduleSync?.scheduleSync || { state: hasScheduleIntent(teamData) ? 'PENDING' : 'NOT_CONFIGURED' }, '') } : undefined }), { status: existingOnboarding ? 200 : 201 }, appOrigin);
    } catch (error) {
      const message = String(error?.message || 'ONBOARDING_FAILED');
      if (url.pathname === '/admin/team' && workforceSynchronized && onboardingId && ['ONBOARDING_COMPLETE', 'TEAM_CREATE'].includes(localPersistenceStage)) {
        const safeErrorCode = message.slice(0, 120);
        await env.DB.prepare("UPDATE crm_employee_onboarding SET compensation_state='LOCAL_TEAM_CREATE_PENDING', last_error_code=?, updated_at=? WHERE id=?")
          .bind(safeErrorCode, new Date().toISOString(), onboardingId)
          .run()
          .catch(() => {});
        await Promise.resolve(appendAuditLog?.({
          env,
          actor: auth.user.username,
          role: auth.user.role,
          ip,
          userAgent,
          idempotencyKey: String(request.headers.get('idempotency-key') || '').trim().slice(0, 180),
          action: 'EMPLOYEE_TEAM_COMPENSATION_PENDING',
          entity: 'EMPLOYEE_ONBOARDING',
          entityId: onboardingId,
          unidade: '',
          after: { stage: localPersistenceStage, workforceSynchronized: true, requestId, failClosed: true },
        })).catch(() => {});
        await recordTeamTelemetry({ env, eventName: 'EMPLOYEE_TEAM_CREATED', actorRole: auth.user.role, outcome: 'PENDING', itemCount: 1 });
        return withCORS(JSON.stringify({ success: false, error: 'Projeção local da equipe pendente de compensação', code: 'TEAM_LOCAL_PERSISTENCE_PENDING' }), { status: 503 }, appOrigin);
      }
      const status = ['ONBOARDING_IDEMPOTENCY_CONFLICT', 'ONBOARDING_IDEMPOTENCY_FINGERPRINT_REQUIRED'].includes(message)
        ? 409
        : isOnboardingDependencyError(message) ? 503 : 500;
      return withCORS(JSON.stringify({ success: false, error: status === 503 ? 'Configuração segura de cadastro pendente' : 'Não foi possível concluir o cadastro', code: message }), { status }, appOrigin);
    }
  }

  // Activation is a resumable compensation boundary for the one-time invite
  // flow. The invite remains consumed; only a privileged operator can retry
  // the Identity -> Workforce status transition after a transient failure.
  const activationMatch = url.pathname.match(/^\/admin\/(onboarding|team)\/([^/]+)\/activate$/);
  if (activationMatch && request.method === 'POST') {
    try {
      if (!onboardingHasSaga) return withCORS(JSON.stringify({ success: false, error: 'ONBOARDING_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);
      const onboardingId = decodeURIComponent(activationMatch[2] || '').trim();
      const onboarding = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=? LIMIT 1').bind(onboardingId).first();
      if (!onboarding?.workforce_employee_id || !['INVITED', 'ACTIVE'].includes(String(onboarding.account_status || '').toUpperCase())) {
        return withCORS(JSON.stringify({ success: false, error: 'ONBOARDING_ACTIVATION_NOT_READY' }), { status: 409 }, appOrigin);
      }
      if (!teamUnitsVisible(auth, onboarding.units_json)) {
        return withCORS(JSON.stringify({ success: false, error: 'Unidade fora do escopo do gestor', code: 'TEAM_UNITS_DENIED' }), { status: 403 }, appOrigin);
      }
      const hierarchyDenied = canCreateEmployee({ actorRole: auth?.user?.role, actorAllowedUnits: auth?.user?.allowedUnits, targetProfile: onboarding.profile, units: normalizeAllowedUnits(onboarding.units_json) });
      if (hierarchyDenied) {
        return withCORS(JSON.stringify({ success: false, error: 'Hierarquia não permite ativar este membro', code: hierarchyDenied }), { status: 403 }, appOrigin);
      }
      if (String(onboarding.account_status).toUpperCase() === 'ACTIVE') {
        return withCORS(JSON.stringify({ success: true, data: publicOnboarding(onboarding), replayed: true }), { status: 200 }, appOrigin);
      }
      if (activationMatch[1] === 'team') {
        const accountLink = await env.DB.prepare("SELECT id FROM crm_employee_account_links WHERE onboarding_id=? AND review_status='CONFIRMED' LIMIT 1").bind(onboardingId).first();
        if (!accountLink?.id) {
          return withCORS(JSON.stringify({ success: false, error: 'Vínculo explícito da conta CRM pendente', code: 'CRM_ACCOUNT_LINK_REQUIRED' }), { status: 409 }, appOrigin);
        }
      }
      const registeredUser = activationMatch[1] === 'team'
        ? await env.DB.prepare(`SELECT u.username, u.password_hash FROM ${usersTable} u JOIN crm_employee_account_links a ON a.crm_username=u.username AND a.onboarding_id=? AND a.review_status='CONFIRMED' LIMIT 1`).bind(onboardingId).first()
        : await env.DB.prepare(`SELECT username, password_hash FROM ${usersTable} WHERE LOWER(email)=LOWER(?) LIMIT 1`).bind(onboarding.corporate_email).first();
      if (!registeredUser?.username || !String(registeredUser?.password_hash || '').trim()) {
        return withCORS(JSON.stringify({ success: false, error: 'O funcionário ainda precisa criar a senha pelo convite', code: 'INVITE_REGISTRATION_REQUIRED' }), { status: 409 }, appOrigin);
      }
      const requestId = String(request.headers.get('x-request-id') || `identity-activation-${onboardingId}`).slice(0, 180);
      await syncIdentityWorkforceStatus(env, { onboardingId, employeeId: onboarding.workforce_employee_id, accountStatus: 'ACTIVE' }, requestId);
      const at = new Date().toISOString();
      await env.DB.batch([
        activationMatch[1] === 'team'
          ? env.DB.prepare(`UPDATE ${usersTable} SET ativo=1, updated_at=? WHERE username IN (SELECT crm_username FROM crm_employee_account_links WHERE onboarding_id=? AND review_status='CONFIRMED')`).bind(at, onboardingId)
          : env.DB.prepare(`UPDATE ${usersTable} SET ativo=1, updated_at=? WHERE LOWER(email)=LOWER(?)`).bind(at, onboarding.corporate_email),
        env.DB.prepare("UPDATE crm_employee_onboarding SET account_status='ACTIVE', provisioning_state='COMPLETED', compensation_state=NULL, last_error_code=NULL, updated_at=? WHERE id=?").bind(at, onboardingId),
      ]);
      const activated = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=?').bind(onboardingId).first();
      await appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, action: 'EMPLOYEE_ONBOARDING_ACTIVATION_RETRY', entity: 'EMPLOYEE_ONBOARDING', entityId: onboardingId, unidade: normalizeAllowedUnits(onboarding.units_json).join(','), before: { accountStatus: onboarding.account_status }, after: { accountStatus: 'ACTIVE', requestId } });
      return withCORS(JSON.stringify({ success: true, data: publicOnboarding(activated) }), { status: 200 }, appOrigin);
    } catch (error) {
      const message = String(error?.message || 'ONBOARDING_ACTIVATION_FAILED');
      return withCORS(JSON.stringify({ success: false, error: 'ACCOUNT_ACTIVATION_PENDING', code: message }), { status: 503 }, appOrigin);
    }
  }

  // Account-state changes are a second Identity -> Workforce saga boundary.
  // Do not use the legacy user editor for onboarding accounts: it only knows
  // `ativo`, while Workforce must keep the authoritative access_state aligned.
  const statusMatch = url.pathname.match(/^\/admin\/(onboarding|team)\/([^/]+)\/status$/);
  if (statusMatch && request.method === 'POST') {
    try {
      if (!onboardingHasSaga) return withCORS(JSON.stringify({ success: false, error: 'ONBOARDING_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);
      const onboardingId = decodeURIComponent(statusMatch[2] || '').trim();
      const body = await request.json().catch(() => ({}));
      const nextStatus = normalizeAccountState(body.accountStatus);
      // Activation is deliberately handled only by the invite/registration
      // boundary above. The only manager-driven reactivation is a return from
      // SUSPENDED; an INVITED employee must still create their own password.
      if (!onboardingId || !['ACTIVE', 'SUSPENDED', 'TERMINATED'].includes(nextStatus)) return withCORS(JSON.stringify({ success: false, error: 'ONBOARDING_STATUS_INVALID' }), { status: 400 }, appOrigin);
      const onboarding = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=? LIMIT 1').bind(onboardingId).first();
      if (!onboarding?.workforce_employee_id) return withCORS(JSON.stringify({ success: false, error: 'ONBOARDING_STATUS_NOT_READY' }), { status: 409 }, appOrigin);
      const currentStatus = normalizeAccountState(onboarding.account_status);
      if (nextStatus === 'ACTIVE' && !['ACTIVE', 'SUSPENDED'].includes(currentStatus)) return withCORS(JSON.stringify({ success: false, error: 'A ativação depende da criação da senha pelo funcionário', code: 'INVITE_ACTIVATION_REQUIRED' }), { status: 409 }, appOrigin);
      if (!teamUnitsVisible(auth, onboarding.units_json)) return withCORS(JSON.stringify({ success: false, error: 'Unidade fora do escopo do gestor', code: 'TEAM_UNITS_DENIED' }), { status: 403 }, appOrigin);
      const terminationReason = String(body.reason ?? body.terminationReason ?? '').trim().replace(/\s+/g, ' ').slice(0, 500);
      if (nextStatus === 'TERMINATED' && terminationReason.length < 5) return withCORS(JSON.stringify({ success: false, error: 'O desligamento exige um motivo', code: 'TEAM_TERMINATION_REASON_REQUIRED' }), { status: 400 }, appOrigin);
      const denied = canCreateEmployee({ actorRole: auth?.user?.role, actorAllowedUnits: auth?.user?.allowedUnits, targetProfile: onboarding.profile, units: normalizeAllowedUnits(onboarding.units_json) });
      if (denied) return withCORS(JSON.stringify({ success: false, error: 'Sem permissão para alterar este vínculo', code: denied }), { status: 403 }, appOrigin);
      if (!isValidAccountTransition(currentStatus, nextStatus)) return withCORS(JSON.stringify({ success: false, error: 'ONBOARDING_STATUS_TRANSITION_DENIED' }), { status: 409 }, appOrigin);
      if (statusMatch[1] === 'team' && currentStatus !== nextStatus && ['ACTIVE', 'SUSPENDED'].includes(currentStatus)) {
        const accountLink = await env.DB.prepare("SELECT id FROM crm_employee_account_links WHERE onboarding_id=? AND review_status='CONFIRMED' LIMIT 1").bind(onboardingId).first();
        if (!accountLink?.id) {
          return withCORS(JSON.stringify({ success: false, error: 'Resolva o vínculo explícito da conta CRM antes de alterar o acesso', code: 'CRM_ACCOUNT_LINK_REQUIRED' }), { status: 409 }, appOrigin);
        }
      }

      const requestId = String(request.headers.get('x-request-id') || `identity-status-${onboardingId}`).slice(0, 180);
      const at = new Date().toISOString();
      const revokeInvite = ['SUSPENDED', 'TERMINATED'].includes(nextStatus) ? 1 : 0;
      const crmUserSelector = statusMatch[1] === 'team'
        ? { where: "username IN (SELECT crm_username FROM crm_employee_account_links WHERE onboarding_id=? AND review_status='CONFIRMED')", value: onboardingId }
        : { where: 'LOWER(email)=LOWER(?)', value: onboarding.corporate_email };
      if (currentStatus !== nextStatus) {
        const syncPayload = { onboardingId, employeeId: onboarding.workforce_employee_id, accountStatus: nextStatus };
        const reactivation = nextStatus === 'ACTIVE' && currentStatus === 'SUSPENDED';
        if (reactivation) {
          // Re-enabling access is fail-closed: Workforce must accept the
          // transition before Identity marks the CRM login active.
          try {
            await syncIdentityWorkforceStatus(env, syncPayload, requestId);
          } catch (error) {
            const code = String(error?.message || 'WORKFORCE_STATUS_SYNC_FAILED').slice(0, 120);
            await env.DB.prepare("UPDATE crm_employee_onboarding SET compensation_state='WORKFORCE_STATUS_PENDING', last_error_code=?, updated_at=? WHERE id=?").bind(code, new Date().toISOString(), onboardingId).run().catch(() => {});
            await Promise.resolve(appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, action: 'EMPLOYEE_ONBOARDING_STATUS_SYNC_FAILED', entity: 'EMPLOYEE_ONBOARDING', entityId: onboardingId, unidade: normalizeAllowedUnits(onboarding.units_json).join(','), before: { accountStatus: currentStatus }, after: { requestedStatus: nextStatus, requestId, failClosed: true, localAccessPreserved: false } })).catch(() => {});
            return withCORS(JSON.stringify({ success: false, error: 'ACCOUNT_STATUS_PENDING', code }), { status: 503 }, appOrigin);
          }
          try {
            await env.DB.batch([
              env.DB.prepare("UPDATE crm_employee_onboarding SET account_status='ACTIVE', provisioning_state='COMPLETED', compensation_state=NULL, last_error_code=NULL, updated_at=? WHERE id=? AND account_status='SUSPENDED'").bind(new Date().toISOString(), onboardingId),
              env.DB.prepare(`UPDATE ${usersTable} SET ativo=1, session_version=COALESCE(session_version, 0)+1, updated_at=? WHERE ${crmUserSelector.where}`).bind(new Date().toISOString(), crmUserSelector.value),
            ]);
            const activatedUser = await env.DB.prepare(`SELECT ativo FROM ${usersTable} WHERE ${crmUserSelector.where} LIMIT 1`).bind(crmUserSelector.value).first();
            if (Number(activatedUser?.ativo || 0) !== 1) throw new Error('IDENTITY_LOCAL_ACTIVATION_NOT_APPLIED');
          } catch (error) {
            const localCode = String(error?.message || 'IDENTITY_LOCAL_ACTIVATION_FAILED').slice(0, 120);
            let compensation = 'NOT_CONFIRMED';
            try {
              await syncIdentityWorkforceStatus(env, { ...syncPayload, accountStatus: 'SUSPENDED' }, `${requestId}:compensate`);
              compensation = 'WORKFORCE_REVERTED';
            } catch {
              compensation = 'WORKFORCE_REVERT_PENDING';
            }
            await env.DB.prepare("UPDATE crm_employee_onboarding SET account_status='SUSPENDED', compensation_state=?, last_error_code=?, updated_at=? WHERE id=?").bind(compensation === 'WORKFORCE_REVERTED' ? 'LOCAL_STATUS_UPDATE_PENDING' : 'WORKFORCE_STATUS_COMPENSATION_PENDING', localCode, new Date().toISOString(), onboardingId).run().catch(() => {});
            await env.DB.prepare(`UPDATE ${usersTable} SET ativo=0, session_version=COALESCE(session_version, 0)+1, updated_at=? WHERE ${crmUserSelector.where}`).bind(new Date().toISOString(), crmUserSelector.value).run().catch(() => {});
            await Promise.resolve(appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, action: 'EMPLOYEE_ONBOARDING_STATUS_COMPENSATION_PENDING', entity: 'EMPLOYEE_ONBOARDING', entityId: onboardingId, unidade: normalizeAllowedUnits(onboarding.units_json).join(','), before: { accountStatus: currentStatus }, after: { requestedStatus: nextStatus, requestId, compensation, failClosed: true } })).catch(() => {});
            return withCORS(JSON.stringify({ success: false, error: 'ACCOUNT_STATUS_PENDING', code: localCode }), { status: 503 }, appOrigin);
          }
        } else {
          // Deactivation is also fail-closed: local access is revoked before
          // the remote Workforce transition and remains revoked on failure.
          try {
            await env.DB.batch([
              env.DB.prepare("UPDATE crm_employee_onboarding SET account_status=?, provisioning_state='COMPLETED', compensation_state='WORKFORCE_STATUS_PENDING', last_error_code=NULL, updated_at=? WHERE id=? AND account_status=?").bind(nextStatus, at, onboardingId, currentStatus),
              env.DB.prepare(`UPDATE ${usersTable} SET ativo=0, session_version=COALESCE(session_version, 0)+1, updated_at=? WHERE ${crmUserSelector.where}`).bind(at, crmUserSelector.value),
              ...(revokeInvite && onboarding.invite_id ? [env.DB.prepare(`UPDATE ${invitesTable} SET revoked=1 WHERE id=? AND uses_count=0`).bind(onboarding.invite_id)] : []),
            ]);
          } catch {
            return withCORS(JSON.stringify({ success: false, error: 'ACCOUNT_STATUS_PENDING', code: 'IDENTITY_STATUS_UPDATE_FAILED' }), { status: 503 }, appOrigin);
          }
          try {
            await syncIdentityWorkforceStatus(env, syncPayload, requestId);
          } catch (error) {
            const code = String(error?.message || 'WORKFORCE_STATUS_SYNC_FAILED').slice(0, 120);
            await env.DB.prepare("UPDATE crm_employee_onboarding SET compensation_state='WORKFORCE_STATUS_PENDING', last_error_code=?, updated_at=? WHERE id=?").bind(code, new Date().toISOString(), onboardingId).run().catch(() => {});
            await Promise.resolve(appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, action: 'EMPLOYEE_ONBOARDING_STATUS_SYNC_FAILED', entity: 'EMPLOYEE_ONBOARDING', entityId: onboardingId, unidade: normalizeAllowedUnits(onboarding.units_json).join(','), before: { accountStatus: currentStatus }, after: { requestedStatus: nextStatus, requestId, failClosed: true, localAccessRevoked: true } })).catch(() => {});
            return withCORS(JSON.stringify({ success: false, error: 'ACCOUNT_STATUS_PENDING', code }), { status: 503 }, appOrigin);
          }
          await env.DB.prepare('UPDATE crm_employee_onboarding SET compensation_state=NULL, last_error_code=NULL, updated_at=? WHERE id=?').bind(new Date().toISOString(), onboardingId).run();
        }
      }

      const pending = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=? LIMIT 1').bind(onboardingId).first();
      if (normalizeAccountState(pending?.account_status) !== nextStatus) return withCORS(JSON.stringify({ success: false, error: 'ACCOUNT_STATUS_PENDING', code: 'IDENTITY_STATUS_CONFLICT' }), { status: 409 }, appOrigin);
      const updated = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=? LIMIT 1').bind(onboardingId).first();
      await appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, action: 'EMPLOYEE_ONBOARDING_STATUS_CHANGED', entity: 'EMPLOYEE_ONBOARDING', entityId: onboardingId, unidade: normalizeAllowedUnits(onboarding.units_json).join(','), before: { accountStatus: currentStatus }, after: { accountStatus: nextStatus, inviteRevoked: Boolean(revokeInvite && onboarding.invite_id), sessionVersionIncremented: currentStatus !== nextStatus, terminationReasonProvided: nextStatus === 'TERMINATED', terminationReason: nextStatus === 'TERMINATED' ? terminationReason : null, requestId } });
      await recordTeamTelemetry({ env, eventName: 'EMPLOYEE_TEAM_STATUS_CHANGED', actorRole: auth.user.role, itemCount: 1, unitCount: normalizeAllowedUnits(onboarding.units_json).length });
      return withCORS(JSON.stringify({ success: true, data: publicOnboarding(updated), replayed: currentStatus === nextStatus }), { status: 200 }, appOrigin);
    } catch (error) {
      return withCORS(JSON.stringify({ success: false, error: 'ACCOUNT_STATUS_PENDING', code: String(error?.message || 'ONBOARDING_STATUS_FAILED').slice(0, 120) }), { status: 503 }, appOrigin);
    }
  }

  if (url.pathname === '/admin/team/bulk-status' && request.method === 'POST') {
    try {
      if (!onboardingHasSaga || !teamTablesReady) return withCORS(JSON.stringify({ success: false, error: 'Migração da equipe unificada pendente', code: 'TEAM_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);
      const body = await request.json().catch(() => ({}));
      const ids = Array.from(new Set((Array.isArray(body?.ids) ? body.ids : []).map((value) => String(value || '').trim()).filter(Boolean))).sort();
      const nextStatus = normalizeAccountState(body?.accountStatus);
      const operationKey = String(request.headers.get('idempotency-key') || body?.idempotencyKey || '').trim().slice(0, 180);
      if (!operationKey) return withCORS(JSON.stringify({ success: false, error: 'Ação em lote exige uma chave de idempotência', code: 'BULK_IDEMPOTENCY_REQUIRED' }), { status: 400 }, appOrigin);
      if (!ids.length || ids.length > 50 || !['ACTIVE', 'SUSPENDED'].includes(nextStatus)) return withCORS(JSON.stringify({ success: false, error: 'Ação em lote inválida', code: 'BULK_STATUS_INVALID' }), { status: 400 }, appOrigin);

      const previous = await env.DB.prepare('SELECT * FROM crm_team_operations WHERE operation_key=? LIMIT 1').bind(operationKey).first();
      if (previous) {
        const previousIds = safeJsonParse(previous.member_ids_json, []);
        if (String(previous.requested_status || '') !== nextStatus || JSON.stringify(previousIds) !== JSON.stringify(ids)) {
          return withCORS(JSON.stringify({ success: false, error: 'A chave de idempotência já foi usada para outra ação', code: 'BULK_IDEMPOTENCY_CONFLICT' }), { status: 409 }, appOrigin);
        }
        return withCORS(JSON.stringify({ success: previous.outcome === 'COMPLETED', replayed: true, data: safeJsonParse(previous.result_json, { ids, accountStatus: nextStatus, count: ids.length, pendingIds: ids }), code: previous.outcome === 'COMPLETED' ? undefined : 'BULK_STATUS_SYNC_PENDING' }), { status: previous.outcome === 'COMPLETED' ? 200 : 503 }, appOrigin);
      }

      const placeholders = ids.map(() => '?').join(',');
      const selected = await env.DB.prepare(`SELECT o.*, a.crm_username AS crm_account_username, a.review_status AS crm_account_review_status
        FROM crm_employee_onboarding o
        LEFT JOIN crm_employee_account_links a ON a.onboarding_id=o.id
        WHERE o.id IN (${placeholders})`).bind(...ids).all();
      const byId = new Map((selected?.results || []).map((row) => [String(row.id || ''), row]));
      if (byId.size !== ids.length) return withCORS(JSON.stringify({ success: false, error: 'Um ou mais membros não foram encontrados', code: 'TEAM_MEMBER_NOT_FOUND' }), { status: 404 }, appOrigin);
      const rows = ids.map((id) => byId.get(id));
      for (const row of rows) {
        const units = normalizeAllowedUnits(row.units_json);
        if (!teamUnitsVisible(auth, units)) return withCORS(JSON.stringify({ success: false, error: 'Unidade fora do escopo do gestor', code: 'TEAM_UNITS_DENIED' }), { status: 403 }, appOrigin);
        const hierarchyDenied = canCreateEmployee({ actorRole: auth?.user?.role, actorAllowedUnits: auth?.user?.allowedUnits, targetProfile: row.profile, units });
        if (hierarchyDenied) return withCORS(JSON.stringify({ success: false, error: 'Hierarquia não permite alterar este membro', code: hierarchyDenied }), { status: 403 }, appOrigin);
        if (!['ACTIVE', 'SUSPENDED'].includes(normalizeAccountState(row.account_status))) return withCORS(JSON.stringify({ success: false, error: 'Ação em lote aceita somente membros ativos ou suspensos', code: 'BULK_STATUS_TRANSITION_DENIED' }), { status: 409 }, appOrigin);
        if (!row.workforce_employee_id) return withCORS(JSON.stringify({ success: false, error: 'Membro ainda não possui identidade Workforce', code: 'ONBOARDING_STATUS_NOT_READY' }), { status: 409 }, appOrigin);
        if (normalizeAccountState(row.account_status) !== nextStatus && String(row.crm_account_review_status || '').toUpperCase() !== 'CONFIRMED') {
          return withCORS(JSON.stringify({ success: false, error: 'Resolva o vínculo explícito da conta CRM antes de alterar o acesso', code: 'CRM_ACCOUNT_LINK_REQUIRED' }), { status: 409 }, appOrigin);
        }
      }

      const at = new Date().toISOString();
      const pendingIds = [];
      const auditRows = [];
      for (const row of rows) {
        const currentStatus = normalizeAccountState(row.account_status);
        if (currentStatus === nextStatus) continue;
        const requestId = `${String(request.headers.get('x-request-id') || operationKey)}:${row.id}`.slice(0, 180);
        let pending = false;
        if (nextStatus === 'ACTIVE') {
          // Reactivation must be accepted by Workforce before local login
          // access is enabled. If the local write fails, revert the remote
          // state and keep the user disabled.
          try {
            await syncIdentityWorkforceStatus(env, { onboardingId: row.id, employeeId: row.workforce_employee_id, accountStatus: nextStatus }, requestId);
            await env.DB.batch([
              env.DB.prepare("UPDATE crm_employee_onboarding SET account_status='ACTIVE', provisioning_state='COMPLETED', compensation_state=NULL, last_error_code=NULL, updated_at=? WHERE id=? AND account_status='SUSPENDED'").bind(new Date().toISOString(), row.id),
              env.DB.prepare(`UPDATE ${usersTable} SET ativo=1, session_version=COALESCE(session_version, 0)+1, updated_at=? WHERE username IN (SELECT crm_username FROM crm_employee_account_links WHERE onboarding_id=? AND review_status='CONFIRMED')`).bind(new Date().toISOString(), row.id),
            ]);
            const verified = await env.DB.prepare(`SELECT o.account_status, u.ativo FROM crm_employee_onboarding o LEFT JOIN crm_employee_account_links a ON a.onboarding_id=o.id AND a.review_status='CONFIRMED' LEFT JOIN ${usersTable} u ON u.username=a.crm_username WHERE o.id=? LIMIT 1`).bind(row.id).first();
            if (normalizeAccountState(verified?.account_status) !== 'ACTIVE' || Number(verified?.ativo || 0) !== 1) throw new Error('IDENTITY_LOCAL_ACTIVATION_NOT_APPLIED');
          } catch (error) {
            pending = true;
            const code = String(error?.message || 'WORKFORCE_STATUS_SYNC_FAILED').slice(0, 120);
            try {
              await syncIdentityWorkforceStatus(env, { onboardingId: row.id, employeeId: row.workforce_employee_id, accountStatus: 'SUSPENDED' }, `${requestId}:compensate`);
            } catch {
              // Local access remains disabled even if remote compensation also
              // needs a later operator retry.
            }
            await env.DB.prepare("UPDATE crm_employee_onboarding SET account_status='SUSPENDED', compensation_state='WORKFORCE_STATUS_PENDING', last_error_code=?, updated_at=? WHERE id=?").bind(code, new Date().toISOString(), row.id).run().catch(() => {});
            await env.DB.prepare(`UPDATE ${usersTable} SET ativo=0, updated_at=? WHERE username IN (SELECT crm_username FROM crm_employee_account_links WHERE onboarding_id=? AND review_status='CONFIRMED')`).bind(new Date().toISOString(), row.id).run().catch(() => {});
          }
        } else {
          // Suspension is locally revoked first, so a Workforce outage cannot
          // leave an account operational after a manager asked to disable it.
          try {
            await env.DB.batch([
              env.DB.prepare("UPDATE crm_employee_onboarding SET account_status=?, provisioning_state='COMPLETED', compensation_state='WORKFORCE_STATUS_PENDING', last_error_code=NULL, updated_at=? WHERE id=? AND account_status=?").bind(nextStatus, at, row.id, currentStatus),
              env.DB.prepare(`UPDATE ${usersTable} SET ativo=0, session_version=COALESCE(session_version, 0)+1, updated_at=? WHERE username IN (SELECT crm_username FROM crm_employee_account_links WHERE onboarding_id=? AND review_status='CONFIRMED')`).bind(at, row.id),
              ...(nextStatus === 'SUSPENDED' && row.invite_id ? [env.DB.prepare(`UPDATE ${invitesTable} SET revoked=1 WHERE id=? AND uses_count=0`).bind(row.invite_id)] : []),
            ]);
          } catch (error) {
            pending = true;
            await env.DB.prepare("UPDATE crm_employee_onboarding SET compensation_state='LOCAL_STATUS_UPDATE_PENDING', last_error_code=?, updated_at=? WHERE id=?").bind(String(error?.message || 'IDENTITY_STATUS_UPDATE_FAILED').slice(0, 120), new Date().toISOString(), row.id).run().catch(() => {});
          }
          if (!pending) {
            try {
              await syncIdentityWorkforceStatus(env, { onboardingId: row.id, employeeId: row.workforce_employee_id, accountStatus: nextStatus }, requestId);
              await env.DB.prepare('UPDATE crm_employee_onboarding SET compensation_state=NULL, last_error_code=NULL, updated_at=? WHERE id=?').bind(new Date().toISOString(), row.id).run();
            } catch (error) {
              pending = true;
              await env.DB.prepare("UPDATE crm_employee_onboarding SET compensation_state='WORKFORCE_STATUS_PENDING', last_error_code=?, updated_at=? WHERE id=?").bind(String(error?.message || 'WORKFORCE_STATUS_SYNC_FAILED').slice(0, 120), new Date().toISOString(), row.id).run().catch(() => {});
            }
          }
        }
        if (pending) pendingIds.push(row.id);
        auditRows.push({ row, currentStatus, pending });
      }

      for (const { row, currentStatus, pending } of auditRows) {
        try {
          await appendAuditLog?.({
          env,
          actor: auth.user.username,
          role: auth.user.role,
          ip,
          userAgent,
          idempotencyKey: operationKey,
          action: 'EMPLOYEE_TEAM_BULK_STATUS_CHANGED',
          entity: 'EMPLOYEE_TEAM',
          entityId: row.id,
          unidade: normalizeAllowedUnits(row.units_json).join(','),
          before: { accountStatus: currentStatus },
          after: { accountStatus: nextStatus, bulk: true, pendingSync: pending },
          });
        } catch { }
      }

      const result = { ids, accountStatus: nextStatus, count: ids.length, pendingIds };
      const outcome = pendingIds.length ? 'PARTIAL' : 'COMPLETED';
      await env.DB.prepare(`INSERT INTO crm_team_operations (operation_key, operation_type, requested_status, member_ids_json, outcome, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(operationKey, 'BULK_STATUS', nextStatus, JSON.stringify(ids), outcome, JSON.stringify(result), at).run();
      await appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, idempotencyKey: operationKey, action: 'EMPLOYEE_TEAM_BULK_STATUS_CHANGED', entity: 'CRM_TEAM_OPERATION', entityId: operationKey, unidade: Array.from(new Set(rows.flatMap((row) => normalizeAllowedUnits(row.units_json)))).join(','), after: { accountStatus: nextStatus, count: ids.length, pendingCount: pendingIds.length, failClosed: pendingIds.length > 0 } });
      await recordTeamTelemetry({ env, eventName: 'EMPLOYEE_TEAM_BULK_STATUS_CHANGED', actorRole: auth.user.role, outcome, itemCount: ids.length, unitCount: new Set(rows.flatMap((row) => normalizeAllowedUnits(row.units_json))).size });
      if (pendingIds.length) return withCORS(JSON.stringify({ success: false, error: 'Alguns vínculos de acesso ficaram pendentes de sincronização', code: 'BULK_STATUS_SYNC_PENDING', data: result }), { status: 503 }, appOrigin);
      return withCORS(JSON.stringify({ success: true, data: result }), { status: 200 }, appOrigin);
    } catch (error) {
      return withCORS(JSON.stringify({ success: false, error: 'Não foi possível concluir a ação em lote', code: String(error?.message || 'BULK_STATUS_FAILED').slice(0, 120) }), { status: 503 }, appOrigin);
    }
  }

  const resendInviteMatch = url.pathname.match(/^\/admin\/team\/([^/]+)\/invite\/resend$/);
  if (resendInviteMatch && request.method === 'POST') {
    try {
      if (!onboardingHasSaga || !invitesHasInviteeEmail || !invitesHasUsername) return withCORS(JSON.stringify({ success: false, error: 'Migração de convites pendente', code: 'INVITE_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);
      const onboardingId = decodeURIComponent(resendInviteMatch[1] || '').trim();
      const onboarding = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=? LIMIT 1').bind(onboardingId).first();
      if (!onboarding) return withCORS(JSON.stringify({ success: false, error: 'Membro da equipe não encontrado', code: 'TEAM_MEMBER_NOT_FOUND' }), { status: 404 }, appOrigin);
      if (!teamUnitsVisible(auth, onboarding.units_json)) return withCORS(JSON.stringify({ success: false, error: 'Unidade fora do escopo do gestor', code: 'TEAM_UNITS_DENIED' }), { status: 403 }, appOrigin);
      const hierarchyDenied = canCreateEmployee({ actorRole: auth?.user?.role, actorAllowedUnits: auth?.user?.allowedUnits, targetProfile: onboarding.profile, units: normalizeAllowedUnits(onboarding.units_json) });
      if (hierarchyDenied) return withCORS(JSON.stringify({ success: false, error: 'Hierarquia não permite reenviar este convite', code: hierarchyDenied }), { status: 403 }, appOrigin);
      if (!['INVITED', 'PENDING_ACCESS'].includes(normalizeAccountState(onboarding.account_status))) return withCORS(JSON.stringify({ success: false, error: 'Somente convites pendentes podem ser reenviados', code: 'TEAM_INVITE_NOT_PENDING' }), { status: 409 }, appOrigin);

      const personalEmail = await decryptOnboardingToken(env, onboarding.personal_email_encrypted);
      if (!personalEmail) return withCORS(JSON.stringify({ success: false, error: 'E-mail pessoal indisponível para o convite', code: 'INVITEE_EMAIL_UNAVAILABLE' }), { status: 503 }, appOrigin);
      const now = new Date().toISOString();
      const requestId = String(request.headers.get('x-request-id') || `identity-invite-resend-${onboardingId}`).slice(0, 180);
      if (onboarding.invite_id) await env.DB.prepare(`UPDATE ${invitesTable} SET revoked=1 WHERE id=? AND uses_count=0`).bind(onboarding.invite_id).run();

      const token = randomInviteToken();
      const tokenHash = await sha256Hex(token);
      const inviteId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const units = normalizeAllowedUnits(onboarding.units_json);
      const modules = resolveEmployeeProfile(onboarding.profile, { unified: true })?.modules || ['ponto'];
      const columns = ['id', 'token_hash', 'token_hint', 'invitee_email', 'corporate_email', 'role', 'allowed_units_json', 'allowed_modules_json', 'max_uses', 'uses_count', 'expires_at', 'revoked', 'note', 'created_by', 'created_at', 'requested_username'];
      const values = [inviteId, tokenHash, `${token.slice(0, 4)}…${token.slice(-4)}`, personalEmail, onboarding.corporate_email, onboarding.profile, JSON.stringify(units), JSON.stringify(modules), 1, 0, expiresAt, 0, `Reenvio de onboarding ${onboarding.department_name || ''}`.trim(), String(auth?.user?.username || ''), now, onboarding.requested_username];
      await env.DB.prepare(`INSERT INTO ${invitesTable} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).bind(...values).run();
      const encryptedToken = await encryptOnboardingPii(env, token);
      await env.DB.prepare("UPDATE crm_employee_onboarding SET invite_id=?, invite_token_encrypted=?, account_status='INVITED', provisioning_state='INVITE_PENDING', compensation_state=NULL, last_error_code=NULL, updated_at=? WHERE id=?").bind(inviteId, encryptedToken, now, onboardingId).run();
      try {
        await sendAccountInviteEmail({ env, to: personalEmail, token, expiresAt, appUrl: String(env?.AUTH_INVITE_APP_URL || appOrigin) });
      } catch (error) {
        await env.DB.prepare(`UPDATE ${invitesTable} SET revoked=1 WHERE id=? AND uses_count=0`).bind(inviteId).run().catch(() => {});
        await env.DB.prepare("UPDATE crm_employee_onboarding SET account_status='PENDING_ACCESS', provisioning_state='FAILED', compensation_state='INVITE_DELIVERY_FAILED', last_error_code='EMAIL_DELIVERY_FAILED', updated_at=? WHERE id=?").bind(new Date().toISOString(), onboardingId).run().catch(() => {});
      await Promise.resolve(appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, action: 'EMPLOYEE_TEAM_INVITE_RESEND_FAILED', entity: 'EMPLOYEE_ONBOARDING', entityId: onboardingId, unidade: units.join(','), before: { accountStatus: onboarding.account_status }, after: { inviteRevoked: true, accountStatus: 'PENDING_ACCESS', requestId, failClosed: true } })).catch(() => {});
        return withCORS(JSON.stringify({ success: false, error: 'EMAIL_DELIVERY_FAILED', code: String(error?.message || 'EMAIL_DELIVERY_FAILED').slice(0, 120) }), { status: 503 }, appOrigin);
      }
      const updated = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=? LIMIT 1').bind(onboardingId).first();
      await appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, action: 'EMPLOYEE_TEAM_INVITE_RESENT', entity: 'EMPLOYEE_ONBOARDING', entityId: onboardingId, unidade: units.join(','), before: { accountStatus: onboarding.account_status }, after: { inviteIssued: true, inviteId, accountStatus: 'INVITED', requestId } });
      await recordTeamTelemetry({ env, eventName: 'EMPLOYEE_TEAM_INVITE_RESENT', actorRole: auth.user.role, itemCount: 1, unitCount: units.length });
      return withCORS(JSON.stringify({ success: true, data: publicOnboarding(updated) }), { status: 200 }, appOrigin);
    } catch (error) {
      return withCORS(JSON.stringify({ success: false, error: 'Não foi possível reenviar o convite', code: String(error?.message || 'TEAM_INVITE_RESEND_FAILED').slice(0, 120) }), { status: 503 }, appOrigin);
    }
  }

  const revokeInviteMatch = url.pathname.match(/^\/admin\/team\/([^/]+)\/invite\/revoke$/);
  if (revokeInviteMatch && request.method === 'POST') {
    try {
      if (!onboardingHasSaga) return withCORS(JSON.stringify({ success: false, error: 'Migração de convites pendente', code: 'INVITE_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);
      const onboardingId = decodeURIComponent(revokeInviteMatch[1] || '').trim();
      const onboarding = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=? LIMIT 1').bind(onboardingId).first();
      if (!onboarding) return withCORS(JSON.stringify({ success: false, error: 'Membro da equipe não encontrado', code: 'TEAM_MEMBER_NOT_FOUND' }), { status: 404 }, appOrigin);
      if (!teamUnitsVisible(auth, onboarding.units_json)) return withCORS(JSON.stringify({ success: false, error: 'Unidade fora do escopo do gestor', code: 'TEAM_UNITS_DENIED' }), { status: 403 }, appOrigin);
      const hierarchyDenied = canCreateEmployee({ actorRole: auth?.user?.role, actorAllowedUnits: auth?.user?.allowedUnits, targetProfile: onboarding.profile, units: normalizeAllowedUnits(onboarding.units_json) });
      if (hierarchyDenied) return withCORS(JSON.stringify({ success: false, error: 'Hierarquia não permite revogar este convite', code: hierarchyDenied }), { status: 403 }, appOrigin);
      if (!['INVITED', 'PENDING_ACCESS'].includes(normalizeAccountState(onboarding.account_status)) || !onboarding.invite_id) return withCORS(JSON.stringify({ success: false, error: 'Convite pendente não encontrado', code: 'TEAM_INVITE_NOT_PENDING' }), { status: 409 }, appOrigin);

      const now = new Date().toISOString();
      const requestId = String(request.headers.get('x-request-id') || `identity-invite-revoke-${onboardingId}`).slice(0, 180);
      await env.DB.prepare(`UPDATE ${invitesTable} SET revoked=1 WHERE id=? AND uses_count=0`).bind(onboarding.invite_id).run();
      await env.DB.prepare("UPDATE crm_employee_onboarding SET account_status='PENDING_ACCESS', provisioning_state='COMPLETED', compensation_state='WORKFORCE_STATUS_PENDING', updated_at=? WHERE id=?").bind(now, onboardingId).run();
      await env.DB.prepare(`UPDATE ${usersTable} SET ativo=0, session_version=COALESCE(session_version, 0)+1, updated_at=? WHERE username IN (SELECT crm_username FROM crm_employee_account_links WHERE onboarding_id=? AND review_status='CONFIRMED')`).bind(now, onboardingId).run().catch(() => {});
      try {
        await syncIdentityWorkforceStatus(env, { onboardingId, employeeId: onboarding.workforce_employee_id, accountStatus: 'PENDING_ACCESS' }, requestId);
      } catch (error) {
        await env.DB.prepare("UPDATE crm_employee_onboarding SET compensation_state='WORKFORCE_STATUS_PENDING', last_error_code=?, updated_at=? WHERE id=?").bind(String(error?.message || 'WORKFORCE_STATUS_SYNC_FAILED').slice(0, 120), new Date().toISOString(), onboardingId).run().catch(() => {});
        return withCORS(JSON.stringify({ success: false, error: 'ACCOUNT_STATUS_PENDING', code: String(error?.message || 'WORKFORCE_STATUS_SYNC_FAILED').slice(0, 120) }), { status: 503 }, appOrigin);
      }
      await env.DB.prepare('UPDATE crm_employee_onboarding SET compensation_state=NULL, last_error_code=NULL, updated_at=? WHERE id=?').bind(new Date().toISOString(), onboardingId).run();
      const updated = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=? LIMIT 1').bind(onboardingId).first();
      await appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, action: 'EMPLOYEE_TEAM_INVITE_REVOKED', entity: 'EMPLOYEE_ONBOARDING', entityId: onboardingId, unidade: normalizeAllowedUnits(onboarding.units_json).join(','), before: { accountStatus: onboarding.account_status }, after: { inviteRevoked: true, accountStatus: 'PENDING_ACCESS', requestId } });
      await recordTeamTelemetry({ env, eventName: 'EMPLOYEE_TEAM_INVITE_REVOKED', actorRole: auth.user.role, itemCount: 1, unitCount: normalizeAllowedUnits(onboarding.units_json).length });
      return withCORS(JSON.stringify({ success: true, data: publicOnboarding(updated) }), { status: 200 }, appOrigin);
    } catch (error) {
      return withCORS(JSON.stringify({ success: false, error: 'Não foi possível revogar o convite', code: String(error?.message || 'TEAM_INVITE_REVOKE_FAILED').slice(0, 120) }), { status: 503 }, appOrigin);
    }
  }

  const teamAccountLinkMatch = url.pathname.match(/^\/admin\/team\/([^/]+)\/account-link$/);
  const teamAccountLinkReviewMatch = url.pathname.match(/^\/admin\/team\/([^/]+)\/account-link\/([^/]+)\/review$/);
  if (teamAccountLinkReviewMatch && request.method === 'POST') {
    try {
      if (!teamTablesReady) return withCORS(JSON.stringify({ success: false, error: 'Migração da equipe unificada pendente', code: 'TEAM_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);
      const onboardingId = decodeURIComponent(teamAccountLinkReviewMatch[1] || '').trim();
      const linkId = decodeURIComponent(teamAccountLinkReviewMatch[2] || '').trim();
      const onboarding = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=? LIMIT 1').bind(onboardingId).first();
      if (!onboarding?.workforce_employee_id) return withCORS(JSON.stringify({ success: false, error: 'Membro da equipe sem identidade Workforce', code: 'ONBOARDING_STATUS_NOT_READY' }), { status: 409 }, appOrigin);
      if (!teamUnitsVisible(auth, onboarding.units_json)) return withCORS(JSON.stringify({ success: false, error: 'Unidade fora do escopo do gestor', code: 'TEAM_UNITS_DENIED' }), { status: 403 }, appOrigin);
      const hierarchyDenied = canCreateEmployee({ actorRole: auth?.user?.role, actorAllowedUnits: auth?.user?.allowedUnits, targetProfile: onboarding.profile, units: normalizeAllowedUnits(onboarding.units_json) });
      if (hierarchyDenied) return withCORS(JSON.stringify({ success: false, error: 'Hierarquia não permite revisar o vínculo da conta', code: hierarchyDenied }), { status: 403 }, appOrigin);

      const body = await request.json().catch(() => ({}));
      const nextStatus = String(body.reviewStatus || body.review_status || '').trim().toUpperCase();
      const reason = String(body.reason || body.reviewNote || body.review_note || '').trim().replace(/\s+/g, ' ').slice(0, 500);
      if (!['PENDING_REVIEW', 'CONFIRMED', 'REJECTED'].includes(nextStatus)) {
        return withCORS(JSON.stringify({ success: false, error: 'Revisão do vínculo da conta inválida', code: 'CRM_ACCOUNT_LINK_REVIEW_INVALID' }), { status: 400 }, appOrigin);
      }
      if (nextStatus === 'REJECTED' && reason.length < 5) {
        return withCORS(JSON.stringify({ success: false, error: 'A rejeição exige um motivo', code: 'CRM_ACCOUNT_LINK_REJECTION_REASON_REQUIRED' }), { status: 400 }, appOrigin);
      }
      const link = await env.DB.prepare('SELECT * FROM crm_employee_account_links WHERE id=? AND onboarding_id=? AND workforce_employee_id=? LIMIT 1').bind(linkId, onboardingId, onboarding.workforce_employee_id).first();
      if (!link) return withCORS(JSON.stringify({ success: false, error: 'Vínculo da conta não encontrado para este membro', code: 'CRM_ACCOUNT_LINK_NOT_FOUND' }), { status: 404 }, appOrigin);
      const currentStatus = String(link.review_status || 'PENDING_REVIEW').trim().toUpperCase();
      if (currentStatus === 'CONFIRMED' && nextStatus !== 'CONFIRMED') {
        return withCORS(JSON.stringify({ success: false, error: 'Um vínculo de conta confirmado não pode ser rebaixado neste fluxo', code: 'CRM_ACCOUNT_LINK_CONFIRMED_IMMUTABLE' }), { status: 409 }, appOrigin);
      }
      if (currentStatus === nextStatus) return withCORS(JSON.stringify({ success: true, data: publicAccountLink(link), replayed: true }), { status: 200 }, appOrigin);
      if (nextStatus === 'CONFIRMED') {
        const user = await env.DB.prepare(`SELECT username FROM ${usersTable} WHERE LOWER(username)=LOWER(?) LIMIT 1`).bind(link.crm_username).first();
        if (!user?.username) return withCORS(JSON.stringify({ success: false, error: 'A conta CRM informada não existe mais', code: 'CRM_ACCOUNT_NOT_FOUND' }), { status: 404 }, appOrigin);
        const conflict = await env.DB.prepare('SELECT id FROM crm_employee_account_links WHERE LOWER(crm_username)=LOWER(?) AND id<>? LIMIT 1').bind(link.crm_username, linkId).first();
        if (conflict?.id) return withCORS(JSON.stringify({ success: false, error: 'A conta CRM já está vinculada a outro funcionário', code: 'CRM_ACCOUNT_LINK_CONFLICT' }), { status: 409 }, appOrigin);
      }
      const at = new Date().toISOString();
      const reviewUpdate = await env.DB.prepare(`UPDATE crm_employee_account_links
        SET review_status=?, review_note=?, reviewed_by=?, reviewed_at=?, updated_at=?
        WHERE id=? AND onboarding_id=? AND review_status=?`).bind(
        nextStatus,
        reason || null,
        String(auth?.user?.username || ''),
        at,
        at,
        linkId,
        onboardingId,
        currentStatus,
      ).run();
      if (!Number(reviewUpdate?.meta?.changes || 0)) {
        const raced = await env.DB.prepare('SELECT * FROM crm_employee_account_links WHERE id=? AND onboarding_id=? LIMIT 1').bind(linkId, onboardingId).first();
        if (String(raced?.review_status || '').toUpperCase() === nextStatus) return withCORS(JSON.stringify({ success: true, data: publicAccountLink(raced), replayed: true }), { status: 200 }, appOrigin);
        return withCORS(JSON.stringify({ success: false, error: 'O vínculo da conta foi alterado por outra revisão', code: 'CRM_ACCOUNT_LINK_REVIEW_CONFLICT' }), { status: 409 }, appOrigin);
      }
      await appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, action: 'EMPLOYEE_CRM_ACCOUNT_LINK_REVIEWED', entity: 'EMPLOYEE_CRM_ACCOUNT_LINK', entityId: linkId, unidade: normalizeAllowedUnits(onboarding.units_json).join(','), before: { reviewStatus: currentStatus, crmUsername: link.crm_username }, after: { onboardingId, workforceEmployeeId: onboarding.workforce_employee_id, crmUsername: link.crm_username, reviewStatus: nextStatus, reason: reason || null } });
      await recordTeamTelemetry({ env, eventName: 'EMPLOYEE_CRM_ACCOUNT_LINK_REVIEWED', actorRole: auth.user.role, outcome: nextStatus, itemCount: 1, unitCount: normalizeAllowedUnits(onboarding.units_json).length });
      const reviewed = await env.DB.prepare('SELECT * FROM crm_employee_account_links WHERE id=?').bind(linkId).first();
      return withCORS(JSON.stringify({ success: true, data: publicAccountLink(reviewed) }), { status: 200 }, appOrigin);
    } catch (error) {
      const code = String(error?.message || 'CRM_ACCOUNT_LINK_REVIEW_FAILED').slice(0, 120);
      const status = /UNIQUE|CONSTRAINT|IMMUTABLE|CONFLICT|REQUIRED|INVALID/.test(code) ? 409 : 503;
      return withCORS(JSON.stringify({ success: false, error: 'Não foi possível atualizar a revisão do vínculo da conta', code }), { status }, appOrigin);
    }
  }
  if (teamAccountLinkMatch && (request.method === 'GET' || request.method === 'POST')) {
    try {
      if (!teamTablesReady) return withCORS(JSON.stringify({ success: false, error: 'Migração da equipe unificada pendente', code: 'TEAM_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);
      const onboardingId = decodeURIComponent(teamAccountLinkMatch[1] || '').trim();
      const onboarding = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=? LIMIT 1').bind(onboardingId).first();
      if (!onboarding) return withCORS(JSON.stringify({ success: false, error: 'Membro da equipe não encontrado', code: 'TEAM_MEMBER_NOT_FOUND' }), { status: 404 }, appOrigin);
      if (!teamUnitsVisible(auth, onboarding.units_json)) return withCORS(JSON.stringify({ success: false, error: 'Unidade fora do escopo do gestor', code: 'TEAM_UNITS_DENIED' }), { status: 403 }, appOrigin);
      const existing = await env.DB.prepare('SELECT * FROM crm_employee_account_links WHERE onboarding_id=? LIMIT 1').bind(onboardingId).first();
      if (request.method === 'GET') return withCORS(JSON.stringify({ success: true, data: publicAccountLink(existing) }), { status: 200 }, appOrigin);

      const hierarchyDenied = canCreateEmployee({ actorRole: auth?.user?.role, actorAllowedUnits: auth?.user?.allowedUnits, targetProfile: onboarding.profile, units: normalizeAllowedUnits(onboarding.units_json) });
      if (hierarchyDenied) return withCORS(JSON.stringify({ success: false, error: 'Hierarquia não permite propor o vínculo da conta', code: hierarchyDenied }), { status: 403 }, appOrigin);
      if (!onboarding.workforce_employee_id) return withCORS(JSON.stringify({ success: false, error: 'Membro ainda não possui identidade Workforce', code: 'ONBOARDING_STATUS_NOT_READY' }), { status: 409 }, appOrigin);
      const body = await request.json().catch(() => ({}));
      const crmUsername = normalizeCrmUsername(body.crmUsername || body.crm_username || body.username);
      if (!crmUsername || !validateUsername(crmUsername)) return withCORS(JSON.stringify({ success: false, error: 'Informe o nome de usuário exato da conta CRM', code: 'CRM_ACCOUNT_USERNAME_INVALID' }), { status: 400 }, appOrigin);
      const crmUser = await env.DB.prepare(`SELECT username FROM ${usersTable} WHERE LOWER(username)=LOWER(?) LIMIT 1`).bind(crmUsername).first();
      if (!crmUser?.username) return withCORS(JSON.stringify({ success: false, error: 'A conta CRM informada não existe', code: 'CRM_ACCOUNT_NOT_FOUND' }), { status: 404 }, appOrigin);
      const conflict = await env.DB.prepare('SELECT id FROM crm_employee_account_links WHERE LOWER(crm_username)=LOWER(?) AND onboarding_id<>? LIMIT 1').bind(crmUsername, onboardingId).first();
      if (conflict?.id) return withCORS(JSON.stringify({ success: false, error: 'A conta CRM já está vinculada a outro funcionário', code: 'CRM_ACCOUNT_LINK_CONFLICT' }), { status: 409 }, appOrigin);
      if (existing) {
        const currentStatus = String(existing.review_status || '').trim().toUpperCase();
        if (currentStatus === 'CONFIRMED') {
          if (normalizeCrmUsername(existing.crm_username) === crmUsername) return withCORS(JSON.stringify({ success: true, data: publicAccountLink(existing), replayed: true }), { status: 200 }, appOrigin);
          return withCORS(JSON.stringify({ success: false, error: 'O vínculo confirmado não pode ser substituído neste fluxo', code: 'CRM_ACCOUNT_LINK_CONFIRMED_IMMUTABLE' }), { status: 409 }, appOrigin);
        }
        if (currentStatus === 'PENDING_REVIEW') {
          if (normalizeCrmUsername(existing.crm_username) === crmUsername) return withCORS(JSON.stringify({ success: true, data: publicAccountLink(existing), replayed: true }), { status: 200 }, appOrigin);
          return withCORS(JSON.stringify({ success: false, error: 'Já existe uma proposta de vínculo pendente para este membro', code: 'CRM_ACCOUNT_LINK_REVIEW_PENDING' }), { status: 409 }, appOrigin);
        }
      }
      const at = new Date().toISOString();
      const linkId = existing?.id || crypto.randomUUID();
      if (existing) {
        await env.DB.prepare(`UPDATE crm_employee_account_links
          SET crm_username=?, link_method='EXPLICIT_CRM_USERNAME', review_status='PENDING_REVIEW', review_note=NULL, reviewed_by=NULL, reviewed_at=NULL, updated_at=?
          WHERE id=? AND onboarding_id=? AND review_status='REJECTED'`).bind(crmUsername, at, linkId, onboardingId).run();
      } else {
        await env.DB.prepare(`INSERT INTO crm_employee_account_links
          (id, workforce_employee_id, onboarding_id, crm_username, link_method, review_status, review_note, reviewed_by, reviewed_at, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'EXPLICIT_CRM_USERNAME', 'PENDING_REVIEW', NULL, NULL, NULL, ?, ?, ?)`).bind(
          linkId,
          onboarding.workforce_employee_id,
          onboardingId,
          crmUsername,
          String(auth?.user?.username || ''),
          at,
          at,
        ).run();
      }
      const created = await env.DB.prepare('SELECT * FROM crm_employee_account_links WHERE id=?').bind(linkId).first();
      await appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, action: 'EMPLOYEE_CRM_ACCOUNT_LINK_PROPOSED', entity: 'EMPLOYEE_CRM_ACCOUNT_LINK', entityId: linkId, unidade: normalizeAllowedUnits(onboarding.units_json).join(','), after: { onboardingId, workforceEmployeeId: onboarding.workforce_employee_id, crmUsername, reviewStatus: 'PENDING_REVIEW', linkMethod: 'EXPLICIT_CRM_USERNAME' } });
      await recordTeamTelemetry({ env, eventName: 'EMPLOYEE_CRM_ACCOUNT_LINK_PROPOSED', actorRole: auth.user.role, outcome: 'PENDING_REVIEW', itemCount: 1, unitCount: normalizeAllowedUnits(onboarding.units_json).length });
      return withCORS(JSON.stringify({ success: true, data: publicAccountLink(created) }), { status: existing ? 200 : 201 }, appOrigin);
    } catch (error) {
      const code = String(error?.message || 'CRM_ACCOUNT_LINK_FAILED').slice(0, 120);
      const status = /UNIQUE|CONSTRAINT|CONFLICT|INVALID/.test(code) ? 409 : 503;
      return withCORS(JSON.stringify({ success: false, error: 'Não foi possível registrar o vínculo da conta CRM', code }), { status }, appOrigin);
    }
  }

  const teamLinksMatch = url.pathname.match(/^\/admin\/team\/([^/]+)\/links$/);
  const teamLinkReviewMatch = url.pathname.match(/^\/admin\/team\/([^/]+)\/links\/([^/]+)\/review$/);
  if (teamLinkReviewMatch && request.method === 'POST') {
    try {
      if (!teamTablesReady) return withCORS(JSON.stringify({ success: false, error: 'Migração da equipe unificada pendente', code: 'TEAM_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);
      const onboardingId = decodeURIComponent(teamLinkReviewMatch[1] || '').trim();
      const linkId = decodeURIComponent(teamLinkReviewMatch[2] || '').trim();
      const onboarding = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=? LIMIT 1').bind(onboardingId).first();
      if (!onboarding) return withCORS(JSON.stringify({ success: false, error: 'Membro da equipe não encontrado', code: 'TEAM_MEMBER_NOT_FOUND' }), { status: 404 }, appOrigin);
      if (!teamUnitsVisible(auth, onboarding.units_json)) return withCORS(JSON.stringify({ success: false, error: 'Unidade fora do escopo do gestor', code: 'TEAM_UNITS_DENIED' }), { status: 403 }, appOrigin);
      const hierarchyDenied = canCreateEmployee({ actorRole: auth?.user?.role, actorAllowedUnits: auth?.user?.allowedUnits, targetProfile: onboarding.profile, units: normalizeAllowedUnits(onboarding.units_json) });
      if (hierarchyDenied) return withCORS(JSON.stringify({ success: false, error: 'Hierarquia não permite revisar este vínculo', code: hierarchyDenied }), { status: 403 }, appOrigin);

      const body = await request.json().catch(() => ({}));
      const nextStatus = String(body.reviewStatus || body.review_status || '').trim().toUpperCase();
      const confidence = String(body.confidence || '').trim().toUpperCase();
      const reason = String(body.reason || '').trim().replace(/\s+/g, ' ').slice(0, 500);
      if (!['PENDING_REVIEW', 'CONFIRMED', 'REJECTED'].includes(nextStatus) || (confidence && !['HIGH', 'MEDIUM', 'LOW'].includes(confidence))) {
        return withCORS(JSON.stringify({ success: false, error: 'Revisão do vínculo inválida', code: 'TEAM_LINK_REVIEW_INVALID' }), { status: 400 }, appOrigin);
      }
      if (nextStatus === 'REJECTED' && reason.length < 5) {
        return withCORS(JSON.stringify({ success: false, error: 'A rejeição exige um motivo', code: 'TEAM_LINK_REJECTION_REASON_REQUIRED' }), { status: 400 }, appOrigin);
      }
      const link = await env.DB.prepare('SELECT * FROM crm_employee_identity_links WHERE id=? AND workforce_employee_id=? LIMIT 1').bind(linkId, onboarding.workforce_employee_id).first();
      if (!link) return withCORS(JSON.stringify({ success: false, error: 'Vínculo não encontrado para este membro', code: 'TEAM_LINK_NOT_FOUND' }), { status: 404 }, appOrigin);
      const currentStatus = String(link.review_status || 'PENDING_REVIEW').trim().toUpperCase();
      if (currentStatus === 'CONFIRMED' && nextStatus !== 'CONFIRMED') {
        return withCORS(JSON.stringify({ success: false, error: 'Um vínculo confirmado não pode ser rebaixado neste fluxo', code: 'TEAM_LINK_CONFIRMED_IMMUTABLE' }), { status: 409 }, appOrigin);
      }
      if (currentStatus === nextStatus) {
        return withCORS(JSON.stringify({ success: true, data: publicIdentityLink(link), replayed: true }), { status: 200 }, appOrigin);
      }
      const at = new Date().toISOString();
      const metadata = safeJsonParse(link.metadata_json, {});
      const nextMetadata = {
        ...metadata,
        review: {
          status: nextStatus,
          reviewedAt: at,
          reviewedBy: String(auth?.user?.username || ''),
          reasonProvided: Boolean(reason),
        },
      };
      const reviewUpdate = await env.DB.prepare('UPDATE crm_employee_identity_links SET review_status=?, confidence=?, metadata_json=? WHERE id=? AND review_status=?').bind(
        nextStatus,
        confidence || link.confidence,
        JSON.stringify(nextMetadata),
        linkId,
        currentStatus,
      ).run();
      if (!Number(reviewUpdate?.meta?.changes || 0)) {
        const raced = await env.DB.prepare('SELECT * FROM crm_employee_identity_links WHERE id=? AND workforce_employee_id=? LIMIT 1').bind(linkId, onboarding.workforce_employee_id).first();
        if (String(raced?.review_status || '').toUpperCase() === nextStatus) {
          return withCORS(JSON.stringify({ success: true, data: publicIdentityLink(raced), replayed: true }), { status: 200 }, appOrigin);
        }
        return withCORS(JSON.stringify({ success: false, error: 'O vínculo foi alterado por outra revisão', code: 'TEAM_LINK_REVIEW_CONFLICT' }), { status: 409 }, appOrigin);
      }
      if (nextStatus === 'CONFIRMED' && String(link.source || '').toUpperCase() === 'ESCALA') {
        await env.DB.prepare('UPDATE crm_employee_team SET schedule_professional_id=?, updated_at=? WHERE onboarding_id=?').bind(link.source_id, at, onboardingId).run();
      }
      await appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, action: 'EMPLOYEE_IDENTITY_LINK_REVIEWED', entity: 'EMPLOYEE_IDENTITY_LINK', entityId: linkId, unidade: normalizeAllowedUnits(onboarding.units_json).join(','), before: { reviewStatus: currentStatus, confidence: link.confidence }, after: { onboardingId, source: link.source, sourceId: link.source_id, reviewStatus: nextStatus, confidence: confidence || link.confidence, reason: reason || null } });
      await recordTeamTelemetry({ env, eventName: 'EMPLOYEE_IDENTITY_LINK_REVIEWED', actorRole: auth.user.role, outcome: nextStatus, itemCount: 1, unitCount: normalizeAllowedUnits(onboarding.units_json).length });
      const reviewed = await env.DB.prepare('SELECT * FROM crm_employee_identity_links WHERE id=?').bind(linkId).first();
      return withCORS(JSON.stringify({ success: true, data: publicIdentityLink(reviewed) }), { status: 200 }, appOrigin);
    } catch (error) {
      const code = String(error?.message || 'TEAM_LINK_REVIEW_FAILED').slice(0, 120);
      const status = /UNIQUE|CONSTRAINT|IMMUTABLE|CONFLICT|REQUIRED|INVALID/.test(code) ? 409 : 503;
      return withCORS(JSON.stringify({ success: false, error: 'Não foi possível atualizar a revisão do vínculo', code }), { status }, appOrigin);
    }
  }
  if (teamLinksMatch && (request.method === 'GET' || request.method === 'POST')) {
    try {
      const onboardingId = decodeURIComponent(teamLinksMatch[1] || '').trim();
      const onboarding = await env.DB.prepare('SELECT * FROM crm_employee_onboarding WHERE id=? LIMIT 1').bind(onboardingId).first();
      if (!onboarding) return withCORS(JSON.stringify({ success: false, error: 'Membro da equipe não encontrado', code: 'TEAM_MEMBER_NOT_FOUND' }), { status: 404 }, appOrigin);
      if (!teamUnitsVisible(auth, onboarding.units_json)) return withCORS(JSON.stringify({ success: false, error: 'Unidade fora do escopo do gestor', code: 'TEAM_UNITS_DENIED' }), { status: 403 }, appOrigin);
      if (request.method === 'GET') {
        const links = await env.DB.prepare('SELECT * FROM crm_employee_identity_links WHERE workforce_employee_id=? ORDER BY created_at DESC').bind(onboarding.workforce_employee_id).all();
        return withCORS(JSON.stringify({ success: true, data: (links?.results || []).map(publicIdentityLink) }), { status: 200 }, appOrigin);
      }

      const hierarchyDenied = canCreateEmployee({ actorRole: auth?.user?.role, actorAllowedUnits: auth?.user?.allowedUnits, targetProfile: onboarding.profile, units: normalizeAllowedUnits(onboarding.units_json) });
      if (hierarchyDenied) return withCORS(JSON.stringify({ success: false, error: 'Hierarquia não permite alterar este vínculo', code: hierarchyDenied }), { status: 403 }, appOrigin);

      const body = await request.json().catch(() => ({}));
      const source = String(body.source || '').trim().toUpperCase();
      const sourceId = String(body.sourceId || body.source_id || '').trim().slice(0, 160);
      const matchMethod = String(body.matchMethod || body.match_method || 'EXPLICIT_WORKFORCE_ID').trim().toUpperCase();
      const confidence = String(body.confidence || 'HIGH').trim().toUpperCase();
      const reviewStatus = String(body.reviewStatus || 'PENDING_REVIEW').trim().toUpperCase();
      const reviewReason = String(body.reason || body.reviewReason || '').trim().slice(0, 500);
      if (!['ESCALA', 'ATENDIMENTO'].includes(source) || !sourceId || ['NAME', 'NAME_ONLY', 'SIMILAR_NAME'].includes(matchMethod)) {
        return withCORS(JSON.stringify({ success: false, error: 'Vínculo exige identificador explícito; nome não é suficiente', code: 'TEAM_LINK_EXPLICIT_ID_REQUIRED' }), { status: 400 }, appOrigin);
      }
      if (!['PENDING_REVIEW', 'CONFIRMED', 'REJECTED'].includes(reviewStatus) || !['HIGH', 'MEDIUM', 'LOW'].includes(confidence)) {
        return withCORS(JSON.stringify({ success: false, error: 'Estado de revisão do vínculo inválido', code: 'TEAM_LINK_REVIEW_INVALID' }), { status: 400 }, appOrigin);
      }
      if (reviewStatus === 'REJECTED' && reviewReason.length < 5) {
        return withCORS(JSON.stringify({ success: false, error: 'A rejeição exige um motivo', code: 'TEAM_LINK_REJECTION_REASON_REQUIRED' }), { status: 400 }, appOrigin);
      }
      const bySource = await env.DB.prepare('SELECT * FROM crm_employee_identity_links WHERE source=? AND source_id=? LIMIT 1').bind(source, sourceId).first();
      if (bySource && bySource.workforce_employee_id !== onboarding.workforce_employee_id) {
        return withCORS(JSON.stringify({ success: false, error: 'Este identificador já está vinculado a outro funcionário', code: 'TEAM_LINK_CONFLICT' }), { status: 409 }, appOrigin);
      }
      const byEmployee = await env.DB.prepare('SELECT * FROM crm_employee_identity_links WHERE workforce_employee_id=? AND source=? LIMIT 1').bind(onboarding.workforce_employee_id, source).first();
      if (byEmployee) {
        return withCORS(JSON.stringify({ success: true, data: publicIdentityLink(byEmployee), replayed: true }), { status: 200 }, appOrigin);
      }
      const at = new Date().toISOString();
      const linkId = crypto.randomUUID();
      const metadata = { explicit: true, onboardingId };
      if (reviewStatus === 'REJECTED') metadata.review = { status: reviewStatus, reason: reviewReason, reviewedAt: at, reviewedBy: String(auth?.user?.username || '') };
      await env.DB.prepare(`INSERT INTO crm_employee_identity_links
        (id, workforce_employee_id, source, source_id, match_method, confidence, review_status, metadata_json, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        linkId, onboarding.workforce_employee_id, source, sourceId, matchMethod, confidence, reviewStatus,
        JSON.stringify(metadata), String(auth?.user?.username || ''), at,
      ).run();
      if (source === 'ESCALA' && reviewStatus === 'CONFIRMED') {
        await env.DB.prepare('UPDATE crm_employee_team SET schedule_professional_id=?, updated_at=? WHERE onboarding_id=?').bind(sourceId, at, onboardingId).run();
      }
      await appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, action: 'EMPLOYEE_IDENTITY_LINK_CREATED', entity: 'EMPLOYEE_IDENTITY_LINK', entityId: linkId, unidade: normalizeAllowedUnits(onboarding.units_json).join(','), after: { onboardingId, source, sourceId, workforceEmployeeId: onboarding.workforce_employee_id, matchMethod, confidence, reviewStatus } });
      await recordTeamTelemetry({ env, eventName: 'EMPLOYEE_IDENTITY_LINK_CREATED', actorRole: auth.user.role, itemCount: 1, unitCount: normalizeAllowedUnits(onboarding.units_json).length });
      const createdLink = await env.DB.prepare('SELECT * FROM crm_employee_identity_links WHERE id=?').bind(linkId).first();
      return withCORS(JSON.stringify({ success: true, data: publicIdentityLink(createdLink) }), { status: 201 }, appOrigin);
    } catch (error) {
      return withCORS(JSON.stringify({ success: false, error: 'Não foi possível registrar o vínculo', code: String(error?.message || 'TEAM_LINK_FAILED').slice(0, 120) }), { status: 500 }, appOrigin);
    }
  }

  const teamScheduleSyncMatch = url.pathname.match(/^\/admin\/team\/([^/]+)\/schedule-sync$/);
  if (teamScheduleSyncMatch && request.method === 'POST') {
    try {
      if (!teamTablesReady) return withCORS(JSON.stringify({ success: false, error: 'Migração da equipe unificada pendente', code: 'TEAM_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);
      const onboardingId = decodeURIComponent(teamScheduleSyncMatch[1] || '').trim();
      const onboarding = await env.DB.prepare(`SELECT o.*, t.schedule_professional_id
        FROM crm_employee_onboarding o LEFT JOIN crm_employee_team t ON t.onboarding_id=o.id
        WHERE o.id=? LIMIT 1`).bind(onboardingId).first();
      if (!onboarding) return withCORS(JSON.stringify({ success: false, error: 'Membro da equipe não encontrado', code: 'TEAM_MEMBER_NOT_FOUND' }), { status: 404 }, appOrigin);
      if (!teamUnitsVisible(auth, onboarding.units_json)) return withCORS(JSON.stringify({ success: false, error: 'Unidade fora do escopo do gestor', code: 'TEAM_UNITS_DENIED' }), { status: 403 }, appOrigin);
      const hierarchyDenied = canCreateEmployee({ actorRole: auth?.user?.role, actorAllowedUnits: auth?.user?.allowedUnits, targetProfile: onboarding.profile, units: normalizeAllowedUnits(onboarding.units_json) });
      if (hierarchyDenied) return withCORS(JSON.stringify({ success: false, error: 'Hierarquia não permite sincronizar este membro', code: hierarchyDenied }), { status: 403 }, appOrigin);

      const body = await request.json().catch(() => ({}));
      const rawState = String(body?.state ?? body?.status ?? '').trim().toUpperCase();
      if (!SCHEDULE_SYNC_STATES.includes(rawState)) {
        return withCORS(JSON.stringify({ success: false, error: 'Estado de sincronização inválido', code: 'ESCALA_SYNC_STATE_INVALID' }), { status: 400 }, appOrigin);
      }
      const professionalId = String(body?.professionalId ?? body?.professional_id ?? '').trim().slice(0, 160);
      if (rawState === 'SYNCED' && !professionalId) {
        return withCORS(JSON.stringify({ success: false, error: 'A sincronização concluída precisa do identificador da Escala', code: 'ESCALA_PROFESSIONAL_ID_REQUIRED' }), { status: 400 }, appOrigin);
      }
      if (rawState === 'NOT_CONFIGURED' && (professionalId || String(onboarding.schedule_professional_id || '').trim())) {
        return withCORS(JSON.stringify({ success: false, error: 'Um vínculo configurado não pode ser marcado como não configurado', code: 'ESCALA_SYNC_STATE_CONFLICT' }), { status: 409 }, appOrigin);
      }
      const errorCode = normalizeScheduleSyncErrorCode(body?.errorCode ?? body?.error_code, rawState === 'BLOCKED' ? 'ESCALA_SYNC_BLOCKED' : rawState === 'FAILED' ? 'ESCALA_SYNC_FAILED' : '');
      if (['FAILED', 'BLOCKED'].includes(rawState) && !errorCode) {
        return withCORS(JSON.stringify({ success: false, error: 'A falha precisa de um código operacional', code: 'ESCALA_SYNC_ERROR_CODE_REQUIRED' }), { status: 400 }, appOrigin);
      }

      if (rawState === 'SYNCED') {
        const link = await env.DB.prepare(`SELECT id FROM crm_employee_identity_links
          WHERE workforce_employee_id=? AND source='ESCALA' AND source_id=? AND review_status='CONFIRMED' LIMIT 1`)
          .bind(onboarding.workforce_employee_id, professionalId).first();
        if (!link) return withCORS(JSON.stringify({ success: false, error: 'Confirme primeiro o vínculo explícito com a Escala', code: 'TEAM_ESCALA_LINK_REQUIRED' }), { status: 409 }, appOrigin);
      }

      const rawOperationKey = request.headers.get('idempotency-key') || body?.operationKey || body?.requestId || '';
      const operationKey = normalizeScheduleSyncOperationKey(rawOperationKey);
      if (!operationKey) return withCORS(JSON.stringify({ success: false, error: 'A sincronização exige uma chave de idempotência', code: 'ESCALA_SYNC_IDEMPOTENCY_REQUIRED' }), { status: 400 }, appOrigin);
      const persisted = await persistScheduleSyncOperation({ env, onboardingId, state: rawState, professionalId, errorCode, operationKey });
      if (rawState === 'SYNCED' && professionalId) {
        await env.DB.prepare('UPDATE crm_employee_team SET schedule_professional_id=?, updated_at=? WHERE onboarding_id=?').bind(professionalId, new Date().toISOString(), onboardingId).run();
      }
      if (persisted.replayed) {
        return withCORS(JSON.stringify({ success: true, replayed: true, data: { scheduleSync: publicScheduleSync(persisted.scheduleSync, professionalId) } }), { status: 200 }, appOrigin);
      }
      const units = normalizeAllowedUnits(onboarding.units_json);
      await appendAuditLog?.({
        env,
        actor: auth.user.username,
        role: auth.user.role,
        ip,
        userAgent,
        idempotencyKey: operationKey,
        action: 'EMPLOYEE_ESCALA_SYNC_RECORDED',
        entity: 'EMPLOYEE_TEAM',
        entityId: onboardingId,
        unidade: units.join(','),
        after: { scheduleSyncState: rawState, professionalId: professionalId || null, errorCode: errorCode || null, attempt: persisted.scheduleSync?.attempt || 0 },
      });
      await recordTeamTelemetry({ env, eventName: 'EMPLOYEE_ESCALA_SYNC_RECORDED', actorRole: auth.user.role, outcome: rawState, itemCount: 1, unitCount: units.length });
      return withCORS(JSON.stringify({ success: true, replayed: persisted.replayed, data: { scheduleSync: publicScheduleSync(persisted.scheduleSync, professionalId) } }), { status: 200 }, appOrigin);
    } catch (error) {
      const rawCode = String(error?.message || '').trim();
      const conflict = ['ESCALA_SYNC_IDEMPOTENCY_CONFLICT', 'ESCALA_SYNC_STATE_CONFLICT', 'TEAM_ESCALA_LINK_REQUIRED'].includes(rawCode);
      const status = conflict ? 409 : 503;
      return withCORS(JSON.stringify({ success: false, error: conflict ? 'A sincronização não pôde ser registrada para este estado' : 'Não foi possível registrar o estado da Escala', code: conflict ? rawCode : 'ESCALA_SYNC_PERSIST_FAILED' }), { status }, appOrigin);
    }
  }

  const teamHistoryMatch = url.pathname.match(/^\/admin\/team\/([^/]+)\/history$/);
  if (teamHistoryMatch && request.method === 'GET') {
    try {
      const onboardingId = decodeURIComponent(teamHistoryMatch[1] || '').trim();
      const onboarding = await env.DB.prepare('SELECT id, units_json FROM crm_employee_onboarding WHERE id=? LIMIT 1').bind(onboardingId).first();
      if (!onboarding) return withCORS(JSON.stringify({ success: false, error: 'Membro da equipe não encontrado', code: 'TEAM_MEMBER_NOT_FOUND' }), { status: 404 }, appOrigin);
      if (!teamUnitsVisible(auth, onboarding.units_json)) return withCORS(JSON.stringify({ success: false, error: 'Unidade fora do escopo do gestor', code: 'TEAM_UNITS_DENIED' }), { status: 403 }, appOrigin);

      const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
      const rows = await env.DB.prepare(`
        SELECT id, ts, actor, role, action, entity, entity_id, unidade, idempotency_key, before_json, after_json
        FROM audit_log
        WHERE (entity_id=? AND entity IN ('EMPLOYEE_ONBOARDING', 'EMPLOYEE_TEAM'))
           OR (entity='EMPLOYEE_IDENTITY_LINK' AND after_json LIKE ?)
           OR (entity='EMPLOYEE_CRM_ACCOUNT_LINK' AND after_json LIKE ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
      `).bind(onboardingId, `%\"onboardingId\":\"${onboardingId}\"%`, `%\"onboardingId\":\"${onboardingId}\"%`, limit).all();
      const data = (rows?.results || []).map(publicTeamAudit);
      return withCORS(JSON.stringify({ success: true, data, summary: { count: data.length, limit } }), { status: 200 }, appOrigin);
    } catch {
      return withCORS(JSON.stringify({ success: false, error: 'TEAM_HISTORY_UNAVAILABLE', code: 'TEAM_HISTORY_UNAVAILABLE' }), { status: 503 }, appOrigin);
    }
  }

  const teamMemberMatch = url.pathname.match(/^\/admin\/team\/([^/]+)$/);
  if (teamMemberMatch && request.method === 'PUT') {
    let onboardingId = '';
    let current = null;
    let workforceSynchronized = false;
    let localPersistenceStage = 'PREPARATION';
    try {
      onboardingId = decodeURIComponent(teamMemberMatch[1] || '').trim();
      current = await env.DB.prepare(`SELECT o.*, t.schedule_professional_id, t.schedule_status, t.schedule_role, t.schedule_shift, t.schedule_nickname, t.schedule_instagram, t.schedule_color, t.units_json AS schedule_units_json, a.id AS crm_account_link_id, a.crm_username AS crm_account_username, a.review_status AS crm_account_review_status
        FROM crm_employee_onboarding o LEFT JOIN crm_employee_team t ON t.onboarding_id=o.id
        LEFT JOIN crm_employee_account_links a ON a.onboarding_id=o.id WHERE o.id=? LIMIT 1`).bind(onboardingId).first();
      if (!current) return withCORS(JSON.stringify({ success: false, error: 'Membro da equipe não encontrado', code: 'TEAM_MEMBER_NOT_FOUND' }), { status: 404 }, appOrigin);
      if (!teamUnitsVisible(auth, current.units_json)) return withCORS(JSON.stringify({ success: false, error: 'Unidade fora do escopo do gestor', code: 'TEAM_UNITS_DENIED' }), { status: 403 }, appOrigin);

      const body = await request.json().catch(() => ({}));
      const immutableUsername = body.username ?? body.requestedUsername;
      if (immutableUsername !== undefined && String(immutableUsername).trim().toLowerCase() !== String(current.requested_username || '').trim().toLowerCase()) {
        return withCORS(JSON.stringify({ success: false, error: 'O nome de usuário não pode ser trocado depois do convite', code: 'TEAM_USERNAME_IMMUTABLE' }), { status: 409 }, appOrigin);
      }
      if (body.corporateEmail !== undefined && String(body.corporateEmail).trim().toLowerCase() !== String(current.corporate_email || '').trim().toLowerCase()) {
        return withCORS(JSON.stringify({ success: false, error: 'O e-mail corporativo é a identidade de login e não pode ser trocado neste fluxo', code: 'TEAM_EMAIL_IMMUTABLE' }), { status: 409 }, appOrigin);
      }

      const nextName = String(body.fullName ?? current.full_name).trim().replace(/\s+/g, ' ');
      const nextDepartment = String(body.department ?? current.department_name).trim().replace(/\s+/g, ' ').slice(0, 120);
      const nextTitle = String(body.jobTitle ?? current.job_title).trim();
      const nextProfile = body.jobTitle === undefined ? current.profile : resolveEmployeeProfile(nextTitle);
      if (!nextName || !nextDepartment || !nextProfile) return withCORS(JSON.stringify({ success: false, error: 'Dados de edição inválidos', code: 'TEAM_UPDATE_INVALID' }), { status: 400 }, appOrigin);
      const nextUnits = normalizeAllowedUnits(body.units ?? current.units_json);
      if (!nextUnits.length || unknownUnitScopes(body.units ?? current.units_json).length) return withCORS(JSON.stringify({ success: false, error: 'Unidades inválidas', code: 'TEAM_UNITS_INVALID' }), { status: 400 }, appOrigin);
      const denied = canCreateEmployee({ actorRole: auth?.user?.role, actorAllowedUnits: auth?.user?.allowedUnits, targetProfile: nextProfile.profile || nextProfile, units: nextUnits });
      if (denied) return withCORS(JSON.stringify({ success: false, error: 'Hierarquia ou unidade não autorizada', code: denied }), { status: 403 }, appOrigin);

      const nextPersonalEmail = body.personalEmail !== undefined ? normalizePersonalEmail(body.personalEmail) : '';
      if (body.personalEmail !== undefined && !nextPersonalEmail) return withCORS(JSON.stringify({ success: false, error: 'E-mail pessoal inválido', code: 'TEAM_PERSONAL_EMAIL_INVALID' }), { status: 400 }, appOrigin);
      const nextPhone = body.mobilePhone !== undefined || body.phone !== undefined ? normalizePhone(body.mobilePhone ?? body.phone) : '';
      if ((body.mobilePhone !== undefined || body.phone !== undefined) && !nextPhone) return withCORS(JSON.stringify({ success: false, error: 'Telefone inválido', code: 'TEAM_PHONE_INVALID' }), { status: 400 }, appOrigin);
      const nextPersonalEmailEncrypted = nextPersonalEmail ? await encryptOnboardingPii(env, nextPersonalEmail) : '';
      const nextPersonalEmailHash = nextPersonalEmail ? await sha256Hex(nextPersonalEmail) : '';
      const nextPhoneEncrypted = nextPhone ? await encryptOnboardingPii(env, nextPhone) : '';
      const nextPhoneHash = nextPhone ? await sha256Hex(nextPhone) : '';
      const teamData = normalizeTeamData(body.team, nextUnits, {
        professionalId: current.schedule_professional_id,
        status: current.schedule_status,
        role: current.schedule_role,
        shift: current.schedule_shift,
        nickname: current.schedule_nickname,
        instagram: current.schedule_instagram,
        color: current.schedule_color,
        units: nextUnits,
      });
      if (body?.team?.units !== undefined && unknownUnitScopes(body.team.units).length) {
        return withCORS(JSON.stringify({ success: false, error: 'Unidades operacionais inválidas', code: 'TEAM_UNITS_INVALID' }), { status: 400 }, appOrigin);
      }
      if (teamData.units.some((unit) => !nextUnits.includes(unit))) {
        return withCORS(JSON.stringify({ success: false, error: 'As unidades operacionais devem estar dentro do escopo do cadastro', code: 'TEAM_UNITS_DENIED' }), { status: 403 }, appOrigin);
      }

      const requestId = String(request.headers.get('x-request-id') || `identity-team-update-${onboardingId}`).slice(0, 180);
      await syncIdentityWorkforceOnboarding(env, {
        onboardingId,
        fullName: nextName,
        corporateEmail: current.corporate_email,
        mobilePhoneHash: nextPhoneHash || current.mobile_phone_hash,
        units: nextUnits,
        profile: nextProfile.profile || nextProfile,
        accountStatus: current.account_status,
        jobTitle: displayJobTitle(nextProfile.profile || nextProfile),
        department: nextDepartment,
        createdBy: String(auth?.user?.username || ''),
      }, requestId);
      workforceSynchronized = true;

      localPersistenceStage = 'ONBOARDING_UPDATE';
      const sets = ['full_name=?', 'profile=?', 'job_title=?', 'department_name=?', 'units_json=?', 'updated_at=?'];
      const values = [nextName, nextProfile.profile || nextProfile, displayJobTitle(nextProfile.profile || nextProfile), nextDepartment, JSON.stringify(nextUnits), new Date().toISOString()];
      if (nextPersonalEmail) {
        sets.push('personal_email_encrypted=?', 'personal_email_hash=?');
        values.push(nextPersonalEmailEncrypted, nextPersonalEmailHash);
      }
      if (nextPhone) {
        sets.push('mobile_phone_encrypted=?', 'mobile_phone_hash=?');
        values.push(nextPhoneEncrypted, nextPhoneHash);
      }
      values.push(onboardingId);
      const onboardingUpdate = await env.DB.prepare(`UPDATE crm_employee_onboarding SET ${sets.join(', ')} WHERE id=?`).bind(...values).run();
      if (Number(onboardingUpdate?.meta?.changes ?? 0) !== 1) throw new Error('TEAM_ONBOARDING_LOCAL_UPDATE_NOT_APPLIED');

      localPersistenceStage = 'TEAM_UPDATE';
      const nextScheduleProfessionalId = teamData.professionalId || current.schedule_professional_id || null;
      const teamUpdate = await env.DB.prepare(`UPDATE crm_employee_team SET schedule_professional_id=?, schedule_status=?, schedule_role=?, schedule_shift=?, schedule_nickname=?, schedule_instagram=?, schedule_color=?, units_json=?, updated_at=? WHERE onboarding_id=?`).bind(
        nextScheduleProfessionalId, teamData.status || null, teamData.role || null, teamData.shift || null,
        teamData.nickname || null, teamData.instagram || null, teamData.color || null, JSON.stringify(teamData.units), new Date().toISOString(), onboardingId,
      ).run();
      if (Number(teamUpdate?.meta?.changes ?? 0) !== 1) throw new Error('TEAM_LOCAL_UPDATE_NOT_APPLIED');
      const scheduleState = hasScheduleIntent(teamData) || nextScheduleProfessionalId ? 'PENDING' : 'NOT_CONFIGURED';
      const scheduleSync = await persistScheduleSyncOperation({
        env,
        onboardingId,
        state: scheduleState,
        professionalId: nextScheduleProfessionalId || '',
        operationKey: internalScheduleOperationKey(onboardingId, scheduleState),
      }).catch(() => null);
      const updated = await env.DB.prepare(`SELECT o.*, t.schedule_professional_id, t.schedule_status, t.schedule_role, t.schedule_shift, t.schedule_nickname, t.schedule_instagram, t.schedule_color, t.units_json AS schedule_units_json, a.id AS crm_account_link_id, a.crm_username AS crm_account_username, a.review_status AS crm_account_review_status
        FROM crm_employee_onboarding o LEFT JOIN crm_employee_team t ON t.onboarding_id=o.id
        LEFT JOIN crm_employee_account_links a ON a.onboarding_id=o.id WHERE o.id=? LIMIT 1`).bind(onboardingId).first();
      const links = await env.DB.prepare('SELECT * FROM crm_employee_identity_links WHERE workforce_employee_id=? ORDER BY created_at DESC').bind(updated.workforce_employee_id).all();
      await appendAuditLog?.({ env, actor: auth.user.username, role: auth.user.role, ip, userAgent, action: 'EMPLOYEE_TEAM_UPDATED', entity: 'EMPLOYEE_ONBOARDING', entityId: onboardingId, unidade: nextUnits.join(','), before: { profile: current.profile, units: normalizeAllowedUnits(current.units_json), scheduleProfessionalId: current.schedule_professional_id || null }, after: { profile: nextProfile.profile || nextProfile, units: nextUnits, scheduleProfessionalId: nextScheduleProfessionalId, scheduleSyncState: scheduleSync?.scheduleSync?.state || scheduleState } });
      await recordTeamTelemetry({ env, eventName: 'EMPLOYEE_TEAM_UPDATED', actorRole: auth.user.role, itemCount: 1, unitCount: nextUnits.length });
      return withCORS(JSON.stringify({ success: true, data: publicTeamMember(updated, (links?.results || []).map(publicIdentityLink), scheduleSync?.scheduleSync || { state: scheduleState, professionalId: nextScheduleProfessionalId }) }), { status: 200 }, appOrigin);
    } catch (error) {
      const message = String(error?.message || 'TEAM_UPDATE_FAILED');
      if (workforceSynchronized && ['ONBOARDING_UPDATE', 'TEAM_UPDATE'].includes(localPersistenceStage)) {
        const now = new Date().toISOString();
        const safeErrorCode = message.slice(0, 120);
        await env.DB.prepare("UPDATE crm_employee_onboarding SET compensation_state='LOCAL_TEAM_UPDATE_PENDING', last_error_code=?, updated_at=? WHERE id=?")
          .bind(safeErrorCode, now, onboardingId)
          .run()
          .catch(() => {});
        await Promise.resolve(appendAuditLog?.({
          env,
          actor: auth.user.username,
          role: auth.user.role,
          ip,
          userAgent,
          action: 'EMPLOYEE_TEAM_COMPENSATION_PENDING',
          entity: 'EMPLOYEE_ONBOARDING',
          entityId: onboardingId,
          unidade: normalizeAllowedUnits(current?.units_json).join(','),
          after: { stage: localPersistenceStage, workforceSynchronized: true, requestId, failClosed: true },
        })).catch(() => {});
        await recordTeamTelemetry({ env, eventName: 'EMPLOYEE_TEAM_UPDATED', actorRole: auth.user.role, outcome: 'PENDING', itemCount: 1, unitCount: normalizeAllowedUnits(current?.units_json).length });
        return withCORS(JSON.stringify({ success: false, error: 'Atualização local da equipe pendente de compensação', code: 'TEAM_LOCAL_PERSISTENCE_PENDING' }), { status: 503 }, appOrigin);
      }
      const status = isOnboardingDependencyError(message) ? 503 : 500;
      return withCORS(JSON.stringify({ success: false, error: status === 503 ? 'Atualização da identidade pendente' : 'Não foi possível atualizar a equipe', code: message.slice(0, 120) }), { status }, appOrigin);
    }
  }

  if (url.pathname === '/admin/team' && request.method === 'GET') {
    try {
      const requestedStatus = String(url.searchParams.get('status') || 'active').trim().toUpperCase();
      const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const statusClause = requestedStatus === 'ALL'
        ? ''
        : requestedStatus === 'ACTIVE'
          ? `AND o.account_status IN ('INVITED', 'ACTIVE')`
          : `AND o.account_status = ?`;
      const params = requestedStatus === 'ALL' || requestedStatus === 'ACTIVE' ? [] : [requestedStatus];
      const rows = await env.DB.prepare(`SELECT o.*, t.schedule_professional_id, t.schedule_status, t.schedule_role, t.schedule_shift, t.schedule_nickname, t.schedule_instagram, t.units_json AS schedule_units_json, a.id AS crm_account_link_id, a.crm_username AS crm_account_username, a.review_status AS crm_account_review_status
        FROM crm_employee_onboarding o LEFT JOIN crm_employee_team t ON t.onboarding_id=o.id
        LEFT JOIN crm_employee_account_links a ON a.onboarding_id=o.id
        WHERE 1=1 ${statusClause} ORDER BY o.created_at DESC LIMIT 500`).bind(...params).all();
      const visible = (rows?.results || [])
        .filter((row) => teamUnitsVisible(auth, row.units_json))
        .filter((row) => !query || [row.full_name, row.requested_username, row.corporate_email, row.department_name, row.job_title, ...normalizeAllowedUnits(row.units_json)]
          .some((value) => String(value || '').toLowerCase().includes(query)));
      const employeeIds = visible.map((row) => String(row.workforce_employee_id || '').trim()).filter(Boolean);
      const linkRows = employeeIds.length
        ? await env.DB.prepare(`SELECT * FROM crm_employee_identity_links WHERE workforce_employee_id IN (${employeeIds.map(() => '?').join(', ')}) ORDER BY created_at DESC`).bind(...employeeIds).all()
        : { results: [] };
      const linksByEmployee = new Map();
      for (const link of linkRows?.results || []) {
        const key = String(link.workforce_employee_id || '');
        const list = linksByEmployee.get(key) || [];
        list.push(publicIdentityLink(link));
        linksByEmployee.set(key, list);
      }
      const operations = await env.DB.prepare(`SELECT operation_key, operation_type, member_ids_json, result_json, created_at
        FROM crm_team_operations
        WHERE operation_type='ESCALA_SYNC'
        ORDER BY created_at DESC LIMIT 2000`).all();
      const latestScheduleSync = latestScheduleSyncByMember(operations?.results || []);
      const data = visible.map((row) => publicTeamMember(
        row,
        linksByEmployee.get(String(row.workforce_employee_id || '')) || [],
        latestScheduleSync.get(String(row.id || '')) || null,
      ));
      const pendingLinks = data.reduce((sum, row) => sum + (row.identityLinks || []).filter((link) => link.reviewStatus === 'PENDING_REVIEW').length, 0);
      const pendingProvisioning = data.filter((row) => ['PROVISIONING', 'WORKFORCE_SYNCED', 'INVITE_PENDING', 'FAILED'].includes(String(row.provisioningState || '').toUpperCase())).length;
      const pendingInvites = data.filter((row) => String(row.accountStatus || '').toUpperCase() === 'INVITED').length;
      const pendingAccountLinks = data.filter((row) => !row.crmAccountLinked && ['ACTIVE', 'SUSPENDED', 'TERMINATED'].includes(String(row.accountStatus || '').toUpperCase())).length;
      return withCORS(JSON.stringify({
        success: true,
        data,
        activeOnly: requestedStatus !== 'ALL',
        status: requestedStatus,
        summary: { members: data.length, pendingLinks, pendingProvisioning, pendingInvites, pendingAccountLinks },
        pendingItems: teamPendingItems(data),
      }), { status: 200 }, appOrigin);
    } catch {
      return withCORS(JSON.stringify({ success: false, error: 'TEAM_MIGRATION_REQUIRED' }), { status: 503 }, appOrigin);
    }
  }

  if (url.pathname === '/admin/onboarding' && request.method === 'GET') {
    try {
      const requestedStatus = String(url.searchParams.get('status') || 'ALL').trim().toUpperCase();
      const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const rows = await env.DB.prepare('SELECT * FROM crm_employee_onboarding ORDER BY created_at DESC LIMIT 500').all();
      const visible = (rows?.results || [])
        .filter((row) => requestedStatus === 'ALL' || requestedStatus === 'ACTIVE' && ['INVITED', 'ACTIVE'].includes(String(row.account_status || '').toUpperCase()) || String(row.account_status || '').toUpperCase() === requestedStatus)
        .filter((row) => teamUnitsVisible(auth, row.units_json))
        .filter((row) => !query || [row.full_name, row.requested_username, row.corporate_email, row.department_name, row.job_title, ...normalizeAllowedUnits(row.units_json)].some((value) => String(value || '').toLowerCase().includes(query)));
      return withCORS(JSON.stringify({ success: true, data: visible.map(publicOnboarding), activeOnly: requestedStatus !== 'ALL', status: requestedStatus, summary: { members: visible.length, pendingInvites: visible.filter((row) => String(row.account_status || '').toUpperCase() === 'INVITED').length } }), { status: 200 }, appOrigin);
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
    if (legacyUserRoutesDisabled(env)) {
      return withCORS(JSON.stringify({ success: false, error: 'Use a gestão centralizada de equipe.', code: 'UNIFIED_TEAM_ROUTE_DISABLED' }), { status: 410 }, appOrigin);
    }
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
    if (legacyUserRoutesDisabled(env)) {
      return withCORS(JSON.stringify({ success: false, error: 'Use a gestão centralizada de equipe e convites.', code: 'UNIFIED_TEAM_ROUTE_DISABLED' }), { status: 410 }, appOrigin);
    }
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
    if (legacyUserRoutesDisabled(env)) {
      return withCORS(JSON.stringify({ success: false, error: 'Use a gestão centralizada de equipe e convites.', code: 'UNIFIED_TEAM_ROUTE_DISABLED' }), { status: 410 }, appOrigin);
    }
    try {
      const target = decodeURIComponent(url.pathname.slice('/admin/users/'.length)).trim();
      if (!target) return withCORS(JSON.stringify({ success: false, error: 'USERNAME_REQUIRED' }), { status: 400 }, appOrigin);
      const body = await request.json().catch(() => ({}));

      const exists = await env.DB.prepare(`SELECT username, email FROM ${usersTable} WHERE LOWER(username) = LOWER(?) LIMIT 1`).bind(target).first();
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
      if (onboardingHasSaga && [body.role, body.allowedUnits, body.allowedModules, body.ativo].some((value) => value !== undefined)) {
        const onboarding = await env.DB.prepare('SELECT id FROM crm_employee_onboarding WHERE LOWER(corporate_email)=LOWER(?) LIMIT 1').bind(exists.email || '').first();
        if (onboarding?.id) {
          return withCORS(JSON.stringify({ success: false, error: 'Vínculo de onboarding é gerenciado pelo contrato hierárquico', code: 'IDENTITY_ONBOARDING_MANAGED' }), { status: 409 }, appOrigin);
        }
      }
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
    if (legacyUserRoutesDisabled(env)) {
      return withCORS(JSON.stringify({ success: false, error: 'A senha deve ser criada pelo próprio integrante após o convite.', code: 'UNIFIED_TEAM_ROUTE_DISABLED' }), { status: 410 }, appOrigin);
    }
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
