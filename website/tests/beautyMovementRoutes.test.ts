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
let revealCalls = 0;
let confirmCalls = 0;
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
            return {
                ok: true,
                sessionToken: "s".repeat(43),
                sessionExpiresAtMs: Date.parse("2026-08-31T00:00:00Z"),
                state: publicState,
            };
        },
        getBeautyMovementSession: async () => ({ ok: true, state: publicState }),
        revealBeautyMovementCard: async (_input: unknown, options: unknown) => {
            revealCalls += 1;
            latestRevealOptions = options as typeof latestRevealOptions;
            return { ok: true, state: { ...publicState, reveals: [{ actIndex: 1, cardId: "beleza-presenca" }] } };
        },
        confirmBeautyMovementInvite: async () => {
            confirmCalls += 1;
            return { ok: true, state: { ...publicState, confirmed: true } };
        },
    },
});

process.env.NEXT_PUBLIC_SITE_URL = "https://espacofacial.com";

const [{ POST: exchange }, { GET: getState }, { POST: reveal }, { POST: confirm }] = await Promise.all([
    import("../src/app/api/beleza-em-movimento/session/route"),
    import("../src/app/api/beleza-em-movimento/state/route"),
    import("../src/app/api/beleza-em-movimento/reveal/route"),
    import("../src/app/api/beleza-em-movimento/confirm/route"),
]);

function request(path: string, body?: Record<string, unknown>, cookie?: string, origin = "https://espacofacial.com") {
    return new NextRequest(`https://espacofacial.com${path}`, {
        method: "POST",
        headers: {
            origin,
            ...(cookie ? { cookie } : {}),
            ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}

test("invite exchange sets an HttpOnly session and never returns the raw invite token", async () => {
    exchangeCalls = 0;
    const inviteToken = "i".repeat(43);
    const response = await exchange(request("/api/beleza-em-movimento/session", { token: inviteToken }));
    assert.equal(response.status, 200);
    assert.equal(exchangeCalls, 1);
    const payload = JSON.stringify(await response.json());
    assert.equal(payload.includes(inviteToken), false);
    assert.match(response.headers.get("set-cookie") ?? "", /ef_beauty_movement_session=/);
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.match(response.headers.get("set-cookie") ?? "", /SameSite=Lax/i);
});

test("invite exchange rejects an untrusted Origin without calling campaign storage", async () => {
    exchangeCalls = 0;
    const response = await exchange(request("/api/beleza-em-movimento/session", { token: "i".repeat(43) }, undefined, "https://evil.example"));
    assert.equal(response.status, 404);
    assert.equal(exchangeCalls, 0);
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

test("reveal validates against the server-owned palette deck and confirmation requires consent", async () => {
    revealCalls = 0;
    latestRevealOptions = null;
    const revealResponse = await reveal(request("/api/beleza-em-movimento/reveal", {
        actIndex: 1,
        cardId: "beleza-presenca",
    }, "ef_beauty_movement_session=session-token"));
    assert.equal(revealResponse.status, 200);
    assert.equal(revealCalls, 1);
    const revealOptions = getLatestRevealOptions();
    if (!revealOptions?.cardValidator) throw new Error("expected server card validator");
    const validateCard = revealOptions.cardValidator;
    assert.equal(validateCard({ palette: "radiancia", actIndex: 1, cardId: "beleza-presenca" }), true);
    assert.equal(validateCard({ palette: "radiancia", actIndex: 1, cardId: "movimento-potencia" }), false);

    confirmCalls = 0;
    const denied = await confirm(request("/api/beleza-em-movimento/confirm", {
        email: null,
        operationalConsent: false,
    }, "ef_beauty_movement_session=session-token"));
    assert.equal(denied.status, 404);
    assert.equal(confirmCalls, 0);

    const accepted = await confirm(request("/api/beleza-em-movimento/confirm", {
        email: "ana@example.com",
        operationalConsent: true,
    }, "ef_beauty_movement_session=session-token"));
    assert.equal(accepted.status, 200);
    assert.equal(confirmCalls, 1);
});

test("state is no-store and cookie failures remain generic", async () => {
    const response = await getState(new NextRequest("https://espacofacial.com/api/beleza-em-movimento/state", {
        headers: { cookie: "ef_beauty_movement_session=session-token" },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate, private");
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
