import assert from "node:assert/strict";
import test from "node:test";
import { getSiteConfigFromHost, isPathAllowedForSite } from "../src/lib/site-config";

test("site config maps skincos host to legal hub", () => {
    const site = getSiteConfigFromHost("skincos.com.br");
    assert.equal(site.key, "skincos");
    assert.equal(site.siteUrl, "https://skincos.com.br");
});

test("site config keeps espacofacial separate", () => {
    const site = getSiteConfigFromHost("espacofacial.com");
    assert.equal(site.key, "espacofacial");
    assert.equal(site.siteUrl, "https://espacofacial.com");
});

test("skincos domain only allows legal hub routes", () => {
    assert.equal(isPathAllowedForSite("skincos.com.br", "/"), true);
    assert.equal(isPathAllowedForSite("skincos.com.br", "/privacidade"), true);
    assert.equal(isPathAllowedForSite("skincos.com.br", "/dados"), true);
    assert.equal(isPathAllowedForSite("skincos.com.br", "/termos"), true);
    assert.equal(isPathAllowedForSite("skincos.com.br", "/agendamento"), false);
});
