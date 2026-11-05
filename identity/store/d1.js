import { isOpaqueIdentitySubject, normalizeAllowedUnits, toAuthenticatedActor } from '../../shared/identity-contract/index.js';

const toInt = (value, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseScopes = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
  } catch {
    // Legacy delimited rows stay readable during migration.
  }
  return value.split(/[,;|]/g).map((item) => item.trim()).filter(Boolean);
};

// Schema probes (sqlite_master / PRAGMA table_info) only change through D1
// migrations, so each isolate caches their results for a short TTL instead of
// paying one D1 round trip per probe on every request. The cache is keyed by the
// D1 binding object and holds schema metadata only (never user or session data).
// Failed probes are never cached: the request falls back to the legacy result.
export const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;
const schemaCacheByDb = new WeakMap();

function schemaCacheFor(db) {
  if (!db || (typeof db !== 'object' && typeof db !== 'function')) return null;
  let cache = schemaCacheByDb.get(db);
  if (!cache) {
    cache = new Map();
    schemaCacheByDb.set(db, cache);
  }
  return cache;
}

async function cachedSchemaProbe(env, key, load) {
  const cache = schemaCacheFor(env?.DB);
  const now = Date.now();
  const hit = cache?.get(key);
  if (hit && hit.expiresAt > now) return hit.promise;
  const promise = load();
  cache?.set(key, { promise, expiresAt: now + SCHEMA_CACHE_TTL_MS });
  try {
    return await promise;
  } catch (error) {
    if (cache?.get(key)?.promise === promise) cache.delete(key);
    throw error;
  }
}

export function clearIdentitySchemaCache(env) {
  if (env?.DB && schemaCacheByDb.has(env.DB)) schemaCacheByDb.delete(env.DB);
}

async function objectTypeUncached(env, name) {
  const row = await env.DB.prepare('SELECT type FROM sqlite_master WHERE name = ? LIMIT 1').bind(name).first();
  return row?.type ? String(row.type) : null;
}

async function objectType(env, name) {
  try {
    return await cachedSchemaProbe(env, `type:${name}`, () => objectTypeUncached(env, name));
  } catch {
    return null;
  }
}

export async function resolveIdentityTables(env) {
  const [users, invites, resets, prefs] = await Promise.all([
    objectType(env, 'crm_users'), objectType(env, 'crm_invites'), objectType(env, 'crm_password_resets'), objectType(env, 'crm_user_prefs'),
  ]);
  return {
    usersTable: users === 'table' ? 'crm_users' : 'insumos_users',
    invitesTable: invites === 'table' ? 'crm_invites' : 'insumos_invites',
    passwordResetsTable: resets === 'table' ? 'crm_password_resets' : 'insumos_password_resets',
    userPrefsTable: prefs === 'table' ? 'crm_user_prefs' : 'insumos_user_prefs',
  };
}

const PROBED_TABLES = ['crm_users', 'insumos_users', 'crm_invites', 'insumos_invites', 'crm_employee_account_links'];

async function tableColumnsUncached(env, table) {
  const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((result?.results ?? []).map((row) => String(row?.name || '').toLowerCase()));
}

// Returns false for unknown tables, missing columns and failed probes.
export async function identityTableHasColumn(env, table, column) {
  if (!env?.DB || !table || !column) return false;
  const name = String(table);
  if (!PROBED_TABLES.includes(name)) return false;
  try {
    const columns = await cachedSchemaProbe(env, `columns:${name}`, () => tableColumnsUncached(env, name));
    return columns.has(String(column).toLowerCase());
  } catch {
    return false;
  }
}

async function hasColumn(env, table, column) {
  if (!['crm_users', 'insumos_users', 'crm_invites', 'insumos_invites'].includes(table)) return false;
  return identityTableHasColumn(env, table, column);
}

function toIdentityUser(row) {
  if (!row) return null;
  return {
    name: row.display_name || row.username,
    displayName: row.display_name || row.username,
    username: row.username,
    email: row.email || '',
    role: row.role || 'CONSULTOR',
    photoUrl: row.photo_url || '',
    identitySubject: isOpaqueIdentitySubject(row.identity_subject) ? row.identity_subject : null,
    allowedUnits: normalizeAllowedUnits(row.allowed_units_json),
    allowedModules: parseScopes(row.allowed_modules_json),
    ativo: toInt(row.ativo, 1) === 1,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    passwordHash: row.password_hash || '',
    sessionVersion: toInt(row.session_version, 0),
  };
}

async function readUser(env, where, values) {
  if (!env?.DB) return null;
  const { usersTable } = await resolveIdentityTables(env);
  const modulesColumn = await hasColumn(env, usersTable, 'allowed_modules_json') ? ', allowed_modules_json' : '';
  const identitySubjectColumn = await hasColumn(env, usersTable, 'identity_subject') ? ', identity_subject' : '';
  const row = await env.DB.prepare(
    `SELECT username, email, display_name, password_hash, role, photo_url, allowed_units_json, ativo, created_at, updated_at, session_version${modulesColumn}${identitySubjectColumn}
     FROM ${usersTable} WHERE ${where} LIMIT 1`,
  ).bind(...values).first();
  return toIdentityUser(row);
}

export async function getIdentityUserByUsername(env, username) {
  const value = String(username || '').trim();
  return value ? readUser(env, 'LOWER(username) = LOWER(?)', [value]) : null;
}

export async function getIdentityUserByIdentifier(env, identifier) {
  const value = String(identifier || '').trim();
  return value ? readUser(env, "LOWER(username) = LOWER(?) OR (email IS NOT NULL AND email != '' AND LOWER(email) = LOWER(?))", [value, value]) : null;
}

export async function getIdentityActorByUsername(env, username) {
  return toAuthenticatedActor(await getIdentityUserByUsername(env, username));
}

export async function updateIdentityProfile(env, username, updates) {
  if (!env?.DB) return { ok: false, status: 500, error: 'DB_NOT_CONFIGURED' };
  const current = await getIdentityUserByUsername(env, username);
  if (!current) return { ok: false, status: 404, error: 'USER_NOT_FOUND' };
  const { usersTable, userPrefsTable } = await resolveIdentityTables(env);
  const nextUsername = updates?.newUsername ? String(updates.newUsername).trim() : current.username;
  const now = new Date().toISOString();
  if (nextUsername.toLowerCase() !== current.username.toLowerCase()) {
    const taken = await getIdentityUserByUsername(env, nextUsername);
    if (taken) return { ok: false, status: 409, error: 'USERNAME_TAKEN' };
  }
  const next = {
    username: nextUsername,
    email: updates?.email !== undefined ? String(updates.email || '').trim() : current.email,
    displayName: updates?.displayName !== undefined ? String(updates.displayName || '').trim() : current.displayName,
    photoUrl: updates?.photoUrl !== undefined ? String(updates.photoUrl || '') : current.photoUrl,
    passwordHash: updates?.passwordHash ? String(updates.passwordHash) : current.passwordHash,
  };
  if (nextUsername !== current.username) {
    const identitySubjectColumn = await hasColumn(env, usersTable, 'identity_subject');
    if (identitySubjectColumn && !current.identitySubject) {
      return { ok: false, status: 503, error: 'IDENTITY_SUBJECT_REQUIRED' };
    }
    const [accountLinksType, userPrefsType] = await Promise.all([
      objectType(env, 'crm_employee_account_links'),
      objectType(env, userPrefsTable),
    ]);
    if (typeof env.DB.batch !== 'function') {
      return { ok: false, status: 500, error: 'DB_BATCH_UNSUPPORTED' };
    }
    // Change the primary-key value and its live references together. Re-inserting
    // first would briefly duplicate the durable subject and violate its unique
    // index; sequential updates could leave the confirmed team link stale.
    const changes = [
      env.DB.prepare(
        `UPDATE ${usersTable}
         SET username=?, email=?, display_name=?, photo_url=?, password_hash=?, updated_at=?
         WHERE LOWER(username)=LOWER(?)`,
      ).bind(next.username, next.email, next.displayName, next.photoUrl, next.passwordHash, now, current.username),
    ];
    if (accountLinksType === 'table') {
      changes.push(
        env.DB.prepare(
          'UPDATE crm_employee_account_links SET crm_username=?, updated_at=? WHERE LOWER(crm_username)=LOWER(?)',
        ).bind(next.username, now, current.username),
      );
    }
    if (userPrefsType === 'table') {
      changes.push(
        env.DB.prepare(
          `UPDATE ${userPrefsTable} SET username=?, updated_at=? WHERE LOWER(username)=LOWER(?)`,
        ).bind(next.username, now, current.username),
      );
    }
    await env.DB.batch(changes);
    // Compatibility bridge: preserve references owned by older domains until their migrations consume subject aliases.
    for (const tableColumn of ['insumos_movements:usuario', 'share_history:user', 'audit_log:actor']) {
      const [table, column] = tableColumn.split(':');
      try { await env.DB.prepare(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`).bind(next.username, current.username).run(); } catch {}
    }
  } else {
    await env.DB.prepare(
      `UPDATE ${usersTable} SET email=?, display_name=?, photo_url=?, password_hash=?, updated_at=? WHERE LOWER(username)=LOWER(?)`,
    ).bind(next.email, next.displayName, next.photoUrl, next.passwordHash, now, current.username).run();
  }
  const user = await getIdentityUserByUsername(env, next.username);
  return { ok: true, user, username: next.username };
}

export function createIdentityD1Store(env) {
  return {
    enabled: Boolean(env?.DB),
    getUserByUsername: (username) => getIdentityUserByUsername(env, username),
    getUserByIdentifier: (identifier) => getIdentityUserByIdentifier(env, identifier),
    updateUserProfile: (_ignoredEnv, username, updates) => updateIdentityProfile(env, username, updates),
  };
}
