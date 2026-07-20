// @ts-nocheck
// Auth routes extracted from the main worker router.

import { resolveCrmTables } from '../d1Store.js';
import { hasPasswordResetMailerConfig, sendPasswordResetEmail } from '../smtpMailer.js';

export async function handleAuthRoutes({
    request,
    url,
    env,
    appOrigin,
    withCORS,
    sessionUsername,
    sessionVersion,
    sessionCsrf,
    cookies,
    bcrypt,
    issueAuthCookies,
    deleteAuthCookies,
    validateUsername,
    MAX_PROFILE_PHOTO_URL_CHARS,
    devBypass,
    devBypassUser,
    d1,
    appendAuditLog,
    ip,
    userAgent,
}) {
    const toInt = (value, fallback) => {
        const n = parseInt(String(value ?? ''), 10);
        return Number.isFinite(n) ? n : fallback;
    };
    const authLockoutWindowMinutes = Math.max(1, toInt(env?.AUTH_LOCKOUT_WINDOW_MINUTES, 15));
    const authLockoutMaxAttempts = Math.max(1, toInt(env?.AUTH_LOCKOUT_MAX_ATTEMPTS, 5));
    const authIp = String(ip || '').trim();
    const authUserAgent = String(userAgent || '').trim();
    const normalizeIdentifier = (value) => String(value || '').trim().toLowerCase();
    const isCurrentSession = (user) => Boolean(
        user?.ativo && toInt(sessionVersion, 0) === toInt(user.sessionVersion, 0)
    );

    const textEncoder = new TextEncoder();
    const bytesToB64Url = (bytes) => {
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    };
    const b64UrlToBytes = (b64url) => {
        const s = String(b64url || '').trim();
        if (!s) return new Uint8Array();
        const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
        const bin = atob(padded);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    };
    const safeEqualBytes = (a, b) => {
        const aa = a instanceof Uint8Array ? a : new Uint8Array(a || []);
        const bb = b instanceof Uint8Array ? b : new Uint8Array(b || []);
        if (aa.length !== bb.length) return false;
        let out = 0;
        for (let i = 0; i < aa.length; i++) out |= aa[i] ^ bb[i];
        return out === 0;
    };

    // Avoid bcryptjs hashing in Workers (can exceed CPU and trigger CF 1101).
    // Keep bcrypt verification for legacy hashes and opportunistically upgrade on successful login.
    //
    // Cloudflare Workers WebCrypto PBKDF2 has a hard cap (currently 100k iters). If we try to derive above
    // that, login breaks with: "iteration counts above 100000 are not supported".
    const PBKDF2_MAX_WEBCRYPTO_ITERS = 100_000;
    const PBKDF2_TARGET_ITERS = Math.max(50_000, Math.min(PBKDF2_MAX_WEBCRYPTO_ITERS, toInt(env?.AUTH_PBKDF2_ITERS, PBKDF2_MAX_WEBCRYPTO_ITERS)));
    const PBKDF2_FALLBACK_MAX_ITERS = 250_000;

    const derivePbkdf2Sha256 = async (password, salt, iters, outBytesLen) => {
        const p = String(password || '');
        const s = salt instanceof Uint8Array ? salt : new Uint8Array(salt || []);
        const iterations = Math.max(1, parseInt(String(iters || 0), 10) || 0);
        const outLen = Math.max(1, parseInt(String(outBytesLen || 32), 10) || 32);
        const pwdBytes = textEncoder.encode(p);

        // Use native PBKDF2 when supported (fast path).
        if (iterations <= PBKDF2_MAX_WEBCRYPTO_ITERS) {
            try {
                const key = await crypto.subtle.importKey('raw', pwdBytes, 'PBKDF2', false, ['deriveBits']);
                const bits = await crypto.subtle.deriveBits(
                    { name: 'PBKDF2', hash: 'SHA-256', salt: s, iterations: iterations },
                    key,
                    outLen * 8
                );
                return new Uint8Array(bits);
            } catch {
                // Fall through to manual implementation below.
            }
        }

        // Manual PBKDF2-HMAC-SHA256 (1 block is enough for 32 bytes) for legacy hashes with iters > 100k.
        if (iterations > PBKDF2_FALLBACK_MAX_ITERS) {
            throw new Error(`PBKDF2_ITERS_TOO_HIGH:${iterations}`);
        }
        const hmacKey = await crypto.subtle.importKey(
            'raw',
            pwdBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const saltPlusIndex = new Uint8Array(s.length + 4);
        saltPlusIndex.set(s, 0);
        saltPlusIndex[s.length + 0] = 0;
        saltPlusIndex[s.length + 1] = 0;
        saltPlusIndex[s.length + 2] = 0;
        saltPlusIndex[s.length + 3] = 1;

        let u = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, saltPlusIndex));
        const t = new Uint8Array(u);
        for (let i = 2; i <= iterations; i++) {
            u = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, u));
            for (let b = 0; b < t.length; b++) t[b] ^= u[b];
        }
        return t.slice(0, outLen);
    };

    const hashPassword = async (password) => {
        const salt = new Uint8Array(16);
        crypto.getRandomValues(salt);
        const dk = await derivePbkdf2Sha256(password, salt, PBKDF2_TARGET_ITERS, 32);
        return `pbkdf2_sha256$${PBKDF2_TARGET_ITERS}$${bytesToB64Url(salt)}$${bytesToB64Url(dk)}`;
    };
    const verifyPassword = async (password, storedHash) => {
        const s = String(storedHash || '').trim();
        if (!s) return { ok: false, upgradedHash: null };

        if (s.startsWith('pbkdf2_sha256$')) {
            const parts = s.split('$');
            if (parts.length !== 4) return { ok: false, upgradedHash: null };
            const iters = Math.max(1, parseInt(parts[1], 10) || 0);
            const salt = b64UrlToBytes(parts[2]);
            const expected = b64UrlToBytes(parts[3]);
            if (!iters || !salt.length || !expected.length) return { ok: false, upgradedHash: null };
            const got = await derivePbkdf2Sha256(password, salt, iters, expected.length);
            const ok = safeEqualBytes(got, expected);
            const needsUpgrade = ok && iters !== PBKDF2_TARGET_ITERS;
            return { ok, upgradedHash: needsUpgrade ? await hashPassword(password) : null };
        }

        const isBcrypt = /^\$2[aby]\$/.test(s) || /^\$2y\$/.test(s);
        if (isBcrypt) {
            const ok = await bcrypt.compare(String(password || ''), s);
            return { ok, upgradedHash: ok ? await hashPassword(password) : null };
        }

        return { ok: false, upgradedHash: null };
    };

    const getAuthLockout = async (identifier) => {
        if (!env?.DB || !identifier) return null;
        try {
            const since = new Date(Date.now() - authLockoutWindowMinutes * 60 * 1000).toISOString();
            const row = await env.DB.prepare(
                `SELECT COUNT(1) AS n, MIN(ts) AS first_ts
                 FROM auth_attempts
                 WHERE success = 0 AND ts >= ? AND (username = ? OR ip = ?)`
            )
                .bind(since, identifier, authIp)
                .first();
            const attempts = toInt(row?.n, 0);
            if (attempts < authLockoutMaxAttempts) return null;
            const firstTs = row?.first_ts ? new Date(row.first_ts).getTime() : Date.now();
            const retryAt = firstTs + authLockoutWindowMinutes * 60 * 1000;
            const retryAfterSeconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
            return { retryAfterSeconds };
        } catch {
            return null;
        }
    };

    const recordAuthFailure = async (identifier, reason) => {
        if (!env?.DB || !identifier) return;
        try {
            await env.DB.prepare(
                `INSERT INTO auth_attempts (ts, username, ip, success, reason)
                 VALUES (?, ?, ?, 0, ?)`
            )
                .bind(new Date().toISOString(), identifier, authIp, String(reason || ''))
                .run();
        } catch {
            // ignore
        }
    };

    const clearAuthFailures = async (identifier) => {
        if (!env?.DB || !identifier) return;
        try {
            await env.DB.prepare(
                `DELETE FROM auth_attempts WHERE success = 0 AND (username = ? OR ip = ?)`
            )
                .bind(identifier, authIp)
                .run();
        } catch {
            // ignore
        }
    };

    const logAuthAudit = async ({ action, actor, role, detail }) => {
        if (!appendAuditLog) return;
        try {
            await appendAuditLog({
                env,
                actor,
                role,
                ip: authIp,
                userAgent: authUserAgent,
                action,
                entity: 'auth',
                entityId: actor,
                unidade: '',
                before: null,
                after: detail || null
            });
        } catch {
            // ignore
        }
    };
	    if (d1?.enabled) {
	        const normalizeRole = (role) => String(role || 'CONSULTOR').trim().toUpperCase();
	        const normalizeAllowedUnits = (value) => {
	            if (!value) return [];
	            if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
	            if (typeof value === 'string') {
	                const s = value.trim();
	                if (!s) return [];
	                try {
	                    const parsed = JSON.parse(s);
	                    if (Array.isArray(parsed)) return parsed.map(String).map((x) => x.trim()).filter(Boolean);
	                } catch {}
	                return s.split(/[,;|]/g).map((x) => String(x || '').trim()).filter(Boolean);
	            }
	            return [];
	        };

	        const normalizeAllowedModules = (value) => {
	            if (!value) return [];
	            if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
	            if (typeof value === 'string') {
	                const s = value.trim();
	                if (!s) return [];
	                try {
	                    const parsed = JSON.parse(s);
	                    if (Array.isArray(parsed)) return parsed.map(String).map((x) => x.trim()).filter(Boolean);
	                } catch {}
	                return s.split(/[,;|]/g).map((x) => String(x || '').trim()).filter(Boolean);
	            }
	            return [];
	        };

	        const tableHasColumn = async (tableName, columnName) => {
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
	        };

	        const { usersTable, invitesTable, passwordResetsTable } = await resolveCrmTables(env);
	        const usersHasModules = await tableHasColumn(usersTable, 'allowed_modules_json');
	        const invitesHasModules = await tableHasColumn(invitesTable, 'allowed_modules_json');

        const sha256Hex = async (input) => {
	            const data = new TextEncoder().encode(String(input || ''));
	            const hash = await crypto.subtle.digest('SHA-256', data);
	            return Array.from(new Uint8Array(hash))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
        };

        const resetPepper = String(env?.AUTH_RESET_CODE_PEPPER || '').trim();
        const hashResetSecret = async (value) => {
            if (!resetPepper) throw new Error('AUTH_RESET_CODE_PEPPER_NOT_CONFIGURED');
            const key = await crypto.subtle.importKey(
                'raw',
                textEncoder.encode(resetPepper),
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign']
            );
            const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, textEncoder.encode(String(value || ''))));
            return bytesToB64Url(bytes);
        };
        const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
        const PASSWORD_MIN_LENGTH = 12;

        const slugifyUsername = (raw) => {
            const s = String(raw || '').trim().toLowerCase();
            // keep [a-z0-9._-]
            const cleaned = s
                .normalize('NFKD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9._-]+/g, '.')
                .replace(/^\.+|\.+$/g, '')
                .replace(/\.+/g, '.');
            return cleaned.slice(0, 40);
        };

		        function randomInt(min, max) {
		            const lo = Math.ceil(Number(min) || 0);
		            const hi = Math.floor(Number(max) || 0);
		            if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return lo;
		            const range = hi - lo + 1;
		            // Rejection sampling to avoid modulo bias.
		            const u32 = new Uint32Array(1);
		            const maxUint = 0xffffffff;
		            const limit = maxUint - (maxUint % range);
		            while (true) {
		                crypto.getRandomValues(u32);
		                const x = u32[0];
		                if (x < limit) return lo + (x % range);
		            }
		        }

		        const suggestUsername = (name, email) => {
		            const local = String(email || '').split('@')[0] || '';
		            const base = slugifyUsername(local) || slugifyUsername(name) || 'user';
		            return base.length >= 3 ? base : `${base}${randomInt(100, 999)}`;
		        };

		        const ensureUniqueUsername = async (base) => {
		            const b = String(base || '').trim();
		            if (!b) return null;
		            // 1) try base
		            const taken0 = await env.DB.prepare(`SELECT 1 FROM ${usersTable} WHERE LOWER(username)=LOWER(?) LIMIT 1`).bind(b).first();
		            if (!taken0) return b;
		            // 2) add numeric suffixes
		            for (let i = 0; i < 20; i++) {
		                const suffix = String(randomInt(10, 99));
		                const candidate = `${b.slice(0, Math.max(0, 40 - (suffix.length + 1)))}-${suffix}`.slice(0, 40);
		                const taken = await env.DB.prepare(`SELECT 1 FROM ${usersTable} WHERE LOWER(username)=LOWER(?) LIMIT 1`).bind(candidate).first();
		                if (!taken) return candidate;
		            }
		            return null;
		        };

        // GET /auth/me
        if (url.pathname === "/auth/me") {
            if (devBypass && devBypassUser) {
                return withCORS(JSON.stringify({ success: true, user: devBypassUser, csrfToken: 'dev-bypass' }), { status: 200 }, appOrigin);
            }
            if (!sessionUsername) {
                return withCORS(JSON.stringify({ error: "Not authenticated" }), { status: 401 }, appOrigin);
            }
            try {
                const userDb = await d1.getUserByUsername(sessionUsername);
                if (!isCurrentSession(userDb)) {
                    return withCORS(
                        JSON.stringify({ error: "Not authenticated" }),
                        { status: 401, headers: deleteAuthCookies() },
                        appOrigin
                    );
                }
	                const user = {
	                    name: userDb.displayName || userDb.username,
	                    displayName: userDb.displayName || userDb.username,
	                    username: userDb.username,
	                    email: userDb.email,
	                    role: userDb.role || "CONSULTOR",
	                    photoUrl: userDb.photoUrl,
	                    allowedUnits: userDb.allowedUnits || [],
	                    allowedModules: userDb.allowedModules || [],
	                };
                // `/auth/me` is read-only. Rotating cookies here invalidates CSRF tokens
                // cached by other open tabs/modules and causes intermittent mutation failures.
                const csrfToken = cookies.csrfToken || sessionCsrf || null;
                return withCORS(JSON.stringify({ success: true, user, csrfToken }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ error: `Auth error: ${err.message}` }), { status: 500 }, appOrigin);
            }
        }

        // POST /auth/refresh
        if (url.pathname === "/auth/refresh" && request.method === "POST") {
            if (devBypass && devBypassUser) {
                return withCORS(JSON.stringify({ success: true, user: devBypassUser, csrfToken: 'dev-bypass' }), { status: 200 }, appOrigin);
            }
            if (!sessionUsername) {
                return withCORS(JSON.stringify({ error: "Not authenticated" }), { status: 401 }, appOrigin);
            }
            try {
                const userDb = await d1.getUserByUsername(sessionUsername);
                if (!isCurrentSession(userDb)) {
                    return withCORS(
                        JSON.stringify({ error: "Not authenticated" }),
                        { status: 401, headers: deleteAuthCookies() },
                        appOrigin
                    );
                }
	                const user = {
	                    name: userDb.displayName || userDb.username,
	                    displayName: userDb.displayName || userDb.username,
	                    username: userDb.username,
	                    email: userDb.email,
	                    role: userDb.role || "CONSULTOR",
	                    photoUrl: userDb.photoUrl,
	                    allowedUnits: userDb.allowedUnits || [],
	                    allowedModules: userDb.allowedModules || [],
	                };
                const { headers: headersOut, csrf } = await issueAuthCookies({ username: userDb.username, sv: userDb.sessionVersion || 0 });
                return withCORS(JSON.stringify({ success: true, user, csrfToken: csrf }), { status: 200, headers: headersOut }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ error: `Auth error: ${err.message}` }), { status: 500 }, appOrigin);
            }
        }

        // POST /auth/login
        if (url.pathname === "/auth/login" && request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const usernameInput = (body.username || body.user || body.email || '').toString().trim();
            const password = (body.password || body.senha || '').toString();
            const identifier = normalizeIdentifier(usernameInput);

            if (!usernameInput || !password) {
                await recordAuthFailure(identifier, 'MISSING_CREDENTIALS');
                await logAuthAudit({ action: 'AUTH_LOGIN_FAILED', actor: identifier, role: '', detail: { reason: 'MISSING_CREDENTIALS' } });
                return withCORS(JSON.stringify({ error: "Username and password required" }), { status: 400 }, appOrigin);
            }
            const lockout = await getAuthLockout(identifier);
            if (lockout) {
                const headers = new Headers();
                headers.set('Retry-After', String(lockout.retryAfterSeconds));
                await logAuthAudit({ action: 'AUTH_LOCKED', actor: identifier, role: '', detail: { retryAfterSeconds: lockout.retryAfterSeconds } });
                return withCORS(
                    JSON.stringify({ error: "Muitas tentativas. Aguarde para tentar novamente.", code: "AUTH_LOCKED", retryAfterSeconds: lockout.retryAfterSeconds }),
                    { status: 429, headers },
                    appOrigin
                );
            }

            try {
                const userDb = await d1.getUserByIdentifier(usernameInput);
                if (!userDb) {
                    await recordAuthFailure(identifier, 'INVALID_CREDENTIALS');
                    await logAuthAudit({ action: 'AUTH_LOGIN_FAILED', actor: identifier, role: '', detail: { reason: 'INVALID_CREDENTIALS' } });
                    return withCORS(JSON.stringify({ error: "Invalid credentials" }), { status: 401 }, appOrigin);
                }
                if (!userDb.ativo) {
                    await recordAuthFailure(identifier, 'USER_INACTIVE');
                    await logAuthAudit({ action: 'AUTH_LOGIN_FAILED', actor: identifier, role: userDb.role || '', detail: { reason: 'USER_INACTIVE', username: userDb.username } });
                    return withCORS(JSON.stringify({ error: "User inactive" }), { status: 403 }, appOrigin);
                }
                if (!userDb.passwordHash) {
                    await recordAuthFailure(identifier, 'PASSWORD_NOT_SET');
                    await logAuthAudit({ action: 'AUTH_LOGIN_FAILED', actor: identifier, role: userDb.role || '', detail: { reason: 'PASSWORD_NOT_SET', username: userDb.username } });
                    return withCORS(JSON.stringify({ error: "Password not set" }), { status: 401 }, appOrigin);
                }
                const verified = await verifyPassword(password, userDb.passwordHash);
                if (!verified.ok) {
                    await recordAuthFailure(identifier, 'INVALID_CREDENTIALS');
                    await logAuthAudit({ action: 'AUTH_LOGIN_FAILED', actor: identifier, role: userDb.role || '', detail: { reason: 'INVALID_CREDENTIALS', username: userDb.username } });
                    return withCORS(JSON.stringify({ error: "Invalid credentials" }), { status: 401 }, appOrigin);
                }
                if (verified.upgradedHash && env?.DB && usersTable) {
                    try {
                        const now = new Date().toISOString();
                        await env.DB.prepare(
                            `UPDATE ${usersTable} SET password_hash = ?, updated_at = ? WHERE username = ?`
                        )
                            .bind(String(verified.upgradedHash), now, String(userDb.username))
                            .run();
                    } catch {
                        // ignore upgrade failures
                    }
                }
	                const user = {
	                    name: userDb.displayName || userDb.username,
	                    displayName: userDb.displayName || userDb.username,
	                    username: userDb.username,
	                    email: userDb.email,
	                    role: userDb.role || "CONSULTOR",
	                    photoUrl: userDb.photoUrl,
	                    allowedUnits: userDb.allowedUnits || [],
	                    allowedModules: userDb.allowedModules || [],
	                };
                await clearAuthFailures(identifier);
                await logAuthAudit({ action: 'AUTH_LOGIN_SUCCESS', actor: userDb.username, role: userDb.role || '', detail: { username: userDb.username } });
                const { headers: headersOut, csrf } = await issueAuthCookies({ username: userDb.username, sv: userDb.sessionVersion || 0 });
                return withCORS(JSON.stringify({ success: true, user, csrfToken: csrf }), { status: 200, headers: headersOut }, appOrigin);
            } catch (err) {
                await recordAuthFailure(identifier, 'LOGIN_ERROR');
                await logAuthAudit({ action: 'AUTH_LOGIN_FAILED', actor: identifier, role: '', detail: { reason: 'LOGIN_ERROR' } });
                return withCORS(JSON.stringify({ error: `Login error: ${err.message}` }), { status: 500 }, appOrigin);
            }
        }

        // POST /auth/register (invite-based signup)
        if ((url.pathname === "/auth/register" || url.pathname === "/auth/signup") && request.method === "POST") {
            try {
                if (!env?.DB) {
                    return withCORS(JSON.stringify({ success: false, error: "DB_NOT_CONFIGURED" }), { status: 500 }, appOrigin);
                }
                const body = await request.json().catch(() => ({}));
                const name = String(body.name || '').trim();
                const email = String(body.email || body.username || '').trim();
                const password = String(body.password || body.senha || '').toString();
                const inviteToken = String(body.token || body.invite || body.inviteToken || '').trim();

                if (!inviteToken) {
                    return withCORS(JSON.stringify({ success: false, error: "TOKEN_REQUIRED" }), { status: 400 }, appOrigin);
                }
                if (!name) {
                    return withCORS(JSON.stringify({ success: false, error: "NAME_REQUIRED" }), { status: 400 }, appOrigin);
                }
                if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                    return withCORS(JSON.stringify({ success: false, error: "EMAIL_INVALID" }), { status: 400 }, appOrigin);
                }
                if (!password || password.length < PASSWORD_MIN_LENGTH) {
                    return withCORS(JSON.stringify({ success: false, error: "PASSWORD_TOO_SHORT" }), { status: 400 }, appOrigin);
                }

                const inviteHash = await sha256Hex(inviteToken);
                const now = new Date().toISOString();

                const invite = await env.DB.prepare(
                    `SELECT id, role, allowed_units_json${invitesHasModules ? ', allowed_modules_json' : ''}, max_uses, uses_count, expires_at, revoked
                     FROM ${invitesTable}
                     WHERE token_hash = ?
                     LIMIT 1`
                )
                    .bind(inviteHash)
                    .first();

                if (!invite?.id) {
                    return withCORS(JSON.stringify({ success: false, error: "TOKEN_INVALID" }), { status: 401 }, appOrigin);
                }
                if (Number(invite.revoked || 0)) {
                    return withCORS(JSON.stringify({ success: false, error: "TOKEN_REVOKED" }), { status: 403 }, appOrigin);
                }
                const maxUses = Math.max(1, parseInt(String(invite.max_uses || 1), 10) || 1);
                const usesCount = Math.max(0, parseInt(String(invite.uses_count || 0), 10) || 0);
                if (usesCount >= maxUses) {
                    return withCORS(JSON.stringify({ success: false, error: "TOKEN_EXHAUSTED" }), { status: 403 }, appOrigin);
                }
                const expiresAt = invite.expires_at ? String(invite.expires_at) : '';
                if (expiresAt) {
                    const exp = new Date(expiresAt).getTime();
                    if (Number.isFinite(exp) && Date.now() > exp) {
                        return withCORS(JSON.stringify({ success: false, error: "TOKEN_EXPIRED" }), { status: 403 }, appOrigin);
                    }
                }

                const existing = await d1.getUserByIdentifier(email);
                if (existing) {
                    return withCORS(JSON.stringify({ success: false, error: "EMAIL_TAKEN" }), { status: 409 }, appOrigin);
                }

                const base = suggestUsername(name, email);
                const candidate = await ensureUniqueUsername(base);
                if (!candidate || !validateUsername(candidate)) {
                    return withCORS(JSON.stringify({ success: false, error: "USERNAME_UNAVAILABLE" }), { status: 409 }, appOrigin);
                }

                const role = normalizeRole(invite.role || 'CONSULTOR');
                const allowedUnits = normalizeAllowedUnits(invite.allowed_units_json || '');
                const allowedModules = invitesHasModules ? normalizeAllowedModules(invite.allowed_modules_json || '') : [];
                const hash = await hashPassword(password);

                if (usersHasModules) {
                    await env.DB.prepare(
                        `INSERT INTO ${usersTable}
                         (username, email, display_name, password_hash, role, photo_url, allowed_units_json, allowed_modules_json, ativo, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
                    )
                        .bind(
                            candidate,
                            email,
                            name,
                            hash,
                            role,
                            '',
                            JSON.stringify(allowedUnits),
                            JSON.stringify(allowedModules),
                            now,
                            now
                        )
                        .run();
                } else {
                    await env.DB.prepare(
                        `INSERT INTO ${usersTable}
                         (username, email, display_name, password_hash, role, photo_url, allowed_units_json, ativo, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
                    )
                        .bind(
                            candidate,
                            email,
                            name,
                            hash,
                            role,
                            '',
                            JSON.stringify(allowedUnits),
                            now,
                            now
                        )
                        .run();
                }

                await env.DB.prepare(
                    `UPDATE ${invitesTable}
                     SET uses_count = uses_count + 1
                     WHERE id = ?`
                )
                    .bind(invite.id)
                    .run();

                const userDb = await d1.getUserByUsername(candidate);
                const user = userDb
                    ? {
                        name: userDb.displayName || userDb.username,
                        displayName: userDb.displayName || userDb.username,
                        username: userDb.username,
                        email: userDb.email,
                        role: userDb.role || "CONSULTOR",
                        photoUrl: userDb.photoUrl,
                        allowedUnits: userDb.allowedUnits || [],
                        allowedModules: userDb.allowedModules || [],
                    }
                    : {
                        name,
                        displayName: name,
                        username: candidate,
                        email,
                        role,
                        photoUrl: '',
                        allowedUnits,
                        allowedModules,
                    };

                const { headers: headersOut, csrf } = await issueAuthCookies({ username: candidate, sv: userDb?.sessionVersion || 0 });
                return withCORS(JSON.stringify({ success: true, user, csrfToken: csrf }), { status: 201, headers: headersOut }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message || String(err) }), { status: 500 }, appOrigin);
            }
        }

        // POST /auth/password/request
        if (url.pathname === "/auth/password/request" && request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const email = normalizeIdentifier(body.email);
            if (!isValidEmail(email)) {
                return withCORS(JSON.stringify({ success: false, error: "EMAIL_REQUIRED" }), { status: 400 }, appOrigin);
            }
            try {
                const userDb = await d1.getUserByIdentifier(email);
                if (!userDb?.ativo || normalizeIdentifier(userDb.email) !== email) {
                    return withCORS(JSON.stringify({ success: false, error: 'EMAIL_NOT_REGISTERED' }), { status: 404 }, appOrigin);
                }
                if (!hasPasswordResetMailerConfig(env) || !resetPepper) {
                    return withCORS(JSON.stringify({ success: false, error: 'PASSWORD_RECOVERY_UNAVAILABLE' }), { status: 503 }, appOrigin);
                }
                const cooldownSeconds = Math.max(30, toInt(env?.AUTH_RESET_COOLDOWN_SECONDS, 60));
                const cooldownSince = new Date(Date.now() - cooldownSeconds * 1000).toISOString();
                const recent = await env.DB.prepare(
                    `SELECT id FROM ${passwordResetsTable}
                     WHERE LOWER(email) = ? AND sent_at IS NOT NULL AND created_at >= ? AND used_at IS NULL
                     ORDER BY id DESC LIMIT 1`
                ).bind(email, cooldownSince).first();
                if (recent?.id) {
                    return withCORS(JSON.stringify({ success: false, error: 'RESET_COOLDOWN', retryAfterSeconds: cooldownSeconds }), { status: 429 }, appOrigin);
                }

                const code = String(randomInt(100000, 999999));
                const codeHash = await hashResetSecret(code);
                const now = new Date();
                const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
                const pending = await env.DB.prepare(
                    `INSERT INTO ${passwordResetsTable} (token_hash, username, email, created_at, expires_at)
                     VALUES (?, ?, ?, ?, ?)`
                ).bind(codeHash, userDb.username, email, now.toISOString(), expiresAt).run();
                const resetId = pending?.meta?.last_row_id;
                if (!resetId) throw new Error('PASSWORD_RESET_CREATE_FAILED');
                try {
                    await sendPasswordResetEmail({ env, to: email, code, expiresAt });
                } catch (mailError) {
                    await env.DB.prepare(`DELETE FROM ${passwordResetsTable} WHERE id = ? AND sent_at IS NULL`).bind(resetId).run();
                    const reason = String(mailError?.message || mailError || 'SMTP_ERROR_UNKNOWN')
                        .replace(/[\r\n]+/g, ' ')
                        .slice(0, 160);
                    console.error(JSON.stringify({ event: 'AUTH_PASSWORD_RESET_EMAIL_FAILED', reset_id: resetId, reason }));
                    return withCORS(JSON.stringify({ success: false, error: 'EMAIL_DELIVERY_FAILED' }), { status: 503 }, appOrigin);
                }
                await env.DB.batch([
                    env.DB.prepare(`UPDATE ${passwordResetsTable} SET sent_at = ? WHERE id = ? AND sent_at IS NULL`).bind(new Date().toISOString(), resetId),
                    env.DB.prepare(`UPDATE ${passwordResetsTable} SET used_at = ? WHERE username = ? AND id <> ? AND used_at IS NULL`).bind(new Date().toISOString(), userDb.username, resetId)
                ]);
                await logAuthAudit({ action: 'AUTH_PASSWORD_RESET_REQUEST', actor: userDb.username, role: userDb.role || '', detail: { delivery: 'smtp' } });
                return withCORS(JSON.stringify({ success: true, expiresAt }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message || String(err) }), { status: 500 }, appOrigin);
            }
        }

        // POST /auth/password/verify
        if (url.pathname === '/auth/password/verify' && request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            const email = normalizeIdentifier(body.email);
            const code = String(body.code || '').trim();
            if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
                return withCORS(JSON.stringify({ success: false, error: 'CODE_INVALID' }), { status: 400 }, appOrigin);
            }
            try {
                const row = await env.DB.prepare(
                    `SELECT id, token_hash, expires_at, used_at, verification_attempts
                     FROM ${passwordResetsTable}
                     WHERE LOWER(email) = ? AND sent_at IS NOT NULL AND used_at IS NULL
                     ORDER BY id DESC LIMIT 1`
                ).bind(email).first();
                const exp = row?.expires_at ? new Date(row.expires_at).getTime() : 0;
                if (!row?.id || !exp || Date.now() > exp) {
                    return withCORS(JSON.stringify({ success: false, error: 'CODE_EXPIRED' }), { status: 400 }, appOrigin);
                }
                const attempts = Math.max(0, toInt(row.verification_attempts, 0));
                if (attempts >= 5) {
                    return withCORS(JSON.stringify({ success: false, error: 'CODE_LOCKED' }), { status: 429 }, appOrigin);
                }
                const codeHash = await hashResetSecret(code);
                if (!safeEqualBytes(textEncoder.encode(codeHash), textEncoder.encode(String(row.token_hash || '')))) {
                    const nextAttempts = attempts + 1;
                    await env.DB.prepare(
                        `UPDATE ${passwordResetsTable}
                         SET verification_attempts = ?, last_attempt_at = ?, used_at = CASE WHEN ? >= 5 THEN ? ELSE used_at END
                         WHERE id = ? AND used_at IS NULL`
                    ).bind(nextAttempts, new Date().toISOString(), nextAttempts, new Date().toISOString(), row.id).run();
                    return withCORS(JSON.stringify({ success: false, error: nextAttempts >= 5 ? 'CODE_LOCKED' : 'CODE_INVALID' }), { status: nextAttempts >= 5 ? 429 : 400 }, appOrigin);
                }
                const grant = `${crypto.randomUUID()}${crypto.randomUUID()}`;
                const grantHash = await hashResetSecret(grant);
                await env.DB.prepare(
                    `UPDATE ${passwordResetsTable} SET verified_at = ?, grant_hash = ? WHERE id = ? AND used_at IS NULL`
                ).bind(new Date().toISOString(), grantHash, row.id).run();
                return withCORS(JSON.stringify({ success: true, resetGrant: grant, expiresAt: row.expires_at }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message || String(err) }), { status: 500 }, appOrigin);
            }
        }

        // POST /auth/password/reset
        if (url.pathname === "/auth/password/reset" && request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const grant = String(body.resetGrant || '').trim();
            const newPassword = String(body.password || body.newPassword || '').trim();
            if (!grant) {
                return withCORS(JSON.stringify({ success: false, error: 'RESET_GRANT_REQUIRED' }), { status: 400 }, appOrigin);
            }
            if (!newPassword || newPassword.length < PASSWORD_MIN_LENGTH) {
                return withCORS(JSON.stringify({ success: false, error: "PASSWORD_TOO_SHORT" }), { status: 400 }, appOrigin);
            }
            try {
                const grantHash = await hashResetSecret(grant);
	                const row = await env.DB.prepare(
	                    `SELECT id, username, expires_at, used_at, grant_hash
	                     FROM ${passwordResetsTable}
	                     WHERE grant_hash = ? LIMIT 1`
	                ).bind(grantHash).first();
                if (!row?.id) {
                    return withCORS(JSON.stringify({ success: false, error: 'RESET_GRANT_INVALID' }), { status: 400 }, appOrigin);
                }
                if (row.used_at) {
                    return withCORS(JSON.stringify({ success: false, error: 'RESET_GRANT_USED' }), { status: 400 }, appOrigin);
                }
                const exp = row.expires_at ? new Date(row.expires_at).getTime() : 0;
                if (!exp || Date.now() > exp) {
                    return withCORS(JSON.stringify({ success: false, error: 'RESET_GRANT_EXPIRED' }), { status: 400 }, appOrigin);
	                }
                const hash = await hashPassword(newPassword);
                const now = new Date().toISOString();
                const changed = await env.DB.batch([
                    env.DB.prepare(
                        `UPDATE ${usersTable}
                         SET password_hash = ?, session_version = COALESCE(session_version, 0) + 1, updated_at = ?
                         WHERE username = ? AND EXISTS (
                           SELECT 1 FROM ${passwordResetsTable}
                           WHERE id = ? AND grant_hash = ? AND used_at IS NULL AND expires_at >= ?
                         )`
                    ).bind(hash, now, row.username, row.id, grantHash, now),
                    env.DB.prepare(
                        `UPDATE ${passwordResetsTable} SET used_at = ?
                         WHERE id = ? AND grant_hash = ? AND used_at IS NULL AND expires_at >= ?`
                    ).bind(now, row.id, grantHash, now)
                ]);
                if (!changed?.[0]?.meta?.changes || !changed?.[1]?.meta?.changes) {
                    return withCORS(JSON.stringify({ success: false, error: 'PASSWORD_RESET_FAILED' }), { status: 409 }, appOrigin);
                }
                await clearAuthFailures(normalizeIdentifier(row.username));
                await logAuthAudit({ action: 'AUTH_PASSWORD_RESET', actor: row.username, role: '', detail: { username: row.username } });
                const updatedUser = await d1.getUserByUsername(row.username);
                const { headers: headersOut, csrf } = await issueAuthCookies({ username: row.username, sv: updatedUser?.sessionVersion || 0 });
                return withCORS(JSON.stringify({ success: true, csrfToken: csrf }), { status: 200, headers: headersOut }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message || String(err) }), { status: 500 }, appOrigin);
            }
        }

        // PUT /auth/profile
        if (url.pathname === "/auth/profile" && request.method === "PUT") {
            if (!sessionUsername) {
                return withCORS(JSON.stringify({ error: "Not authenticated" }), { status: 401 }, appOrigin);
            }
            const body = await request.json().catch(() => ({}));
            const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : undefined;
            const email = typeof body.email === 'string' ? body.email.trim() : undefined;
            const photoUrl = typeof body.photoUrl === 'string' ? body.photoUrl : undefined;
            const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : undefined;
            const newPassword = typeof body.newPassword === 'string' ? body.newPassword : undefined;
            const newUsername = typeof body.newUsername === 'string' ? body.newUsername.trim() : undefined;

            try {
                if (photoUrl !== undefined && photoUrl.length > MAX_PROFILE_PHOTO_URL_CHARS) {
                    return withCORS(
                        JSON.stringify({
                            success: false,
                            error: "Foto muito grande para salvar no cadastro. Tente uma imagem menor."
                        }),
                        { status: 413 },
                        appOrigin
                    );
                }

                const userDb = await d1.getUserByUsername(sessionUsername);
                if (!isCurrentSession(userDb)) {
                    return withCORS(
                        JSON.stringify({ error: "Not authenticated" }),
                        { status: 401, headers: deleteAuthCookies() },
                        appOrigin
                    );
                }

                const isChangingSensitive = !!(newPassword?.trim() || newUsername?.trim());
                let passwordHash = null;

                if (isChangingSensitive) {
                    if (!currentPassword) {
                        return withCORS(JSON.stringify({ error: "Current password required" }), { status: 400 }, appOrigin);
                    }
                    const ok = (await verifyPassword(currentPassword, userDb.passwordHash || '')).ok;
                    if (!ok) {
                        return withCORS(JSON.stringify({ error: "Invalid current password" }), { status: 401 }, appOrigin);
                    }
                }

                if (newUsername) {
                    if (!validateUsername(newUsername)) {
                        return withCORS(JSON.stringify({ error: "Invalid username" }), { status: 400 }, appOrigin);
                    }
                }

                if (newPassword && newPassword.trim() && newPassword.trim().length < PASSWORD_MIN_LENGTH) {
                    return withCORS(JSON.stringify({ error: 'PASSWORD_TOO_SHORT' }), { status: 400 }, appOrigin);
                }
                if (newPassword && newPassword.trim()) {
                    passwordHash = await hashPassword(newPassword);
                }

                const updated = await d1.updateUserProfile(env, sessionUsername, {
                    displayName,
                    email,
                    photoUrl,
                    passwordHash,
                    newUsername,
                });
                if (!updated.ok) {
                    const code = String(updated.error || '');
                    const status =
                        code === 'USERNAME_TAKEN' ? 409
                        : code === 'USER_NOT_FOUND' ? 404
                        : updated.status || 400;
                    return withCORS(JSON.stringify({ success: false, error: updated.error || 'Profile update error' }), { status }, appOrigin);
                }

                const mustReissueSession = Boolean(passwordHash || (updated.username && updated.username !== sessionUsername));
                let currentUser = updated.user || null;
                if (mustReissueSession) {
                    const currentUsername = updated.username || sessionUsername;
                    if (passwordHash) {
                    await env.DB.prepare(
                        `UPDATE ${usersTable} SET session_version = COALESCE(session_version, 0) + 1 WHERE username = ?`
                    ).bind(currentUsername).run();
                    }
                    currentUser = await d1.getUserByUsername(currentUsername);
                }

                const outUser = currentUser;
                const responseUser = outUser
                    ? {
                        name: outUser.displayName || outUser.username,
                        displayName: outUser.displayName || outUser.username,
                        username: outUser.username,
                        email: outUser.email,
                        role: outUser.role || "CONSULTOR",
                        photoUrl: outUser.photoUrl,
                        allowedUnits: outUser.allowedUnits || [],
                        allowedModules: outUser.allowedModules || [],
                    }
                    : null;

                let headersOut;
                let csrfTokenOut;
                if (mustReissueSession) {
                    const issued = await issueAuthCookies({ username: updated.username || sessionUsername, sv: currentUser?.sessionVersion || 0 });
                    headersOut = issued.headers;
                    csrfTokenOut = issued.csrf;
                }
                const csrfToken = csrfTokenOut || cookies.csrfToken || sessionCsrf || null;
                return withCORS(
                    JSON.stringify({ success: true, user: responseUser, csrfToken }),
                    { status: 200, headers: headersOut },
                    appOrigin
                );
            } catch (err) {
                return withCORS(JSON.stringify({ error: `Profile update error: ${err.message}` }), { status: 500 }, appOrigin);
            }
        }

        // POST /auth/logout
        if (url.pathname === "/auth/logout" && request.method === "POST") {
            return withCORS(JSON.stringify({ success: true }), { status: 200, headers: deleteAuthCookies() }, appOrigin);
        }

        return null;
    }

    // D1-only: legacy Sheets auth is intentionally disabled.
    return withCORS(JSON.stringify({ success: false, error: "D1_ONLY" }), { status: 503 }, appOrigin);

}
