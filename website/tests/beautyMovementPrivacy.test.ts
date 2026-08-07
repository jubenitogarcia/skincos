import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sanitizeBeautyMovementTrackingParams } from "../src/lib/beautyMovementTracking";
import { buildWhatsappRedirectHref } from "../src/lib/whatsappTracking";

test("campaign telemetry allows only aggregate stage, act and sharing fields", () => {
    assert.deepEqual(
        sanitizeBeautyMovementTrackingParams({
            actIndex: 2,
            stage: "result",
            method: "web_share",
            cardId: "beleza-radiancia",
            palette: "radiancia",
            benefit: "aula_cortesia_evento",
            conditionText: "individual",
            contact: "ana@example.com",
        }),
        { actIndex: 2, stage: "result", method: "web_share" },
    );
});

test("campaign WhatsApp transport omits the conversion context envelope", () => {
    const href = buildWhatsappRedirectHref({
        phone: "5551995811008",
        text: "Olá, quero confirmar meu convite.",
        tracking: {
            placement: "beauty_movement_result",
            unitSlug: "novo-hamburgo",
            source: "beauty-movement",
        },
    });
    assert.ok(href);
    const url = new URL(href!, "https://espacofacial.com");
    assert.equal(url.searchParams.has("ctx"), false);
    assert.equal(url.searchParams.has("event_id"), false);
});

test("fragment handoff is scrubbed before generic tracking and campaign telemetry cannot fan out to gtag", async () => {
    const [layout, tracker, whatsapp, redirect, siteEvent, campaign] = await Promise.all([
        readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8"),
        readFile(new URL("../src/components/SiteBehaviorTracker.tsx", import.meta.url), "utf8"),
        readFile(new URL("../src/components/BeautyMovementWhatsappLink.tsx", import.meta.url), "utf8"),
        readFile(new URL("../src/app/api/whatsapp/redirect/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../src/app/api/tracking/site-event/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../src/components/BeautyMovementCampaign.tsx", import.meta.url), "utf8"),
    ]);

    assert.match(layout, /strategy="beforeInteractive"/);
    assert.match(layout, /ef:beauty-movement:invite/);
    assert.match(layout, /history\.replaceState/);
    assert.match(tracker, /anchor\.dataset\.trackingSkip === "true"/);
    assert.match(whatsapp, /data-tracking-skip="true"/);
    assert.equal(whatsapp.includes("trackContactConversion"), false);
    assert.equal(whatsapp.includes("trackingContext:"), false);
    assert.equal(whatsapp.includes("pageUrl"), false);
    assert.equal(whatsapp.includes("pagePath"), false);
    assert.match(redirect, /source === "beauty-movement"/);
    assert.match(redirect, /return NextResponse\.redirect\(parsedDestination\.destinationUrl, \{ status: 302 \}\)/);
    assert.match(siteEvent, /parseBeautyMovementTrackingPayload/);
    assert.match(siteEvent, /origin_not_allowed/);
    assert.match(campaign, /trackBeautyMovementSiteEvent\(event, safeParams\)/);
    assert.doesNotMatch(campaign, /from "@\/lib\/analytics"/);
    assert.doesNotMatch(campaign, /trackEvent\(/);
});
