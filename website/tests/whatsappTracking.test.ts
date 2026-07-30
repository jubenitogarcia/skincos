import assert from "node:assert/strict";
import test from "node:test";
import type { TrackingContext } from "../src/lib/attribution";
import { CADASTRO_WHEEL_PRIZES } from "../src/lib/cadastroWheelPrizes";
import { buildWhatsAppUrl } from "../src/lib/whatsapp";
import { buildWhatsappRedirectHref, buildWhatsappRedirectHrefFromRequest, buildWhatsappClickToken, decodeWhatsappRedirectQueryValue, expandWhatsappTrackingContext, injectWhatsappToken, parseWhatsappDestination } from "../src/lib/whatsappTracking";

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

    assert.ok(href);
    const redirectUrl = new URL(href, "https://espacofacial.com");
    assert.equal(
        decodeWhatsappRedirectQueryValue(redirectUrl.searchParams.get("dest") ?? ""),
        "https://wa.me/5551999999999?text=Oi",
    );
    assert.equal(redirectUrl.searchParams.get("event_id"), "contact_evt_1");
    assert.equal(redirectUrl.searchParams.get("booking_id"), "req_123");
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

    assert.ok(href);
    const redirectUrl = new URL(href, "https://espacofacial.com");
    assert.equal(
        decodeWhatsappRedirectQueryValue(redirectUrl.searchParams.get("dest") ?? ""),
        "https://api.whatsapp.com/send?phone=5551999999999&text=Oi&utm_source=meta&utm_campaign=abril&fbclid=fbclid_123",
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

    const compactContext = JSON.parse(
        decodeWhatsappRedirectQueryValue(redirectUrl.searchParams.get("ctx") ?? "null"),
    ) as TrackingContext;
    assert.equal(Object.hasOwn(compactContext, "l"), false);
    assert.equal(Object.hasOwn(compactContext, "h"), false);
    const transportedContext = expandWhatsappTrackingContext(compactContext) as TrackingContext;
    assert.deepEqual(transportedContext.consent, { analytics: true, marketing: true });
    assert.deepEqual(transportedContext.params, trackingContext.params);
    assert.equal(transportedContext.fbp, trackingContext.fbp);
    assert.equal(transportedContext.fbc, trackingContext.fbc);
    assert.equal(transportedContext.fbclid, trackingContext.fbclid);
    assert.equal(transportedContext.landingUrl, trackingContext.landingUrl);
    assert.deepEqual(transportedContext.firstTouch, trackingContext.firstTouch);
    assert.deepEqual(transportedContext.lastTouch, trackingContext.lastTouch);

    const onceNormalizedUrl = new URL(
        decodeURIComponent(href),
        "https://espacofacial.com",
    );
    assert.equal(
        decodeWhatsappRedirectQueryValue(onceNormalizedUrl.searchParams.get("dest") ?? ""),
        "https://api.whatsapp.com/send?phone=5551980882293",
    );
    assert.deepEqual(
        expandWhatsappTrackingContext(
            JSON.parse(
                decodeWhatsappRedirectQueryValue(
                    onceNormalizedUrl.searchParams.get("ctx") ?? "null",
                ),
            ),
        ),
        trackingContext,
    );

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
        assert.ok(prizeHref, `prize ${prize.id} did not produce a destination`);
        assert.ok(
            prizeHref.startsWith("/api/whatsapp/redirect?"),
            `prize ${prize.id} unexpectedly used the direct fallback`,
        );
        assert.ok(prizeHref.length <= 2_000, `prize ${prize.id} redirect length: ${prizeHref.length}`);
    }
});

test("buildWhatsappRedirectHref keeps internal correlation without ctx when the complete redirect exceeds the bound", () => {
    const pageUrl = "https://espacofacial.com/cadastro?utm_source=meta&utm_campaign=bounded_fallback";
    const pagePath = "/cadastro?utm_source=meta&utm_campaign=bounded_fallback";
    const destination = buildWhatsAppUrl("5551995811008", "A".repeat(1_400));
    assert.ok(destination);

    const href = buildWhatsappRedirectHref({
        rawUrl: destination,
        tracking: {
            eventId: "contact_transport_fallback",
            placement: "oversized_fixture",
            source: "test",
            pageUrl,
            pagePath,
            trackingContext: {
                capturedAtMs: 1_785_367_500_000,
                pageUrl,
                pagePath,
                referrer: null,
                consent: { analytics: true, marketing: true },
                params: { utm_source: "meta", utm_campaign: "bounded_fallback" },
                fbclid: "bounded-fbclid",
                fbp: "fb.1.1785367500.bounded-browser",
                fbc: "fb.1.1785367500.bounded-fbclid",
                landingUrl: pageUrl,
                landingPath: pagePath,
                firstTouch: null,
                lastTouch: null,
            },
        },
    });

    assert.ok(href);
    assert.ok(href.startsWith("/api/whatsapp/redirect?"));
    const fallbackUrl = new URL(href, "https://espacofacial.com");
    assert.equal(
        decodeWhatsappRedirectQueryValue(fallbackUrl.searchParams.get("dest") ?? ""),
        destination,
    );
    assert.equal(fallbackUrl.searchParams.get("event_id"), "contact_transport_fallback");
    assert.equal(
        decodeWhatsappRedirectQueryValue(fallbackUrl.searchParams.get("page_url") ?? ""),
        pageUrl,
    );
    assert.equal(
        decodeWhatsappRedirectQueryValue(fallbackUrl.searchParams.get("page_path") ?? ""),
        pagePath,
    );
    assert.equal(fallbackUrl.searchParams.has("ctx"), false);
    assert.ok(href.length <= 2_000);
});

test("injectWhatsappToken appends short token once", () => {
    const token = buildWhatsappClickToken("abc12345def6");
    assert.equal(token, "EF-ABC12345");
    assert.equal(injectWhatsappToken("Olá", token), "Olá Ref:EF-ABC12345");
    assert.equal(injectWhatsappToken("Olá Ref:EF-ABC12345", token), "Olá Ref:EF-ABC12345");
});
