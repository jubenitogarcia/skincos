import { toAuthenticatedActor } from '../../shared/identity-contract/index.js';

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

async function objectType(env, name) {
  try {
    const row = await env.DB.prepare('SELECT type FROM sqlite_master WHERE name = ? LIMIT 1').bind(name).first();
    return row?.type ? String(row.type) : null;
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

async function hasColumn(env, table, column) {
  if (!['crm_users', 'insumos_users', 'crm_invites', 'insumos_invites'].includes(table)) return false;
  try {
    const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    return (result?.results ?? []).some((row) => String(row?.name || '').toLowerCase() === column);
  } catch {
    return false;
  }
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
    allowedUnits: parseScopes(row.allowed_units_json),
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
  const row = await env.DB.prepare(
    `SELECT username, email, display_name, password_hash, role, photo_url, allowed_units_json, ativo, created_at, updated_at, session_version${modulesColumn}
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
  const { usersTable } = await resolveIdentityTables(env);
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
    const modulesColumn = await hasColumn(env, usersTable, 'allowed_modules_json');
    const columns = modulesColumn
      ? 'username,email,display_name,password_hash,role,photo_url,allowed_units_json,allowed_modules_json,ativo,created_at,updated_at,session_version'
      : 'username,email,display_name,password_hash,role,photo_url,allowed_units_json,ativo,created_at,updated_at,session_version';
    const placeholders = modulesColumn ? '?,?,?,?,?,?,?,?,?,?,?,?' : '?,?,?,?,?,?,?,?,?,?,?';
    const values = modulesColumn
      ? [next.username, next.email, next.displayName, next.passwordHash, current.role, next.photoUrl, JSON.stringify(current.allowedUnits), JSON.stringify(current.allowedModules), current.ativo ? 1 : 0, current.createdAt || now, now, current.sessionVersion]
      : [next.username, next.email, next.displayName, next.passwordHash, current.role, next.photoUrl, JSON.stringify(current.allowedUnits), current.ativo ? 1 : 0, current.createdAt || now, now, current.sessionVersion];
    await env.DB.prepare(`INSERT INTO ${usersTable} (${columns}) VALUES (${placeholders})`).bind(...values).run();
    await env.DB.prepare(`DELETE FROM ${usersTable} WHERE LOWER(username)=LOWER(?)`).bind(current.username).run();
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
