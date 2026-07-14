import assert from "node:assert/strict";
import test from "node:test";
import { resolveEsfaRedirectTarget } from "../workers/esfa-redirector/worker";

test("esfa redirect target preserves incoming attribution without duplicate keys", () => {
    const target = resolveEsfaRedirectTarget(
        "https://espacofacial.com/agendamento?unit=barrashoppingsul&utm_source=esfa.co&utm_medium=short_link&utm_campaign=aniver7anos",
        "?utm_source=meta&utm_campaign=legacy&fbclid=fbclid_123",
    );

    assert.equal(
        target,
        "https://espacofacial.com/agendamento?unit=barrashoppingsul&utm_medium=short_link&utm_source=meta&utm_campaign=legacy&fbclid=fbclid_123",
    );
});

test("esfa redirect target retains destination defaults without an incoming query string", () => {
    assert.equal(
        resolveEsfaRedirectTarget(
            "https://espacofacial.com/agendamento?unit=novo-hamburgo&utm_campaign=aniver7anos",
            "",
        ),
        "https://espacofacial.com/agendamento?unit=novo-hamburgo&utm_campaign=aniver7anos",
    );
});
