import assert from "node:assert/strict";
import test from "node:test";
import { claimCadastroWheelPrize, fetchLockedCadastroWheelPrize } from "../src/lib/cadastroWheelClient";

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

test("wheel client restores only a signed server lock", async () => {
    const restored = await fetchLockedCadastroWheelPrize(async () =>
        jsonResponse({ ok: true, locked: true, prizeId: 4, expMs: Date.now() + 60_000 }),
    );
    assert.equal(restored?.id, 4);

    const unavailable = await fetchLockedCadastroWheelPrize(async () =>
        jsonResponse({ ok: false, error: "wheel_secret_unavailable" }),
    );
    assert.equal(unavailable, null);
});

test("wheel client never awards a local fallback when the server cannot confirm a claim", async () => {
    const unavailable = await claimCadastroWheelPrize(async () =>
        jsonResponse({ ok: false, error: "wheel_secret_unavailable" }),
    );
    assert.deepEqual(unavailable, { ok: false, error: "claim_unavailable" });

    const networkFailure = await claimCadastroWheelPrize(async () => {
        throw new Error("network unavailable");
    });
    assert.deepEqual(networkFailure, { ok: false, error: "claim_unavailable" });
});

test("wheel client accepts a valid server claim and preserves replay state", async () => {
    const result = await claimCadastroWheelPrize(async () =>
        jsonResponse({ ok: true, prizeId: 7, replay: true, expMs: Date.now() + 60_000 }),
    );

    assert.deepEqual(
        result.ok && {
            prizeId: result.claim.prize.id,
            replay: result.claim.replay,
        },
        { prizeId: 7, replay: true },
    );
});

test("wheel client requires the lead form again when the server no longer has that lead", async () => {
    const result = await claimCadastroWheelPrize(async () => jsonResponse({ ok: false, error: "lead_unavailable" }));
    assert.deepEqual(result, { ok: false, error: "lead_unavailable" });
});
