import assert from "node:assert/strict";
import test from "node:test";
import { buildWhatsAppUrl } from "../src/lib/whatsapp";

test("buildWhatsAppUrl normalizes phone and encodes message", () => {
    const url = buildWhatsAppUrl("+55 (51) 99581-1008", "Oi prêmio!");
    assert.equal(url, "https://wa.me/5551995811008?text=Oi%20pr%C3%AAmio!");
});

test("buildWhatsAppUrl remaps legacy phone fallback to the current number", () => {
    const url = buildWhatsAppUrl("+55 (51) 99849-3563", "Oi prêmio!");
    assert.equal(url, "https://wa.me/5551995811008?text=Oi%20pr%C3%AAmio!");
});

test("buildWhatsAppUrl returns null when phone has no digits", () => {
    const url = buildWhatsAppUrl("sem-numero", "teste");
    assert.equal(url, null);
});
