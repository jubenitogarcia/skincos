import assert from "node:assert/strict";
import test from "node:test";
import type { TrackingContext } from "../src/lib/attribution";
import { CADASTRO_WHEEL_PRIZES } from "../src/lib/cadastroWheelPrizes";
import { buildWhatsAppUrl } from "../src/lib/whatsapp";
import { buildWhatsappRedirectHref, buildWhatsappRedirectHrefFromRequest, buildWhatsappClickToken, expandWhatsappTrackingContext, injectWhatsappToken, parseWhatsappDestination } from "../src/lib/whatsappTracking";

test("buildWhatsappRedirectHref wraps supported whatsapp destination with tracking params", () => {
    const href = buildWhatsappRedirectHref({
        rawUrl: "https://wa.me/5551999999999?text=Oi",
        tracking: {
            eventId: "contact_evt_1",
            placement: "booking_confirmation",
            unitSlug: "novo-hamburgo",
            source: "booking_confirmation",
            bookingId: "req_123",
        },
    });

    assert.equal(
        href,
        "/api/whatsapp/redirect?dest=https%3A%2F%2Fwa.me%2F5551999999999%3Ftext%3DOi&event_id=contact_evt_1&placement=booking_confirmation&unit_slug=novo-hamburgo&source=booking_confirmation&booking_id=req_123",
    );
});

test("parseWhatsappDestination extracts phone and text from api.whatsapp.com", () => {
    const parsed = parseWhatsappDestination("https://api.whatsapp.com/send?phone=5551999999999&text=Oi%20teste");
    assert.deepEqual(parsed, {
        destinationUrl: "https://api.whatsapp.com/send?phone=5551999999999&text=Oi%20teste",
        phone: "5551999999999",
        text: "Oi teste",
    });
});

test("buildWhatsappRedirectHrefFromRequest preserves attribution params on the destination", () => {
    const href = buildWhatsappRedirectHrefFromRequest({
        requestUrl: "https://espacofacial.com/novohamburgo/faleconosco?utm_source=meta&utm_campaign=abril&fbclid=fbclid_123",
        rawUrl: "https://api.whatsapp.com/send?phone=5551999999999&text=Oi",
        tracking: {
            placement: "legacy_redirect",
            unitSlug: "novo-hamburgo",
            source: "legacy_redirect:/novohamburgo/faleconosco",
        },
    });

    assert.equal(
        href,
        "/api/whatsapp/redirect?dest=https%3A%2F%2Fapi.whatsapp.com%2Fsend%3Fphone%3D5551999999999%26text%3DOi%26utm_source%3Dmeta%26utm_campaign%3Dabril%26fbclid%3Dfbclid_123&placement=legacy_redirect&unit_slug=novo-hamburgo&source=legacy_redirect%3A%2Fnovohamburgo%2Ffaleconosco",
    );
});

test("campaign-rich Contact redirect keeps consent and matching context within a bounded URL", () => {
    const pageUrl = "https://espacofacial.com/unidades?utm_source=codex_capi_contact&utm_medium=synthetic&utm_campaign=meta_capi_closeout&fbclid=contactproof123";
    const pagePath = new URL(pageUrl).pathname + new URL(pageUrl).search;
    const trackingContext: TrackingContext = {
        capturedAtMs: 1_785_367_500_000,
        pageUrl,
        pagePath,
        referrer: null,
        consent: { analytics: true, marketing: true },
        params: {
            utm_source: "codex_capi_contact",
            utm_medium: "synthetic",
            utm_campaign: "meta_capi_closeout",
            fbclid: "contactproof123",
        },
        fbclid: "contactproof123",
        fbp: "fb.1.1785367500.contact-browser",
        fbc: "fb.1.1785367500.contactproof123",
        landingUrl: pageUrl,
        landingPath: pagePath,
        firstTouch: {
            capturedAtMs: 1_785_367_500_000,
            landingUrl: pageUrl,
            landingPath: pagePath,
            referrer: null,
            params: {
                utm_source: "codex_capi_contact",
                utm_medium: "synthetic",
                utm_campaign: "meta_capi_closeout",
                fbclid: "contactproof123",
            },
            fbclid: "contactproof123",
            fbp: "fb.1.1785367500.contact-browser",
            fbc: "fb.1.1785367500.contactproof123",
        },
        lastTouch: {
            capturedAtMs: 1_785_367_500_000,
            landingUrl: pageUrl,
            landingPath: pagePath,
            referrer: null,
            params: {
                utm_source: "codex_capi_contact",
                utm_medium: "synthetic",
                utm_campaign: "meta_capi_closeout",
                fbclid: "contactproof123",
            },
            fbclid: "contactproof123",
            fbp: "fb.1.1785367500.contact-browser",
            fbc: "fb.1.1785367500.contactproof123",
        },
    };

    const href = buildWhatsappRedirectHref({
        rawUrl: "https://api.whatsapp.com/send?phone=5551980882293",
        tracking: {
            eventId: "contact_transport_contract",
            placement: "units_page",
            source: "units_page",
            unitSlug: "novo-hamburgo",
            pageUrl,
            pagePath,
            trackingContext,
        },
    });

    assert.ok(href);
    assert.equal(href.length < 2_000, true);
    const redirectUrl = new URL(href, "https://espacofacial.com");
    assert.equal(redirectUrl.searchParams.has("page_url"), false);
    assert.equal(redirectUrl.searchParams.has("page_path"), false);

    const compactContext = JSON.parse(redirectUrl.searchParams.get("ctx") ?? "null") as TrackingContext;
    const transportedContext = expandWhatsappTrackingContext(compactContext) as TrackingContext;
    assert.deepEqual(transportedContext.consent, { analytics: true, marketing: true });
    assert.deepEqual(transportedContext.params, trackingContext.params);
    assert.equal(transportedContext.fbp, trackingContext.fbp);
    assert.equal(transportedContext.fbc, trackingContext.fbc);
    assert.equal(transportedContext.fbclid, trackingContext.fbclid);
    assert.equal(transportedContext.landingUrl, trackingContext.landingUrl);
    assert.deepEqual(transportedContext.firstTouch, trackingContext.firstTouch);
    assert.deepEqual(transportedContext.lastTouch, trackingContext.lastTouch);

    for (const prize of CADASTRO_WHEEL_PRIZES) {
        const prizeHref = buildWhatsappRedirectHref({
            rawUrl: buildWhatsAppUrl("5551995811008", prize.message),
            tracking: {
                eventId: `contact_transport_prize_${prize.id}`,
                placement: "cadastro",
                source: "cadastro_wheel",
                unitSlug: "novo-hamburgo",
                pageUrl,
                pagePath,
                trackingContext,
            },
        });
        assert.ok(
            prizeHref?.startsWith("/api/whatsapp/redirect?"),
            `prize ${prize.id} unexpectedly used the direct fallback`,
        );
        assert.ok(prizeHref.length <= 2_000, `prize ${prize.id} redirect length: ${prizeHref.length}`);
    }
});

test("buildWhatsappRedirectHref falls back to the direct destination when the complete redirect exceeds the bound", () => {
    const destination = buildWhatsAppUrl("5551995811008", "A".repeat(1_900));
    assert.ok(destination);

    const href = buildWhatsappRedirectHref({
        rawUrl: destination,
        tracking: {
            eventId: "contact_transport_fallback",
            placement: "oversized_fixture",
            source: "test",
        },
    });

    assert.equal(href, destination);
    assert.ok(href.length <= 2_000);
});

test("injectWhatsappToken appends short token once", () => {
    const token = buildWhatsappClickToken("abc12345def6");
    assert.equal(token, "EF-ABC12345");
    assert.equal(injectWhatsappToken("Olá", token), "Olá Ref:EF-ABC12345");
    assert.equal(injectWhatsappToken("Olá Ref:EF-ABC12345", token), "Olá Ref:EF-ABC12345");
});
