// @ts-nocheck
// Auth routes extracted from the main worker router.

export async function handleAuthRoutes({
    request,
    url,
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
}) {
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
        const usernameInput = (body.username || body.user || '').toString().trim();
        const password = (body.password || body.senha || '').toString();

        if (!usernameInput || !password) {
            return withCORS(JSON.stringify({ error: "Username and password required" }), { status: 400 }, appOrigin);
        }

        try {
            const userRows = await readSheet(spreadsheetId, userRange, accessToken);
            const users = parseUsers(userRows);
            const userDb = users.find((u) => u.username.toLowerCase() === usernameInput.toLowerCase());
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
