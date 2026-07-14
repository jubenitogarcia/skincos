import assert from "node:assert/strict";
import test from "node:test";
import { issueBookingStatusToken, verifyBookingStatusToken } from "../src/lib/bookingSecurity";

test("booking status token validates with matching booking id", async () => {
    const secret = "test-secret";
    const expMs = Date.now() + 60_000;
    const token = await issueBookingStatusToken({ secret, id: "req_123", expMs });

    const check = await verifyBookingStatusToken({
        secret,
        id: "req_123",
        token,
        nowMs: Date.now(),
    });

    assert.deepEqual(check, { ok: true });
});

test("booking status token rejects different booking id", async () => {
    const secret = "test-secret";
    const expMs = Date.now() + 60_000;
    const token = await issueBookingStatusToken({ secret, id: "req_123", expMs });

    const check = await verifyBookingStatusToken({
        secret,
        id: "req_999",
        token,
        nowMs: Date.now(),
    });

    assert.deepEqual(check, { ok: false, error: "invalid_token" });
});

test("booking status token expires deterministically", async () => {
    const secret = "test-secret";
    const token = await issueBookingStatusToken({ secret, id: "req_123", expMs: 10_000 });

    const check = await verifyBookingStatusToken({
        secret,
        id: "req_123",
        token,
        nowMs: 10_001,
    });

    assert.deepEqual(check, { ok: false, error: "expired" });
});
