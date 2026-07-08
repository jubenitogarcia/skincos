function toBase64Url(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromUtf8(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const out = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(out).set(bytes);
    return out;
}

function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
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

async function signWheelResult(params: { secret: string; prizeId: number; expMs: number }): Promise<string> {
    const message = ["v1", "cadastro-wheel", String(params.prizeId), String(params.expMs)].join("|");
    return hmacSha256(params.secret, message);
}

export async function issueCadastroWheelToken(params: {
    secret: string;
    prizeId: number;
    expMs: number;
}): Promise<string> {
    const sig = await signWheelResult(params);
    return `${params.prizeId}.${params.expMs}.${sig}`;
}

export async function verifyCadastroWheelToken(params: {
    secret: string;
    token: string;
    maxPrizeId: number;
    nowMs?: number;
}): Promise<{ ok: true; prizeId: number; expMs: number } | { ok: false; error: "invalid_token" | "expired" }> {
    const parts = params.token.split(".");
    if (parts.length !== 3) {
        return { ok: false, error: "invalid_token" };
    }

    const [prizeRaw, expRaw, sig] = parts;
    const prizeId = Number(prizeRaw);
    const expMs = Number(expRaw);
    if (
        !Number.isInteger(prizeId) ||
        prizeId < 1 ||
        prizeId > params.maxPrizeId ||
        !Number.isFinite(expMs) ||
        expMs <= 0 ||
        !sig
    ) {
        return { ok: false, error: "invalid_token" };
    }

    const now = Number.isFinite(params.nowMs) ? Number(params.nowMs) : Date.now();
    if (now > expMs) {
        return { ok: false, error: "expired" };
    }

    const expected = await signWheelResult({
        secret: params.secret,
        prizeId,
        expMs,
    });

    if (!constantTimeEqual(expected, sig)) {
        return { ok: false, error: "invalid_token" };
    }

    return { ok: true, prizeId, expMs };
}
