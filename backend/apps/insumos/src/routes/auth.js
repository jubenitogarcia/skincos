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
}) {
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

            if (!usernameInput || !password) {
                return withCORS(JSON.stringify({ error: "Username and password required" }), { status: 400 }, appOrigin);
            }

            try {
                const userDb = await d1.getUserByIdentifier(usernameInput);
                if (!userDb) {
                    return withCORS(JSON.stringify({ error: "Invalid credentials" }), { status: 401 }, appOrigin);
                }
                if (!userDb.ativo) {
                    return withCORS(JSON.stringify({ error: "User inactive" }), { status: 403 }, appOrigin);
                }
                if (!userDb.passwordHash) {
                    return withCORS(JSON.stringify({ error: "Password not set" }), { status: 401 }, appOrigin);
                }
                const ok = await bcrypt.compare(password, userDb.passwordHash);
                if (!ok) {
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
                const { headers: headersOut, csrf } = await issueAuthCookies({ username: userDb.username });
                return withCORS(JSON.stringify({ success: true, user, csrfToken: csrf }), { status: 200, headers: headersOut }, appOrigin);
            } catch (err) {
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

        if (!usernameInput || !password) {
            return withCORS(JSON.stringify({ error: "Username and password required" }), { status: 400 }, appOrigin);
        }

        try {
            const userRows = await readSheet(spreadsheetId, userRange, accessToken);
            const users = parseUsers(userRows);
            const identifier = usernameInput.toLowerCase();
            const userDb = users.find((u) => {
                const uName = (u.username || '').toLowerCase();
                const uEmail = (u.email || '').toLowerCase();
                return uName === identifier || (uEmail && uEmail === identifier);
            });
            if (!userDb) {
                return withCORS(JSON.stringify({ error: "Invalid credentials" }), { status: 401 }, appOrigin);
            }
            if (!userDb.ativo) {
                return withCORS(JSON.stringify({ error: "User inactive" }), { status: 403 }, appOrigin);
            }
            if (!userDb.passwordHash) {
                return withCORS(JSON.stringify({ error: "Password not set" }), { status: 401 }, appOrigin);
            }

            const ok = await bcrypt.compare(password, userDb.passwordHash);
            if (!ok) {
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
            const { headers: headersOut, csrf } = await issueAuthCookies({ username: userDb.username });
            return withCORS(JSON.stringify({ success: true, user, csrfToken: csrf }), { status: 200, headers: headersOut }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ error: `Login error: ${err.message}` }), { status: 500 }, appOrigin);
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
