import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { NextRequest } from "next/server";
import { getBeautyMovementClientIp } from "../src/lib/beautyMovementRoute";

type PublicState = {
    invite: { displayName: string; maskedWhatsapp: string; emailRegistered: boolean };
    palette: "radiancia";
    benefit: { type: "free_procedure"; procedureName: string; discount: null; displayText: string; validity: string; rules: string; termsVersion: string } | null;
    velocity: { enabled: true; label: string; text: string } | null;
    reveals: Array<{ actIndex: number; cardId: string }>;
    confirmed: boolean;
    campaign: Record<string, string | null>;
};

const moduleUrl = (relativePath: string) => new URL(`../src/${relativePath}.ts`, import.meta.url).href;
const publicState: PublicState = {
    invite: { displayName: "Ana", maskedWhatsapp: "WhatsApp •••• 1234", emailRegistered: false },
    palette: "radiancia",
    benefit: null,
    velocity: null,
    reveals: [],
    confirmed: false,
    campaign: {
        title: "Cartas da Beleza em Movimento",
        description: "Beleza que se move com você.",
        invitationTitle: "Convite",
        invitationText: "Evento.",
        partnerName: "Velocity",
        whatsappMessage: "Olá.",
        whatsappLabel: "Falar",
        conditionsLabel: "Condições",
        conditionsText: null,
    },
};

let exchangeCalls = 0;
let exchangeError: "invite_unavailable" | null = null;
let campaignCopyProbeCalls = 0;
let revealCalls = 0;
let confirmCalls = 0;
let revealError: "session_unavailable" | null = null;
let confirmError: "session_unavailable" | null = null;
const CONTEXT_REF = "c".repeat(43);
const SESSION_TOKEN = "s".repeat(43);
type RevealOptions = {
    cardValidator?: (input: { palette: "radiancia"; actIndex: number; cardId: string }) => boolean;
};
let latestRevealOptions: RevealOptions | null = null;

function getLatestRevealOptions(): RevealOptions | null {
    return latestRevealOptions;
}

mock.module(moduleUrl("lib/beautyMovementDb"), {
    namedExports: {
        BEAUTY_MOVEMENT_SESSION_TTL_MS: 86_400_000,
        exchangeBeautyMovementInvite: async () => {
            exchangeCalls += 1;
            if (exchangeError) return { ok: false, error: exchangeError };
            return {
                ok: true,
                sessionToken: SESSION_TOKEN,
                sessionExpiresAtMs: Date.parse("2026-08-31T00:00:00Z"),
                contextRef: CONTEXT_REF,
                state: publicState,
            };
        },
        probeBeautyMovementCampaignCopy: async () => {
            campaignCopyProbeCalls += 1;
            return { ok: true, campaign: { description: publicState.campaign.description } };
        },
        getBeautyMovementSession: async (credential: { contextRef?: string; sessionToken?: string } | null) => (
            credential?.contextRef === CONTEXT_REF && credential.sessionToken === SESSION_TOKEN
                ? { ok: true, state: publicState }
                : { ok: false, error: "session_unavailable" }
        ),
        revealBeautyMovementCard: async (_input: unknown, options: unknown) => {
            revealCalls += 1;
            latestRevealOptions = options as typeof latestRevealOptions;
            if (revealError) return { ok: false, error: revealError };
            return { ok: true, state: { ...publicState, reveals: [{ actIndex: 1, cardId: "beleza-presenca" }] } };
        },
        confirmBeautyMovementInvite: async () => {
            confirmCalls += 1;
            if (confirmError) return { ok: false, error: confirmError };
            return { ok: true, state: { ...publicState, confirmed: true } };
        },
    },
});

process.env.NEXT_PUBLIC_SITE_URL = "https://espacofacial.com";

const [{ POST: exchange }, { POST: campaignCopyProbe }, { GET: getState }, { POST: reveal }, { POST: confirm }] = await Promise.all([
    import("../src/app/api/beleza-em-movimento/session/route"),
    import("../src/app/api/beleza-em-movimento/campaign-copy/route"),
    import("../src/app/api/beleza-em-movimento/state/route"),
    import("../src/app/api/beleza-em-movimento/reveal/route"),
    import("../src/app/api/beleza-em-movimento/confirm/route"),
]);

function request(
    path: string,
    body?: Record<string, unknown>,
    cookie?: string,
    origin = "https://espacofacial.com",
    contextRef?: string,
) {
    return new NextRequest(`https://espacofacial.com${path}`, {
        method: "POST",
        headers: {
            origin,
            ...(cookie ? { cookie } : {}),
            ...(contextRef ? { "x-beauty-movement-context": contextRef } : {}),
            ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}

test("invite exchange sets an HttpOnly session and never returns the raw invite token", async () => {
    exchangeCalls = 0;
    exchangeError = null;
    const inviteToken = "i".repeat(43);
    const response = await exchange(request("/api/beleza-em-movimento/session", { token: inviteToken }));
    assert.equal(response.status, 200);
    assert.equal(exchangeCalls, 1);
    const payload = JSON.stringify(await response.json());
    assert.equal(payload.includes(inviteToken), false);
    assert.match(payload, new RegExp(`"contextRef":"${CONTEXT_REF}"`));
    assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`ef_bm_ctx_${CONTEXT_REF}=`));
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.match(response.headers.get("set-cookie") ?? "", /SameSite=Lax/i);
    assert.match(response.headers.get("set-cookie") ?? "", /Path=\/api\/beleza-em-movimento/i);
    assert.match(response.headers.get("set-cookie") ?? "", /ef_beauty_movement_session=;/);
});

test("old cookie A plus new token B creates only B context and expires the legacy selector", async () => {
    exchangeCalls = 0;
    exchangeError = null;
    const response = await exchange(request(
        "/api/beleza-em-movimento/session",
        { token: "b".repeat(43) },
        `ef_beauty_movement_session=${"a".repeat(43)}`,
    ));
    assert.equal(response.status, 200);
    assert.equal(exchangeCalls, 1);
    const payload = await response.json() as { contextRef?: string };
    assert.equal(payload.contextRef, CONTEXT_REF);
    const cookies = response.headers.get("set-cookie") ?? "";
    assert.match(cookies, new RegExp(`ef_bm_ctx_${CONTEXT_REF}=`));
    assert.match(cookies, /ef_beauty_movement_session=;/);
    assert.match(cookies, /Max-Age=0/i);
});

test("old cookie A plus missing or unavailable token B fails closed and expires the legacy selector", async () => {
    exchangeCalls = 0;
    exchangeError = null;
    const legacyCookie = `ef_beauty_movement_session=${"a".repeat(43)}`;
    const missing = await exchange(request("/api/beleza-em-movimento/session", {}, legacyCookie));
    assert.equal(missing.status, 404);
    assert.equal(exchangeCalls, 0);
    assert.match(missing.headers.get("set-cookie") ?? "", /ef_beauty_movement_session=;/);

    exchangeError = "invite_unavailable";
    const unavailable = await exchange(request(
        "/api/beleza-em-movimento/session",
        { token: "b".repeat(43) },
        legacyCookie,
    ));
    exchangeError = null;
    assert.equal(unavailable.status, 404);
    assert.equal(exchangeCalls, 1);
    assert.match(unavailable.headers.get("set-cookie") ?? "", /ef_beauty_movement_session=;/);
});

test("invite exchange rejects an untrusted Origin without calling campaign storage", async () => {
    exchangeCalls = 0;
    exchangeError = null;
    const response = await exchange(request("/api/beleza-em-movimento/session", { token: "i".repeat(43) }, undefined, "https://evil.example"));
    assert.equal(response.status, 404);
    assert.equal(exchangeCalls, 0);
});

test("campaign copy probe is read-only and never sets a session cookie", async () => {
    campaignCopyProbeCalls = 0;
    const response = await campaignCopyProbe(request("/api/beleza-em-movimento/campaign-copy", { token: "i".repeat(43) }));
    assert.equal(response.status, 200);
    assert.equal(campaignCopyProbeCalls, 1);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), { ok: true, campaign: { description: publicState.campaign.description } });
});

test("invite exchange bounds JSON bodies even when Content-Length is absent", async () => {
    exchangeCalls = 0;
    const response = await exchange(new NextRequest("https://espacofacial.com/api/beleza-em-movimento/session", {
        method: "POST",
        headers: {
            origin: "https://espacofacial.com",
            "content-type": "application/json",
        },
        body: JSON.stringify({ token: "i".repeat(5_000) }),
    }));
    assert.equal(response.status, 404);
    assert.equal(exchangeCalls, 0);
});

test("reveal validates against the server-owned palette deck and confirmation does not require a checkbox", async () => {
    revealCalls = 0;
    revealError = null;
    confirmError = null;
    latestRevealOptions = null;
    const revealResponse = await reveal(request("/api/beleza-em-movimento/reveal", {
        actIndex: 1,
        cardId: "beleza-presenca",
    }, `ef_bm_ctx_${CONTEXT_REF}=${SESSION_TOKEN}`, "https://espacofacial.com", CONTEXT_REF));
    assert.equal(revealResponse.status, 200);
    assert.equal(revealCalls, 1);
    const revealOptions = getLatestRevealOptions();
    if (!revealOptions?.cardValidator) throw new Error("expected server card validator");
    const validateCard = revealOptions.cardValidator;
    assert.equal(validateCard({ palette: "radiancia", actIndex: 1, cardId: "beleza-presenca" }), true);
    assert.equal(validateCard({ palette: "radiancia", actIndex: 1, cardId: "movimento-potencia" }), false);

    confirmCalls = 0;
    const withoutConsent = await confirm(request("/api/beleza-em-movimento/confirm", {
        email: null,
    }, `ef_bm_ctx_${CONTEXT_REF}=${SESSION_TOKEN}`, "https://espacofacial.com", CONTEXT_REF));
    assert.equal(withoutConsent.status, 200);
    assert.equal(confirmCalls, 1);

    confirmCalls = 0;
    const accepted = await confirm(request("/api/beleza-em-movimento/confirm", {
        email: "ana@example.com",
        operationalConsent: true,
    }, `ef_bm_ctx_${CONTEXT_REF}=${SESSION_TOKEN}`, "https://espacofacial.com", CONTEXT_REF));
    assert.equal(accepted.status, 200);
    assert.equal(confirmCalls, 1);
});

test("expired mutation sessions clear only their selected context and the legacy cookie", async () => {
    revealError = "session_unavailable";
    const response = await reveal(request("/api/beleza-em-movimento/reveal", {
        actIndex: 1,
        cardId: "beleza-presenca",
    }, `ef_bm_ctx_${CONTEXT_REF}=${SESSION_TOKEN}`, "https://espacofacial.com", CONTEXT_REF));
    revealError = null;
    assert.equal(response.status, 404);
    const cookies = response.headers.get("set-cookie") ?? "";
    assert.match(cookies, new RegExp(`ef_bm_ctx_${CONTEXT_REF}=;`));
    assert.match(cookies, /ef_beauty_movement_session=;/);

    confirmError = "session_unavailable";
    const confirmation = await confirm(request("/api/beleza-em-movimento/confirm", {
        email: null,
        operationalConsent: true,
    }, `ef_bm_ctx_${CONTEXT_REF}=${SESSION_TOKEN}`, "https://espacofacial.com", CONTEXT_REF));
    confirmError = null;
    assert.equal(confirmation.status, 404);
    assert.match(confirmation.headers.get("set-cookie") ?? "", new RegExp(`ef_bm_ctx_${CONTEXT_REF}=;`));
});

test("state is no-store and cookie failures remain generic", async () => {
    const response = await getState(new NextRequest("https://espacofacial.com/api/beleza-em-movimento/state", {
        headers: {
            cookie: `ef_bm_ctx_${CONTEXT_REF}=${SESSION_TOKEN}`,
            "x-beauty-movement-context": CONTEXT_REF,
        },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate, private");
});

test("state never falls back to the legacy cookie or a different tab context", async () => {
    const legacyOnly = await getState(new NextRequest("https://espacofacial.com/api/beleza-em-movimento/state", {
        headers: { cookie: `ef_beauty_movement_session=${SESSION_TOKEN}` },
    }));
    assert.equal(legacyOnly.status, 404);

    const otherContext = "d".repeat(43);
    const mismatched = await getState(new NextRequest("https://espacofacial.com/api/beleza-em-movimento/state", {
        headers: {
            cookie: `ef_bm_ctx_${CONTEXT_REF}=${SESSION_TOKEN}`,
            "x-beauty-movement-context": otherContext,
        },
    }));
    assert.equal(mismatched.status, 404);
});

test("an unavailable selected session expires only its context cookie and the legacy cookie", async () => {
    const unavailableToken = "u".repeat(43);
    const response = await getState(new NextRequest("https://espacofacial.com/api/beleza-em-movimento/state", {
        headers: {
            cookie: `ef_bm_ctx_${CONTEXT_REF}=${unavailableToken}; ef_beauty_movement_session=${"a".repeat(43)}`,
            "x-beauty-movement-context": CONTEXT_REF,
        },
    }));
    assert.equal(response.status, 404);
    const cookies = response.headers.get("set-cookie") ?? "";
    assert.match(cookies, new RegExp(`ef_bm_ctx_${CONTEXT_REF}=;`));
    assert.match(cookies, /ef_beauty_movement_session=;/);
    assert.match(cookies, /Max-Age=0/i);
});

test("campaign rate limiting accepts only the Cloudflare-provided client IP", () => {
    const cloudflare = new NextRequest("https://espacofacial.com/api/beleza-em-movimento/session", {
        headers: { "cf-connecting-ip": "203.0.113.80", "x-forwarded-for": "198.51.100.10" },
    });
    assert.equal(getBeautyMovementClientIp(cloudflare), "203.0.113.80");

    const untrustedForwarded = new NextRequest("https://espacofacial.com/api/beleza-em-movimento/session", {
        headers: { "x-forwarded-for": "198.51.100.11" },
    });
    assert.equal(getBeautyMovementClientIp(untrustedForwarded), null);
});
