import assert from "node:assert/strict";
import test from "node:test";
import { buildWhatsAppUrl } from "../src/lib/whatsapp";

test("buildWhatsAppUrl normalizes phone and encodes message", () => {
    const url = buildWhatsAppUrl("+55 (51) 99849-3563", "Oi prêmio!");
    assert.equal(url, "https://wa.me/5551998493563?text=Oi%20pr%C3%AAmio!");
});

test("buildWhatsAppUrl returns null when phone has no digits", () => {
    const url = buildWhatsAppUrl("sem-numero", "teste");
    assert.equal(url, null);
});
