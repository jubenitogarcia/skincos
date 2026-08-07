import assert from "node:assert/strict";
import test from "node:test";
import {
    createBeautyMovementOpaqueToken,
    decryptBeautyMovementPersonalData,
    deriveBeautyMovementInviteToken,
    encryptBeautyMovementPersonalData,
    hashBeautyMovementInviteToken,
    hashBeautyMovementSessionToken,
    isBeautyMovementOpaqueToken,
    isBeautyMovementOriginAllowed,
    maskBeautyMovementContact,
    resolveBeautyMovementAllowedOrigins,
} from "../src/lib/beautyMovementSecurity";
import { parseCookieConsentValue } from "../src/lib/cookieConsent";
import { parseBeautyMovementTrackingPayload } from "../src/lib/beautyMovementTracking";

const TOKEN_KEY = `test-token-hmac-${"0".repeat(16)}`;
const PII_KEY = "0".repeat(64);

test("beauty movement opaque tokens are random, valid and domain-separated in storage", async () => {
    const token = createBeautyMovementOpaqueToken();
    assert.equal(isBeautyMovementOpaqueToken(token), true);

    const inviteHash = await hashBeautyMovementInviteToken({ secret: TOKEN_KEY, token });
    const sessionHash = await hashBeautyMovementSessionToken({ secret: TOKEN_KEY, token });
    assert.notEqual(inviteHash, sessionHash);

    const first = await deriveBeautyMovementInviteToken({ secret: TOKEN_KEY, campaignId: "nh-3-anos", inviteRef: "invite-001" });
    const repeated = await deriveBeautyMovementInviteToken({ secret: TOKEN_KEY, campaignId: "nh-3-anos", inviteRef: "invite-001" });
    const different = await deriveBeautyMovementInviteToken({ secret: TOKEN_KEY, campaignId: "nh-3-anos", inviteRef: "invite-002" });
    assert.equal(first, repeated);
    assert.notEqual(first, different);
});

test("beauty movement encrypts personal data and rejects tampering", async () => {
    const encrypted = await encryptBeautyMovementPersonalData({
        name: "Ana Silva",
        whatsapp: "+5551999991234",
        email: "ana@example.com",
    }, PII_KEY);
    const restored = await decryptBeautyMovementPersonalData<Record<string, string>>(encrypted, PII_KEY);
    assert.deepEqual(restored, {
        name: "Ana Silva",
        whatsapp: "+5551999991234",
        email: "ana@example.com",
    });

    await assert.rejects(
        decryptBeautyMovementPersonalData({ ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -1)}A` }, PII_KEY),
        /beauty_movement_invalid_encrypted_personal_data/,
    );
});

test("beauty movement accepts only explicit same-origin mutations and masks contacts", () => {
    const allowed = ["https://espacofacial.com", "https://preview.espacofacial.com"];
    assert.equal(isBeautyMovementOriginAllowed("https://espacofacial.com", allowed), true);
    assert.equal(isBeautyMovementOriginAllowed("https://espacofacial.com/beleza-em-movimento", allowed), false);
    assert.equal(isBeautyMovementOriginAllowed("https://evil.example", allowed), false);
    assert.equal(maskBeautyMovementContact("+55 51 99999-1234"), "WhatsApp •••• 1234");
    assert.equal(maskBeautyMovementContact(null, "ana@example.com"), "E-mail confirmado");
});

test("beauty movement accepts an allowlist configured through the runtime environment contract", () => {
    const previous = process.env.BEAUTY_MOVEMENT_ALLOWED_ORIGINS;
    process.env.BEAUTY_MOVEMENT_ALLOWED_ORIGINS = "https://staging.example.test, https://preview.example.test";
    try {
        const origins = resolveBeautyMovementAllowedOrigins();
        assert.equal(isBeautyMovementOriginAllowed("https://staging.example.test", origins), true);
        assert.equal(isBeautyMovementOriginAllowed("https://preview.example.test", origins), true);
    } finally {
        if (previous === undefined) delete process.env.BEAUTY_MOVEMENT_ALLOWED_ORIGINS;
        else process.env.BEAUTY_MOVEMENT_ALLOWED_ORIGINS = previous;
    }
});

test("beauty movement telemetry accepts only its minimal aggregate schema", () => {
    assert.deepEqual(
        parseBeautyMovementTrackingPayload({
            eventName: "beauty_movement_card_revealed",
            params: { actIndex: 2, stage: "act" },
        }),
        {
            eventName: "beauty_movement_card_revealed",
            params: { actIndex: 2, stage: "act" },
        },
    );
    assert.equal(
        parseBeautyMovementTrackingPayload({
            eventName: "beauty_movement_card_revealed",
            params: { actIndex: 2, token: "never-store-this" },
        }),
        null,
    );
    assert.equal(
        parseBeautyMovementTrackingPayload({
            eventName: "beauty_movement_result_view",
            params: { palette: "radiancia" },
        }),
        null,
    );
    assert.equal(
        parseBeautyMovementTrackingPayload({
            eventName: "beauty_movement_share",
            params: { method: "clipboard" },
        }),
        null,
    );
});

test("beauty movement server consent parser accepts only the first-party versioned value", () => {
    assert.deepEqual(parseCookieConsentValue("v=2&a=1&m=0"), { analytics: true, marketing: false });
    assert.deepEqual(parseCookieConsentValue("v=2&a=0&m=1"), { analytics: false, marketing: true });
    assert.equal(parseCookieConsentValue("analytics=true"), null);
});
