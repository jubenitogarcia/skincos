// @ts-nocheck
// Auth routes extracted from the main worker router.

export async function handleAuthRoutes({
    request,
    url,
    env,
    appOrigin,
    withCORS,
    spreadsheetId,
    userRange,
    accessToken,
    sessionUsername,
    sessionCsrf,
    cookies,
    readSheet,
    parseUsers,
    bcrypt,
    issueAuthCookies,
    deleteAuthCookies,
    validateUsername,
    batchUpdate,
    toA1Col,
    buildUserResponseFromSheetRow,
    MAX_PROFILE_PHOTO_URL_CHARS,
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
                spreadsheetId,
                accessToken,
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

        const sha256Hex = async (input) => {
            const data = new TextEncoder().encode(String(input || ''));
            const hash = await crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(hash))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
        };

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

        const suggestUsername = (name, email) => {
            const local = String(email || '').split('@')[0] || '';
            const base = slugifyUsername(local) || slugifyUsername(name) || 'user';
            return base.length >= 3 ? base : `${base}${Math.floor(100 + Math.random() * 900)}`;
        };

        const ensureUniqueUsername = async (base) => {
            const b = String(base || '').trim();
            if (!b) return null;
            // 1) try base
            const taken0 = await env.DB.prepare('SELECT 1 FROM insumos_users WHERE LOWER(username)=LOWER(?) LIMIT 1').bind(b).first();
            if (!taken0) return b;
            // 2) add numeric suffixes
            for (let i = 0; i < 20; i++) {
                const suffix = String(Math.floor(10 + Math.random() * 90));
                const candidate = `${b.slice(0, Math.max(0, 40 - (suffix.length + 1)))}-${suffix}`.slice(0, 40);
                const taken = await env.DB.prepare('SELECT 1 FROM insumos_users WHERE LOWER(username)=LOWER(?) LIMIT 1').bind(candidate).first();
                if (!taken) return candidate;
            }
            return null;
        };

        // GET /auth/me
        if (url.pathname === "/auth/me") {
            if (!sessionUsername) {
                return withCORS(JSON.stringify({ error: "Not authenticated" }), { status: 401 }, appOrigin);
            }
            try {
                const userDb = await d1.getUserByUsername(sessionUsername);
                if (!userDb || !userDb.ativo) {
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
                };
                const { headers: headersOut, csrf } = await issueAuthCookies({ username: userDb.username });
                return withCORS(JSON.stringify({ success: true, user, csrfToken: csrf }), { status: 200, headers: headersOut }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ error: `Auth error: ${err.message}` }), { status: 500 }, appOrigin);
            }
        }

        // POST /auth/refresh
        if (url.pathname === "/auth/refresh" && request.method === "POST") {
            if (!sessionUsername) {
                return withCORS(JSON.stringify({ error: "Not authenticated" }), { status: 401 }, appOrigin);
            }
            try {
                const userDb = await d1.getUserByUsername(sessionUsername);
                if (!userDb || !userDb.ativo) {
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
                };
                const { headers: headersOut, csrf } = await issueAuthCookies({ username: userDb.username });
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
                const ok = await bcrypt.compare(password, userDb.passwordHash);
                if (!ok) {
                    await recordAuthFailure(identifier, 'INVALID_CREDENTIALS');
                    await logAuthAudit({ action: 'AUTH_LOGIN_FAILED', actor: identifier, role: userDb.role || '', detail: { reason: 'INVALID_CREDENTIALS', username: userDb.username } });
                    return withCORS(JSON.stringify({ error: "Invalid credentials" }), { status: 401 }, appOrigin);
                }
                const user = {
                    name: userDb.displayName || userDb.username,
                    displayName: userDb.displayName || userDb.username,
                    username: userDb.username,
                    email: userDb.email,
                    role: userDb.role || "CONSULTOR",
                    photoUrl: userDb.photoUrl,
                    allowedUnits: userDb.allowedUnits || [],
                };
                await clearAuthFailures(identifier);
                await logAuthAudit({ action: 'AUTH_LOGIN_SUCCESS', actor: userDb.username, role: userDb.role || '', detail: { username: userDb.username } });
                const { headers: headersOut, csrf } = await issueAuthCookies({ username: userDb.username });
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
                if (!password || password.length < 6) {
                    return withCORS(JSON.stringify({ success: false, error: "PASSWORD_TOO_SHORT" }), { status: 400 }, appOrigin);
                }

                const inviteHash = await sha256Hex(inviteToken);
                const now = new Date().toISOString();

                const invite = await env.DB.prepare(
                    `SELECT id, role, allowed_units_json, max_uses, uses_count, expires_at, revoked
                     FROM insumos_invites
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
                const hash = await bcrypt.hash(password, 10);

                await env.DB.prepare(
                    `INSERT INTO insumos_users
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

                await env.DB.prepare(
                    `UPDATE insumos_invites
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
                    }
                    : {
                        name,
                        displayName: name,
                        username: candidate,
                        email,
                        role,
                        photoUrl: '',
                        allowedUnits,
                    };

                const { headers: headersOut, csrf } = await issueAuthCookies({ username: candidate });
                return withCORS(JSON.stringify({ success: true, user, csrfToken: csrf }), { status: 201, headers: headersOut }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message || String(err) }), { status: 500 }, appOrigin);
            }
        }

        // POST /auth/password/request
        if (url.pathname === "/auth/password/request" && request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const identifierRaw = String(body.email || body.username || body.user || '').trim();
            const identifier = normalizeIdentifier(identifierRaw);
            if (!identifier) {
                return withCORS(JSON.stringify({ success: false, error: "IDENTIFIER_REQUIRED" }), { status: 400 }, appOrigin);
            }
            try {
                const userDb = await d1.getUserByIdentifier(identifierRaw);
                if (userDb && userDb.ativo) {
                    const token = crypto.randomUUID();
                    const tokenHash = await sha256Hex(token);
                    const ttlMinutes = Math.max(5, toInt(env?.AUTH_RESET_TTL_MINUTES, 30));
                    const now = new Date();
                    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
                    await env.DB.prepare(
                        `DELETE FROM insumos_password_resets WHERE username = ? OR (email IS NOT NULL AND email = ?)`
                    )
                        .bind(userDb.username, userDb.email || '')
                        .run();
                    await env.DB.prepare(
                        `INSERT INTO insumos_password_resets (token_hash, username, email, created_at, expires_at)
                         VALUES (?, ?, ?, ?, ?)`
                    )
                        .bind(tokenHash, userDb.username, userDb.email || '', now.toISOString(), expiresAt)
                        .run();
                    await logAuthAudit({ action: 'AUTH_PASSWORD_RESET_REQUEST', actor: userDb.username, role: userDb.role || '', detail: { username: userDb.username } });
                    const allowTokenReturn = String(env?.AUTH_RESET_RETURN_TOKEN || '').trim().toLowerCase() === 'true';
                    if (allowTokenReturn) {
                        return withCORS(JSON.stringify({ success: true, resetToken: token, expiresAt }), { status: 200 }, appOrigin);
                    }
                }
                return withCORS(JSON.stringify({ success: true }), { status: 200 }, appOrigin);
            } catch (err) {
                return withCORS(JSON.stringify({ success: false, error: err.message || String(err) }), { status: 500 }, appOrigin);
            }
        }

        // POST /auth/password/reset
        if (url.pathname === "/auth/password/reset" && request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const token = String(body.token || '').trim();
            const newPassword = String(body.password || body.newPassword || '').trim();
            if (!token) {
                return withCORS(JSON.stringify({ success: false, error: "TOKEN_REQUIRED" }), { status: 400 }, appOrigin);
            }
            if (!newPassword || newPassword.length < 6) {
                return withCORS(JSON.stringify({ success: false, error: "PASSWORD_TOO_SHORT" }), { status: 400 }, appOrigin);
            }
            try {
                const tokenHash = await sha256Hex(token);
                const row = await env.DB.prepare(
                    `SELECT id, username, expires_at, used_at
                     FROM insumos_password_resets
                     WHERE token_hash = ?
                     LIMIT 1`
                )
                    .bind(tokenHash)
                    .first();
                if (!row?.id) {
                    return withCORS(JSON.stringify({ success: false, error: "TOKEN_INVALID" }), { status: 400 }, appOrigin);
                }
                if (row.used_at) {
                    return withCORS(JSON.stringify({ success: false, error: "TOKEN_USED" }), { status: 400 }, appOrigin);
                }
                const exp = row.expires_at ? new Date(row.expires_at).getTime() : 0;
                if (!exp || Date.now() > exp) {
                    return withCORS(JSON.stringify({ success: false, error: "TOKEN_EXPIRED" }), { status: 400 }, appOrigin);
                }
                const hash = await bcrypt.hash(newPassword, 10);
                const updated = await d1.updateUserProfile(row.username, { passwordHash: hash });
                if (!updated?.ok) {
                    return withCORS(JSON.stringify({ success: false, error: updated?.error || 'PASSWORD_RESET_FAILED' }), { status: updated?.status || 500 }, appOrigin);
                }
                await env.DB.prepare(
                    `UPDATE insumos_password_resets SET used_at = ? WHERE id = ?`
                )
                    .bind(new Date().toISOString(), row.id)
                    .run();
                await clearAuthFailures(normalizeIdentifier(row.username));
                await logAuthAudit({ action: 'AUTH_PASSWORD_RESET', actor: row.username, role: '', detail: { username: row.username } });
                const { headers: headersOut, csrf } = await issueAuthCookies({ username: row.username });
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
                if (!userDb || !userDb.ativo) {
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
                    const ok = await bcrypt.compare(currentPassword, userDb.passwordHash || '');
                    if (!ok) {
                        return withCORS(JSON.stringify({ error: "Invalid current password" }), { status: 401 }, appOrigin);
                    }
                }

                if (newUsername) {
                    if (!validateUsername(newUsername)) {
                        return withCORS(JSON.stringify({ error: "Invalid username" }), { status: 400 }, appOrigin);
                    }
                }

                if (newPassword && newPassword.trim()) {
                    passwordHash = await bcrypt.hash(newPassword, 10);
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

                const outUser = updated.user || null;
                const responseUser = outUser
                    ? {
                        name: outUser.displayName || outUser.username,
                        displayName: outUser.displayName || outUser.username,
                        username: outUser.username,
                        email: outUser.email,
                        role: outUser.role || "CONSULTOR",
                        photoUrl: outUser.photoUrl,
                        allowedUnits: outUser.allowedUnits || [],
                    }
                    : null;

                let headersOut;
                let csrfTokenOut;
                if (updated.username && updated.username !== sessionUsername) {
                    const issued = await issueAuthCookies({ username: updated.username });
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

    // GET /auth/me
    if (url.pathname === "/auth/me") {
        if (!sessionUsername) {
            return withCORS(JSON.stringify({ error: "Not authenticated" }), { status: 401 }, appOrigin);
        }
        try {
            const userRows = await readSheet(spreadsheetId, userRange, accessToken);
            const users = parseUsers(userRows);
            const userDb = users.find((u) => u.username.toLowerCase() === sessionUsername.toLowerCase());
            if (!userDb || !userDb.ativo) {
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
            };
            const { headers: headersOut, csrf } = await issueAuthCookies({ username: userDb.username });
            return withCORS(JSON.stringify({ success: true, user, csrfToken: csrf }), { status: 200, headers: headersOut }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ error: `Auth error: ${err.message}` }), { status: 500 }, appOrigin);
        }
    }

    // POST /auth/refresh
    if (url.pathname === "/auth/refresh" && request.method === "POST") {
        if (!sessionUsername) {
            return withCORS(JSON.stringify({ error: "Not authenticated" }), { status: 401 }, appOrigin);
        }
        try {
            const userRows = await readSheet(spreadsheetId, userRange, accessToken);
            const users = parseUsers(userRows);
            const userDb = users.find((u) => u.username.toLowerCase() === sessionUsername.toLowerCase());
            if (!userDb || !userDb.ativo) {
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
            };
            const { headers: headersOut, csrf } = await issueAuthCookies({ username: userDb.username });
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
            const userRows = await readSheet(spreadsheetId, userRange, accessToken);
            const users = parseUsers(userRows);
            const userDb = users.find((u) => {
                const uName = (u.username || '').toLowerCase();
                const uEmail = (u.email || '').toLowerCase();
                return uName === identifier || (uEmail && uEmail === identifier);
            });
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

            const ok = await bcrypt.compare(password, userDb.passwordHash);
            if (!ok) {
                await recordAuthFailure(identifier, 'INVALID_CREDENTIALS');
                await logAuthAudit({ action: 'AUTH_LOGIN_FAILED', actor: identifier, role: userDb.role || '', detail: { reason: 'INVALID_CREDENTIALS', username: userDb.username } });
                return withCORS(JSON.stringify({ error: "Invalid credentials" }), { status: 401 }, appOrigin);
            }

            const user = {
                name: userDb.displayName || userDb.username,
                displayName: userDb.displayName || userDb.username,
                username: userDb.username,
                email: userDb.email,
                role: userDb.role || "CONSULTOR",
                photoUrl: userDb.photoUrl,
                allowedUnits: userDb.allowedUnits || [],
            };
            await clearAuthFailures(identifier);
            await logAuthAudit({ action: 'AUTH_LOGIN_SUCCESS', actor: userDb.username, role: userDb.role || '', detail: { username: userDb.username } });
            const { headers: headersOut, csrf } = await issueAuthCookies({ username: userDb.username });
            return withCORS(JSON.stringify({ success: true, user, csrfToken: csrf }), { status: 200, headers: headersOut }, appOrigin);
        } catch (err) {
            await recordAuthFailure(identifier, 'LOGIN_ERROR');
            await logAuthAudit({ action: 'AUTH_LOGIN_FAILED', actor: identifier, role: '', detail: { reason: 'LOGIN_ERROR' } });
            return withCORS(JSON.stringify({ error: `Login error: ${err.message}` }), { status: 500 }, appOrigin);
        }
    }

    // POST /auth/password/request
    if (url.pathname === "/auth/password/request" && request.method === "POST") {
        return withCORS(JSON.stringify({ success: false, error: "RESET_UNAVAILABLE" }), { status: 501 }, appOrigin);
    }

    // POST /auth/password/reset
    if (url.pathname === "/auth/password/reset" && request.method === "POST") {
        return withCORS(JSON.stringify({ success: false, error: "RESET_UNAVAILABLE" }), { status: 501 }, appOrigin);
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

            const userRows = await readSheet(spreadsheetId, userRange, accessToken);
            if (!userRows.length) {
                return withCORS(JSON.stringify({ error: "User sheet empty" }), { status: 500 }, appOrigin);
            }
            const headers = userRows[0];
            const headersLower = headers.map((h) => (h || '').toLowerCase());
            const headerMap = Object.fromEntries(headersLower.map((h, i) => [h, i]));
            const usernameCol = headerMap['username'];
            if (usernameCol === undefined) {
                return withCORS(JSON.stringify({ error: "User sheet missing USERNAME column" }), { status: 500 }, appOrigin);
            }

            const rowIndex = userRows
                .slice(1)
                .findIndex((r) => ((r[usernameCol] || '').toString().trim().toLowerCase() === sessionUsername.toLowerCase()));
            if (rowIndex === -1) {
                return withCORS(
                    JSON.stringify({ error: "Not authenticated" }),
                    { status: 401, headers: deleteAuthCookies() },
                    appOrigin
                );
            }

            const absoluteRowNumber = rowIndex + 2; // +1 header +1 for 1-based
            const currentRow = [...userRows[rowIndex + 1]];
            const currentUsernameValue = (currentRow[usernameCol] || '').toString().trim();

            const passwordHashCol = headerMap['password_hash'];
            const ativoCol = headerMap['ativo'];
            if (ativoCol !== undefined) {
                const ativoVal = `${currentRow[ativoCol] ?? ''}`.toUpperCase();
                if (ativoVal === 'FALSE' || ativoVal === '0') {
                    return withCORS(JSON.stringify({ error: "User inactive" }), { status: 403 }, appOrigin);
                }
            }

            // If changing password or username, require current password and validate
            if ((newPassword || newUsername) && passwordHashCol !== undefined) {
                const currentHash = (currentRow[passwordHashCol] || '').toString();
                if (!currentPassword) {
                    return withCORS(JSON.stringify({ error: "Current password required" }), { status: 400 }, appOrigin);
                }
                const ok = await bcrypt.compare(currentPassword, currentHash);
                if (!ok) {
                    return withCORS(JSON.stringify({ error: "Invalid current password" }), { status: 401 }, appOrigin);
                }
            }

            if (newUsername) {
                // If it is the same username, ignore change
                if (newUsername.toLowerCase() !== currentUsernameValue.toLowerCase()) {
                    if (!validateUsername(newUsername)) {
                        return withCORS(JSON.stringify({ error: "Invalid username" }), { status: 400 }, appOrigin);
                    }
                    const taken = userRows.slice(1).some((r, idx) => {
                        if (idx === rowIndex) return false;
                        return ((r[usernameCol] || '').toString().trim().toLowerCase() === newUsername.toLowerCase());
                    });
                    if (taken) {
                        return withCORS(JSON.stringify({ error: "Username already in use" }), { status: 409 }, appOrigin);
                    }
                    currentRow[usernameCol] = newUsername;
                }
                // if same username, skip touching username cell
            }

            const displayNameCol = headerMap['display_name'];
            if (displayNameCol !== undefined && displayName !== undefined) currentRow[displayNameCol] = displayName;
            const emailCol = headerMap['email'];
            if (emailCol !== undefined && email !== undefined) currentRow[emailCol] = email;
            const photoCol = headerMap['photo_url'];
            if (photoCol !== undefined && photoUrl !== undefined) currentRow[photoCol] = photoUrl;
            const updatedAtCol = headerMap['updated_at'];
            if (updatedAtCol !== undefined) currentRow[updatedAtCol] = new Date().toISOString();

            if (newPassword && passwordHashCol !== undefined) {
                currentRow[passwordHashCol] = await bcrypt.hash(newPassword, 10);
            }

            const sheetName = userRange.split('!')[0] || 'Usuarios';
            const maxColIndex = Math.max(
                usernameCol,
                headerMap['display_name'] ?? 0,
                headerMap['email'] ?? 0,
                headerMap['role'] ?? 0,
                headerMap['ativo'] ?? 0,
                headerMap['created_at'] ?? 0,
                headerMap['updated_at'] ?? 0,
                headerMap['password_hash'] ?? 0,
                headerMap['photo_url'] ?? 0
            );
            const range = `${sheetName}!A${absoluteRowNumber}:${toA1Col(maxColIndex)}${absoluteRowNumber}`;
            const rowToWrite = Array.from({ length: maxColIndex + 1 }, (_, i) => currentRow[i] ?? '');
            await batchUpdate(spreadsheetId, [{ range, values: [rowToWrite] }], accessToken);

            const user = buildUserResponseFromSheetRow(rowToWrite, headerMap);
            const finalUsername = user.username || (newUsername || sessionUsername);
            let headersOut;
            let csrfTokenOut;
            if (finalUsername && finalUsername !== sessionUsername) {
                const issued = await issueAuthCookies({ username: finalUsername });
                headersOut = issued.headers;
                csrfTokenOut = issued.csrf;
            }
            const csrfToken = csrfTokenOut || cookies.csrfToken || sessionCsrf || null;
            return withCORS(
                JSON.stringify({ success: true, user: { ...user, username: finalUsername }, csrfToken }),
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
