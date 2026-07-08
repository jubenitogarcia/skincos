import assert from "node:assert/strict";
import test from "node:test";
import {
    getOfficialHostFamily,
    getSiteConfigFromHost,
    isPathAllowedForSite,
} from "../src/lib/site-config";

test("site config maps skincos host to legal hub", () => {
    const site = getSiteConfigFromHost("skincos.com.br");
    assert.equal(site.key, "skincos");
    assert.equal(site.siteUrl, "https://skincos.com.br");
});

test("official host family distinguishes public espacofacial hosts", () => {
    assert.equal(getOfficialHostFamily("espacofacial.com"), "espacofacial-public");
    assert.equal(getOfficialHostFamily("www.espacofacial.com"), "espacofacial-public");
});

test("official host family distinguishes separate franchise and app hosts", () => {
    assert.equal(getOfficialHostFamily("espacofacial.com.br"), "espacofacial-external");
    assert.equal(getOfficialHostFamily("www.espacofacial.com.br"), "espacofacial-external");
    assert.equal(getOfficialHostFamily("app.espacofacial.com.br"), "espacofacial-external");
});

test("site config maps skincos operational subdomains to the skincos family", () => {
    assert.equal(getSiteConfigFromHost("crm.skincos.com.br").key, "skincos");
    assert.equal(getSiteConfigFromHost("orb.skincos.com.br").key, "skincos");
    assert.equal(getSiteConfigFromHost("wa.skincos.com.br").key, "skincos");
    assert.equal(getOfficialHostFamily("crm.skincos.com.br"), "skincos");
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
