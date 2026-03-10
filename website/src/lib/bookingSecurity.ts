function toBase64Url(bytes: Uint8Array): string {
    // btoa expects binary string
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromUtf8(s: string): Uint8Array {
    return new TextEncoder().encode(s);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const out = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(out).set(bytes);
    return out;
}

async function hmacSha256(secret: string, message: string): Promise<string> {
    const cryptoObj = (globalThis as unknown as { crypto?: Crypto }).crypto;
    if (!cryptoObj?.subtle) {
        throw new Error("webcrypto_unavailable");
    }

    const secretBytes = fromUtf8(secret);
    const messageBytes = fromUtf8(message);

    const key = await cryptoObj.subtle.importKey(
        "raw",
        toArrayBuffer(secretBytes),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );

    const sig = await cryptoObj.subtle.sign("HMAC", key, toArrayBuffer(messageBytes));
    return toBase64Url(new Uint8Array(sig));
}

export type BookingDecisionAction = "confirm" | "decline";

export function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let ok = 0;
    for (let i = 0; i < a.length; i++) ok |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return ok === 0;
}

export async function signBookingDecision(params: {
    secret: string;
    id: string;
    action: BookingDecisionAction;
    expMs: number;
    overrideConflict: boolean;
}): Promise<string> {
    const msg = ["v1", params.id, params.action, String(params.expMs), params.overrideConflict ? "1" : "0"].join("|");
    return hmacSha256(params.secret, msg);
}

export async function verifyBookingDecision(params: {
    secret: string;
    id: string;
    action: BookingDecisionAction;
    expMs: number;
    overrideConflict: boolean;
    sig: string;
}): Promise<boolean> {
    const expected = await signBookingDecision({
        secret: params.secret,
        id: params.id,
        action: params.action,
        expMs: params.expMs,
        overrideConflict: params.overrideConflict,
    });

    return constantTimeEqual(params.sig, expected);
}
