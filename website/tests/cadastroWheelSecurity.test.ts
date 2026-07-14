import assert from "node:assert/strict";
import test from "node:test";
import { issueCadastroWheelToken, verifyCadastroWheelToken } from "../src/lib/cadastroWheelSecurity";

test("cadastro wheel token validates when signature and prize are valid", async () => {
    const secret = "test-secret";
    const expMs = Date.now() + 60_000;
    const token = await issueCadastroWheelToken({ secret, prizeId: 7, expMs });

    const check = await verifyCadastroWheelToken({
        secret,
        token,
        maxPrizeId: 12,
        nowMs: Date.now(),
    });

    assert.deepEqual(check, { ok: true, prizeId: 7, expMs });
});

test("cadastro wheel token rejects tampering", async () => {
    const secret = "test-secret";
    const expMs = Date.now() + 60_000;
    const token = await issueCadastroWheelToken({ secret, prizeId: 4, expMs });
    const tampered = token.replace(/^4\./, "9.");

    const check = await verifyCadastroWheelToken({
        secret,
        token: tampered,
        maxPrizeId: 12,
        nowMs: Date.now(),
    });

    assert.deepEqual(check, { ok: false, error: "invalid_token" });
});

test("cadastro wheel token expires deterministically", async () => {
    const secret = "test-secret";
    const token = await issueCadastroWheelToken({ secret, prizeId: 2, expMs: 5_000 });

    const check = await verifyCadastroWheelToken({
        secret,
        token,
        maxPrizeId: 12,
        nowMs: 5_001,
    });

    assert.deepEqual(check, { ok: false, error: "expired" });
});
