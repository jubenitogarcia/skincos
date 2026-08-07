import { getRuntimeSecret } from "@/lib/runtimeSecrets";

export const BEAUTY_MOVEMENT_SESSION_COOKIE = "ef_beauty_movement_session";

const TOKEN_MIN_LENGTH = 32;
const TOKEN_MAX_LENGTH = 256;
const MIN_HMAC_SECRET_BYTES = 32;
const AES_256_HEX_LENGTH = 64;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const out = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(out).set(bytes);
    return out;
}

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

function utf8(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function requireCrypto(): Crypto {
    const cryptoObject = (globalThis as unknown as { crypto?: Crypto }).crypto;
    if (!cryptoObject?.subtle || typeof cryptoObject.getRandomValues !== "function") {
        throw new Error("beauty_movement_webcrypto_unavailable");
    }
    return cryptoObject;
}

function requireHmacSecret(secret: string | null | undefined): string {
    const normalized = (secret ?? "").trim();
    if (utf8(normalized).byteLength < MIN_HMAC_SECRET_BYTES) {
        throw new Error("beauty_movement_token_key_unavailable");
    }
    return normalized;
}

function parseAes256HexKey(secret: string | null | undefined): Uint8Array {
    const normalized = (secret ?? "").trim();
    if (!new RegExp(`^[0-9a-f]{${AES_256_HEX_LENGTH}}$`, "i").test(normalized)) {
        throw new Error("beauty_movement_pii_key_unavailable");
    }
    return Uint8Array.from(normalized.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16)));
}

function normalizeToken(value: string | null | undefined): string | null {
    const normalized = (value ?? "").trim();
    if (normalized.length < TOKEN_MIN_LENGTH || normalized.length > TOKEN_MAX_LENGTH) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(normalized)) return null;
    return normalized;
}

function normalizedOrigin(value: string | null | undefined): string | null {
    const raw = (value ?? "").trim();
    if (!raw) return null;
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
        if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
        return parsed.origin;
    } catch {
        return null;
    }
}

function processEnv(name: string): string {
    if (typeof process === "undefined") return "";
    return (process.env[name] ?? "").trim();
}

function normalizeAllowedOrigins(candidates: readonly string[]): string[] {
    return [...new Set(candidates.map(normalizedOrigin).filter((value): value is string => Boolean(value)))];
}

/**
 * Synchronous resolver used by tests and non-Worker tooling. The Worker path
 * must use the runtime resolver below because Cloudflare bindings are not
 * exposed through process.env.
 */
export function resolveBeautyMovementAllowedOrigins(): string[] {
    return normalizeAllowedOrigins([
        processEnv("NEXT_PUBLIC_SITE_URL"),
        ...processEnv("BEAUTY_MOVEMENT_ALLOWED_ORIGINS").split(","),
    ]);
}

/**
 * Resolves the same allowlist from both Node and Cloudflare runtime values.
 * Keeping this asynchronous makes mutation endpoints fail closed when a Worker
 * deployment has not explicitly supplied a compatible origin configuration.
 */
export async function resolveBeautyMovementAllowedOriginsAtRuntime(): Promise<string[]> {
    const [siteUrl, configuredOrigins] = await Promise.all([
        getRuntimeSecret("NEXT_PUBLIC_SITE_URL"),
        getRuntimeSecret("BEAUTY_MOVEMENT_ALLOWED_ORIGINS"),
    ]);
    return normalizeAllowedOrigins([
        ...resolveBeautyMovementAllowedOrigins(),
        siteUrl,
        ...configuredOrigins.split(","),
    ]);
}

export function isBeautyMovementOriginAllowed(
    origin: string | null | undefined,
    allowedOrigins: readonly string[] = resolveBeautyMovementAllowedOrigins(),
): boolean {
    const normalized = normalizedOrigin(origin);
    if (!normalized) return false;
    return allowedOrigins
        .map(normalizedOrigin)
        .filter((value): value is string => Boolean(value))
        .some((allowed) => constantTimeEqual(allowed, normalized));
}

export function constantTimeEqual(left: string, right: string): boolean {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
        difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return difference === 0;
}

export function isBeautyMovementOpaqueToken(value: string | null | undefined): value is string {
    return normalizeToken(value) !== null;
}

export function createBeautyMovementOpaqueToken(): string {
    const bytes = requireCrypto().getRandomValues(new Uint8Array(32));
    return toBase64Url(bytes);
}

async function hmacSha256(secret: string, message: string): Promise<string> {
    const cryptoObject = requireCrypto();
    const key = await cryptoObject.subtle.importKey(
        "raw",
        toArrayBuffer(utf8(requireHmacSecret(secret))),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const signature = await cryptoObject.subtle.sign("HMAC", key, toArrayBuffer(utf8(message)));
    return toBase64Url(new Uint8Array(signature));
}

export async function hashBeautyMovementInviteToken(params: { secret: string; token: string }): Promise<string> {
    const token = normalizeToken(params.token);
    if (!token) throw new Error("beauty_movement_invalid_invite_token");
    return hmacSha256(params.secret, `v1|beauty-movement|invite|${token}`);
}

export async function hashBeautyMovementSessionToken(params: { secret: string; token: string }): Promise<string> {
    const token = normalizeToken(params.token);
    if (!token) throw new Error("beauty_movement_invalid_session_token");
    return hmacSha256(params.secret, `v1|beauty-movement|session|${token}`);
}

export async function hashBeautyMovementIp(params: { secret: string; ip: string | null | undefined }): Promise<string | null> {
    const ip = (params.ip ?? "").trim();
    if (!ip || ip.length > 128) return null;
    return hmacSha256(params.secret, `v1|beauty-movement|ip|${ip}`);
}

/**
 * Deterministically derives a 256-bit opaque link token from a private HMAC
 * key and a stable source reference. This lets a dry-run/apply replay preserve
 * invite links without retaining plaintext tokens in D1.
 */
export async function deriveBeautyMovementInviteToken(params: {
    secret: string;
    campaignId: string;
    inviteRef: string;
}): Promise<string> {
    const campaignId = params.campaignId.trim();
    const inviteRef = params.inviteRef.trim();
    if (!campaignId || !inviteRef) throw new Error("beauty_movement_invalid_invite_reference");
    return hmacSha256(params.secret, `v1|beauty-movement|delivery|${campaignId}|${inviteRef}`);
}

export type BeautyMovementEncryptedPersonalData = {
    version: 1;
    ciphertext: string;
    iv: string;
};

export async function encryptBeautyMovementPersonalData(
    value: Record<string, unknown>,
    keySecret: string,
): Promise<BeautyMovementEncryptedPersonalData> {
    const cryptoObject = requireCrypto();
    const iv = cryptoObject.getRandomValues(new Uint8Array(12));
    const key = await cryptoObject.subtle.importKey(
        "raw",
        toArrayBuffer(parseAes256HexKey(keySecret)),
        { name: "AES-GCM" },
        false,
        ["encrypt"],
    );
    const plaintext = utf8(JSON.stringify(value));
    const ciphertext = await cryptoObject.subtle.encrypt({ name: "AES-GCM", iv }, key, toArrayBuffer(plaintext));
    return {
        version: 1,
        ciphertext: toBase64Url(new Uint8Array(ciphertext)),
        iv: toBase64Url(iv),
    };
}

export async function decryptBeautyMovementPersonalData<T extends Record<string, unknown>>(
    encrypted: BeautyMovementEncryptedPersonalData,
    keySecret: string,
): Promise<T> {
    if (encrypted.version !== 1 || !encrypted.ciphertext || !encrypted.iv) {
        throw new Error("beauty_movement_invalid_encrypted_personal_data");
    }
    const cryptoObject = requireCrypto();
    const key = await cryptoObject.subtle.importKey(
        "raw",
        toArrayBuffer(parseAes256HexKey(keySecret)),
        { name: "AES-GCM" },
        false,
        ["decrypt"],
    );
    try {
        const plaintext = await cryptoObject.subtle.decrypt(
            { name: "AES-GCM", iv: fromBase64Url(encrypted.iv) },
            key,
            toArrayBuffer(fromBase64Url(encrypted.ciphertext)),
        );
        const parsed = JSON.parse(new TextDecoder().decode(plaintext));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("beauty_movement_invalid_encrypted_personal_data");
        }
        return parsed as T;
    } catch (error) {
        if (error instanceof Error && error.message === "beauty_movement_invalid_encrypted_personal_data") throw error;
        throw new Error("beauty_movement_invalid_encrypted_personal_data");
    }
}

export function maskBeautyMovementContact(whatsapp: string | null | undefined, email: string | null | undefined = null): string {
    const digits = (whatsapp ?? "").replace(/\D/g, "");
    if (digits.length >= 4) return `WhatsApp •••• ${digits.slice(-4)}`;
    if ((email ?? "").trim()) return "E-mail confirmado";
    return "Contato confirmado";
}
