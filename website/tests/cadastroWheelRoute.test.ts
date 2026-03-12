import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { issueCadastroWheelToken } from "../src/lib/cadastroWheelSecurity";
import { GET, POST } from "../src/app/api/cadastro/wheel/route";

type EnvSnapshot = {
    CADASTRO_WHEEL_SECRET?: string;
    BOOKING_STATUS_SECRET?: string;
    BOOKING_DECISION_SECRET?: string;
    CADASTRO_WHEEL_LOCK_HOURS?: string;
};

function saveEnv(): EnvSnapshot {
    return {
        CADASTRO_WHEEL_SECRET: process.env.CADASTRO_WHEEL_SECRET,
        BOOKING_STATUS_SECRET: process.env.BOOKING_STATUS_SECRET,
        BOOKING_DECISION_SECRET: process.env.BOOKING_DECISION_SECRET,
        CADASTRO_WHEEL_LOCK_HOURS: process.env.CADASTRO_WHEEL_LOCK_HOURS,
    };
}

function restoreEnv(snapshot: EnvSnapshot) {
    process.env.CADASTRO_WHEEL_SECRET = snapshot.CADASTRO_WHEEL_SECRET;
    process.env.BOOKING_STATUS_SECRET = snapshot.BOOKING_STATUS_SECRET;
    process.env.BOOKING_DECISION_SECRET = snapshot.BOOKING_DECISION_SECRET;
    process.env.CADASTRO_WHEEL_LOCK_HOURS = snapshot.CADASTRO_WHEEL_LOCK_HOURS;
}

function cookieValueFromSetCookie(setCookie: string | null, name: string): string | null {
    if (!setCookie) return null;
    const pattern = new RegExp(`${name}=([^;]+)`);
    const match = setCookie.match(pattern);
    return match?.[1] ?? null;
}

test("GET and POST return wheel_secret_unavailable when no secret is configured", async () => {
    const snapshot = saveEnv();
    process.env.CADASTRO_WHEEL_SECRET = "";
    process.env.BOOKING_STATUS_SECRET = "";
    process.env.BOOKING_DECISION_SECRET = "";

    try {
        const getReq = new NextRequest("https://example.com/api/cadastro/wheel");
        const getRes = await GET(getReq);
        assert.equal(getRes.status, 200);
        assert.deepEqual(await getRes.json(), { ok: false, error: "wheel_secret_unavailable" });

        const postReq = new NextRequest("https://example.com/api/cadastro/wheel", { method: "POST" });
        const postRes = await POST(postReq);
        assert.equal(postRes.status, 200);
        assert.deepEqual(await postRes.json(), { ok: false, error: "wheel_secret_unavailable" });
    } finally {
        restoreEnv(snapshot);
    }
});

test("POST issues prize cookie and replays same prize when cookie is present", async () => {
    const snapshot = saveEnv();
    process.env.CADASTRO_WHEEL_SECRET = "wheel-route-test-secret";
    process.env.CADASTRO_WHEEL_LOCK_HOURS = "24";

    try {
        const firstReq = new NextRequest("https://example.com/api/cadastro/wheel", { method: "POST" });
        const firstRes = await POST(firstReq);
        assert.equal(firstRes.status, 200);
        const firstPayload = (await firstRes.json()) as { ok: boolean; prizeId: number; replay: boolean; expMs: number };
        assert.equal(firstPayload.ok, true);
        assert.equal(firstPayload.replay, false);
        assert.equal(Number.isInteger(firstPayload.prizeId), true);
        assert.equal(firstPayload.prizeId >= 1 && firstPayload.prizeId <= 12, true);
        assert.equal(firstPayload.expMs > Date.now(), true);

        const setCookie = firstRes.headers.get("set-cookie");
        const token = cookieValueFromSetCookie(setCookie, "ef_cadastro_wheel");
        assert.equal(typeof token, "string");

        const replayReq = new NextRequest("https://example.com/api/cadastro/wheel", {
            method: "POST",
            headers: { cookie: `ef_cadastro_wheel=${token}` },
        });
        const replayRes = await POST(replayReq);
        assert.equal(replayRes.status, 200);
        const replayPayload = (await replayRes.json()) as { ok: boolean; prizeId: number; replay: boolean };
        assert.equal(replayPayload.ok, true);
        assert.equal(replayPayload.replay, true);
        assert.equal(replayPayload.prizeId, firstPayload.prizeId);
    } finally {
        restoreEnv(snapshot);
    }
});

test("GET restores valid locked prize from signed cookie", async () => {
    const snapshot = saveEnv();
    process.env.CADASTRO_WHEEL_SECRET = "wheel-route-test-secret";

    try {
        const expMs = Date.now() + 60_000;
        const token = await issueCadastroWheelToken({
            secret: "wheel-route-test-secret",
            prizeId: 9,
            expMs,
        });
        const req = new NextRequest("https://example.com/api/cadastro/wheel", {
            headers: { cookie: `ef_cadastro_wheel=${token}` },
        });
        const res = await GET(req);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { ok: true, locked: true, prizeId: 9, expMs });
    } finally {
        restoreEnv(snapshot);
    }
});
