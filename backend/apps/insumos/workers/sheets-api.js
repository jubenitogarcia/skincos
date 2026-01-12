/**
 * Google Sheets API helper for bidirectional sync
 * Requires service account credentials stored in Cloudflare secrets
 */

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const sheetIdCache = new Map();

/**
 * Base64 URL encoding helpers for Workers environment
 */
function stringToBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function arrayBufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Get OAuth2 token from service account credentials
 */
async function getAccessToken(clientEmail, privateKey) {
    // Clean up the private key - remove extra quotes and ensure proper format
    let cleanKey = privateKey.trim();
    if (cleanKey.startsWith('"')) cleanKey = cleanKey.slice(1);
    if (cleanKey.endsWith('"')) cleanKey = cleanKey.slice(0, -1);

    const jwtHeader = stringToBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const jwtClaimSet = {
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
    };
    const jwtClaimSetEncoded = stringToBase64Url(JSON.stringify(jwtClaimSet));

    // Sign JWT with private key
    const data = `${jwtHeader}.${jwtClaimSetEncoded}`;
    const key = await crypto.subtle.importKey(
        'pkcs8',
        pemToArrayBuffer(cleanKey),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
    const jwt = `${data}.${arrayBufferToBase64Url(signature)}`;

    // Exchange JWT for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        }),
    });

    if (!tokenResponse.ok) {
        throw new Error(`Token fetch failed: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
}

function pemToArrayBuffer(pem) {
    // Handle escaped newlines
    let cleanPem = pem.replace(/\\n/g, '\n');
    const b64 = cleanPem
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\s/g, '');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Read data from Google Sheets
 */
export async function readSheet(spreadsheetId, range, accessToken) {
    const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
        throw new Error(`Sheets read failed: ${response.status}`);
    }

    const data = await response.json();
    return data.values || [];
}

export async function getSpreadsheetMeta(spreadsheetId, accessToken) {
    const url = `${SHEETS_API_BASE}/${spreadsheetId}?fields=sheets(properties(sheetId,title))`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
        throw new Error(`Sheets meta failed: ${response.status}`);
    }
    return await response.json();
}

export async function ensureSheetExists(spreadsheetId, sheetName, accessToken) {
    const cacheKey = `${spreadsheetId}:${sheetName.toLowerCase()}`;
    if (sheetIdCache.has(cacheKey)) return sheetIdCache.get(cacheKey);

    const meta = await getSpreadsheetMeta(spreadsheetId, accessToken);
    const sheets = meta?.sheets || [];
    const found = sheets.find((s) => (s?.properties?.title || '').toLowerCase() === sheetName.toLowerCase());
    if (found?.properties?.sheetId !== undefined) {
        sheetIdCache.set(cacheKey, found.properties.sheetId);
        return found.properties.sheetId;
    }

    const url = `${SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            requests: [
                {
                    addSheet: {
                        properties: {
                            title: sheetName,
                        },
                    },
                },
            ],
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sheets addSheet failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const sheetId = data?.replies?.[0]?.addSheet?.properties?.sheetId;
    if (sheetId === undefined) {
        throw new Error('Sheets addSheet failed: missing sheetId');
    }
    sheetIdCache.set(cacheKey, sheetId);
    return sheetId;
}

/**
 * Write data to Google Sheets (append or update)
 */
export async function writeSheet(spreadsheetId, range, values, accessToken, method = 'UPDATE') {
    const isAppend = method.toUpperCase() === 'APPEND';
    const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:${method.toLowerCase()}?valueInputOption=USER_ENTERED`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            values,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sheets write failed: ${response.status} - ${errorText}`);
    }

    return await response.json();
}

/**
 * Update specific cells in Google Sheets
 */
export async function batchUpdate(spreadsheetId, updates, accessToken) {
    const url = `${SHEETS_API_BASE}/${spreadsheetId}/values:batchUpdate`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            valueInputOption: 'USER_ENTERED',
            data: updates,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sheets batch update failed: ${response.status} - ${errorText}`);
    }

    return await response.json();
}

/**
 * Delete rows from Google Sheets
 */
export async function deleteRows(spreadsheetId, sheetId, startIndex, endIndex, accessToken) {
    const url = `${SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            requests: [
                {
                    deleteDimension: {
                        range: {
                            sheetId,
                            dimension: 'ROWS',
                            startIndex,
                            endIndex,
                        },
                    },
                },
            ],
        }),
    });

    if (!response.ok) {
        throw new Error(`Sheets delete failed: ${response.status}`);
    }

    return await response.json();
}

/**
 * Main function to get authenticated access token
 */
export async function authenticate(clientEmail, privateKey) {
    return await getAccessToken(clientEmail, privateKey);
}
