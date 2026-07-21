import { getCloudflareContext } from "@opennextjs/cloudflare";

type D1PreparedStatement = {
    bind: (...values: unknown[]) => D1PreparedStatement;
    first: <T = unknown>() => Promise<T | null>;
    run: () => Promise<unknown>;
};

type D1DatabaseLike = {
    prepare: (query: string) => D1PreparedStatement;
};

type CloudflareEnv = {
    BOOKING_DB?: D1DatabaseLike;
};

const PROVIDER = "google_business_profile";
const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
let ensured = false;

function toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function fromHex(value: string): Uint8Array {
    if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("missing_oauth_encryption_key");
    return Uint8Array.from(value.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16)));
}

function getEncryptionKeyRaw(): Uint8Array {
    return fromHex((process.env.GBP_OAUTH_ENCRYPTION_KEY ?? "").trim());
}

async function getDb(): Promise<D1DatabaseLike | null> {
    const context = await getCloudflareContext({ async: true });
    const env = context.env as CloudflareEnv;
    const db = env.BOOKING_DB ?? null;
    if (!db) return null;

    if (!ensured) {
        await db
            .prepare(
                `CREATE TABLE IF NOT EXISTS gbp_oauth_authorizations (
                    id TEXT PRIMARY KEY,
                    state TEXT NOT NULL UNIQUE,
                    expires_at_ms INTEGER NOT NULL,
                    completed_at_ms INTEGER,
                    created_at_ms INTEGER NOT NULL
                );`,
            )
            .run();
        await db
            .prepare(
                `CREATE TABLE IF NOT EXISTS gbp_oauth_refresh_tokens (
                    provider TEXT PRIMARY KEY,
                    encrypted_refresh_token TEXT NOT NULL,
                    iv TEXT NOT NULL,
                    updated_at_ms INTEGER NOT NULL
                );`,
            )
            .run();
        ensured = true;
    }

    return db;
}

export async function createGoogleGbpOAuthAuthorization(nowMs = Date.now()): Promise<{ id: string; state: string }> {
    const db = await getDb();
    if (!db) throw new Error("gbp_oauth_db_unavailable");
    const id = `gbp_oauth_${crypto.randomUUID()}`;
    const state = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
    await db
        .prepare(
            "INSERT INTO gbp_oauth_authorizations (id, state, expires_at_ms, created_at_ms) VALUES (?, ?, ?, ?);",
        )
        .bind(id, state, nowMs + AUTHORIZATION_TTL_MS, nowMs)
        .run();
    return { id, state };
}

export async function ensurePendingGoogleGbpOAuthAuthorization(state: string, nowMs = Date.now()): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("gbp_oauth_db_unavailable");
    const row = await db
        .prepare(
            "SELECT id FROM gbp_oauth_authorizations WHERE state = ? AND completed_at_ms IS NULL AND expires_at_ms >= ? LIMIT 1;",
        )
        .bind(state, nowMs)
        .first<{ id: string }>();
    if (!row) throw new Error("invalid_or_expired_oauth_authorization");
}

async function encryptRefreshToken(refreshToken: string): Promise<{ encrypted: string; iv: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey("raw", getEncryptionKeyRaw(), "AES-GCM", false, ["encrypt"]);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(refreshToken));
    return { encrypted: toBase64Url(new Uint8Array(encrypted)), iv: toBase64Url(iv) };
}

async function decryptRefreshToken(encrypted: string, iv: string): Promise<string> {
    const key = await crypto.subtle.importKey("raw", getEncryptionKeyRaw(), "AES-GCM", false, ["decrypt"]);
    const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(iv) }, key, fromBase64Url(encrypted));
    return new TextDecoder().decode(clear).trim();
}

export async function storeGoogleGbpRefreshToken(params: { state: string; refreshToken: string; nowMs?: number }): Promise<void> {
    const refreshToken = params.refreshToken.trim();
    if (!refreshToken) throw new Error("missing_google_refresh_token");
    const db = await getDb();
    if (!db) throw new Error("gbp_oauth_db_unavailable");
    const nowMs = params.nowMs ?? Date.now();
    await ensurePendingGoogleGbpOAuthAuthorization(params.state, nowMs);
    const cipher = await encryptRefreshToken(refreshToken);

    await db
        .prepare(
            `INSERT INTO gbp_oauth_refresh_tokens (provider, encrypted_refresh_token, iv, updated_at_ms)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(provider) DO UPDATE SET
                encrypted_refresh_token = excluded.encrypted_refresh_token,
                iv = excluded.iv,
                updated_at_ms = excluded.updated_at_ms;`,
        )
        .bind(PROVIDER, cipher.encrypted, cipher.iv, nowMs)
        .run();
    await db
        .prepare("UPDATE gbp_oauth_authorizations SET completed_at_ms = ? WHERE state = ? AND completed_at_ms IS NULL;")
        .bind(nowMs, params.state)
        .run();
}

export async function getStoredGoogleGbpRefreshToken(): Promise<string | null> {
    const db = await getDb();
    if (!db) return null;
    const row = await db
        .prepare("SELECT encrypted_refresh_token, iv FROM gbp_oauth_refresh_tokens WHERE provider = ? LIMIT 1;")
        .bind(PROVIDER)
        .first<{ encrypted_refresh_token: string; iv: string }>();
    if (!row) return null;
    const refreshToken = await decryptRefreshToken(row.encrypted_refresh_token, row.iv);
    return refreshToken || null;
}
