import assert from "node:assert/strict";
import test from "node:test";
import sitemap from "../src/app/sitemap";

test("sitemap includes cadastro route", () => {
    const entries = sitemap();
    const hasCadastro = entries.some((entry) => entry.url.endsWith("/cadastro"));
    assert.equal(hasCadastro, true);
});
