import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEmail } from "../src/lib/bookingDb";
import { decodeHtmlEntities } from "../src/lib/htmlEntities";

test("HTML entity decoding never double-decodes encoded markup", () => {
    assert.equal(decodeHtmlEntities("&amp;lt;script&amp;gt;"), "&lt;script&gt;");
    assert.equal(decodeHtmlEntities("image&amp;size=large"), "image&size=large");
});

test("email normalization is bounded and rejects ambiguous input", () => {
    assert.equal(normalizeEmail(" Patient@Example.COM "), "patient@example.com");
    assert.equal(normalizeEmail("a@@example.com"), "");
    assert.equal(normalizeEmail("a@example"), "");
    assert.equal(normalizeEmail(`a@${"x".repeat(250)}.com`), "");
    assert.equal(normalizeEmail("a@exam ple.com"), "");
});
