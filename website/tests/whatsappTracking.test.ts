import assert from "node:assert/strict";
import test from "node:test";
import { buildWhatsappRedirectHref, buildWhatsappRedirectHrefFromRequest, buildWhatsappClickToken, injectWhatsappToken, parseWhatsappDestination } from "../src/lib/whatsappTracking";

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

test("injectWhatsappToken appends short token once", () => {
    const token = buildWhatsappClickToken("abc12345def6");
    assert.equal(token, "EF-ABC12345");
    assert.equal(injectWhatsappToken("Olá", token), "Olá Ref:EF-ABC12345");
    assert.equal(injectWhatsappToken("Olá Ref:EF-ABC12345", token), "Olá Ref:EF-ABC12345");
});
