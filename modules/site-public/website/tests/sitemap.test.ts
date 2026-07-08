import assert from "node:assert/strict";
import test from "node:test";
import { GET as sitemapRoute } from "../src/app/sitemap.xml/route";

test("sitemap includes cadastro route", async () => {
    const response = sitemapRoute(new Request("https://espacofacial.com/sitemap.xml"));
    const xml = await response.text();
    assert.match(xml, /https:\/\/espacofacial\.com\/cadastro/);
});
