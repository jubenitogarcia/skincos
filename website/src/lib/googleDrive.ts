type ServiceAccountJson = {
    client_email: string;
    private_key: string;
    token_uri?: string;
};

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

function base64UrlEncodeFromBytes(bytes: Uint8Array): string {
    let base64: string;
    if (typeof btoa === "function") {
        let binary = "";
        for (const b of bytes) binary += String.fromCharCode(b);
        base64 = btoa(binary);
    } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const buf = (globalThis as any).Buffer?.from?.(bytes);
        if (!buf) throw new Error("No base64 encoder available");
        base64 = buf.toString("base64");
    }

    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeJson(obj: unknown): string {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    return base64UrlEncodeFromBytes(bytes);
}

function utf8ToArrayBuffer(value: string): ArrayBuffer {
    const bytes = new TextEncoder().encode(value);
    const out = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(out).set(bytes);
    return out;
}

function decodePemToPkcs8(pem: string): ArrayBuffer {
    const normalized = pem
        .replace(/\r\n/g, "\n")
        .replace(/-----BEGIN PRIVATE KEY-----/g, "")
        .replace(/-----END PRIVATE KEY-----/g, "")
        .replace(/\n/g, "")
        .trim();

    let bytes: Uint8Array;
    if (typeof atob === "function") {
        const binary = atob(normalized);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const buf = (globalThis as any).Buffer?.from?.(normalized, "base64");
        if (!buf) throw new Error("No base64 decoder available");
        bytes = new Uint8Array(buf);
    }

    const out = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(out).set(bytes);
    return out;
}

function loadServiceAccountFromEnv(): ServiceAccountJson {
    const jsonRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (jsonRaw) {
        try {
            const parsed = JSON.parse(jsonRaw) as ServiceAccountJson;
            if (!parsed.client_email || !parsed.private_key) {
                throw new Error("Invalid GOOGLE_SERVICE_ACCOUNT_JSON");
            }
            return parsed;
        } catch (err) {
            // Wrangler secrets are sometimes pasted with literal newlines inside
            // the quoted `private_key` field, which makes the JSON invalid.
            // As a fallback, extract the fields with a tolerant regex-based parse.
            const clientEmailMatch = jsonRaw.match(/"client_email"\s*:\s*"([^"]+)"/);
            const tokenUriMatch = jsonRaw.match(/"token_uri"\s*:\s*"([^"]+)"/);
            const privateKeyMatch = jsonRaw.match(/"private_key"\s*:\s*"([\s\S]*?)"\s*,\s*"/);

            const client_email = clientEmailMatch?.[1];
            const private_key = privateKeyMatch?.[1];
            const token_uri = tokenUriMatch?.[1];

            if (client_email && private_key) {
                return { client_email, private_key, token_uri };
            }

            const len = jsonRaw.length;
            const hasClientEmail = /"client_email"\s*:/.test(jsonRaw);
            const hasPrivateKey = /"private_key"\s*:/.test(jsonRaw);
            const hasTokenUri = /"token_uri"\s*:/.test(jsonRaw);

            const baseMessage = err instanceof Error ? err.message : "Invalid GOOGLE_SERVICE_ACCOUNT_JSON";
            throw new Error(
                `${baseMessage} (len=${len}, has_client_email=${hasClientEmail}, has_private_key=${hasPrivateKey}, has_token_uri=${hasTokenUri})`,
            );
        }
    }

    const client_email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const private_key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    const token_uri = process.env.GOOGLE_SERVICE_ACCOUNT_TOKEN_URI;

    if (!client_email || !private_key) {
        throw new Error("Missing Google service account env vars");
    }

    return { client_email, private_key, token_uri };
}

let cachedToken: { accessToken: string; exp: number } | null = null;

async function getAccessToken(scope: string): Promise<string> {
    const safetyWindowSeconds = 60;
    const t = nowSeconds();

    if (cachedToken && cachedToken.exp - safetyWindowSeconds > t) {
        return cachedToken.accessToken;
    }

    const sa = loadServiceAccountFromEnv();
    const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";

    const header = { alg: "RS256", typ: "JWT" };
    const iat = t;
    const exp = t + 3600;
    const payload = {
        iss: sa.client_email,
        scope,
        aud: tokenUri,
        iat,
        exp,
    };

    const unsigned = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;

    const key = await crypto.subtle.importKey(
        "pkcs8",
        decodePemToPkcs8(sa.private_key),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
    );

    const signature = await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        key,
        utf8ToArrayBuffer(unsigned),
    );

    const jwt = `${unsigned}.${base64UrlEncodeFromBytes(new Uint8Array(signature))}`;

    const form = new URLSearchParams();
    form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
    form.set("assertion", jwt);

    const resp = await fetch(tokenUri, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
    });

    if (!resp.ok) {
        throw new Error(`Failed to obtain access token (${resp.status})`);
    }

    const data = (await resp.json()) as { access_token: string; expires_in?: number };
    const expiresIn = data.expires_in ?? 3600;

    cachedToken = { accessToken: data.access_token, exp: t + expiresIn };
    return cachedToken.accessToken;
}

export type DriveListItem = {
    id: string;
    name?: string;
    mimeType: string;
};

export async function driveListFolderFiles(folderId: string): Promise<DriveListItem[]> {
    const token = await getAccessToken("https://www.googleapis.com/auth/drive.readonly");

    const q = `('${folderId}' in parents) and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", q);
    url.searchParams.set("pageSize", "200");
    url.searchParams.set("fields", "files(id,name,mimeType)");

    const resp = await fetch(url.toString(), {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
        },
    });

    if (!resp.ok) {
        throw new Error(`Drive list failed (${resp.status})`);
    }

    const data = (await resp.json()) as { files?: DriveListItem[] };
    return data.files ?? [];
}

export async function driveFetchFileMedia(fileId: string, rangeHeader?: string | null): Promise<Response> {
    const token = await getAccessToken("https://www.googleapis.com/auth/drive.readonly");

    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
    };
    if (rangeHeader) headers.Range = rangeHeader;

    return fetch(url, { headers });
}
