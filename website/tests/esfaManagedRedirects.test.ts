import assert from "node:assert/strict";
import test from "node:test";
import {
    ESFA_MIGRATED_SOURCE,
    buildEsfaManagedRedirectSeed,
    listEsfaFallbackRedirects,
    listEsfaManagedRedirectSeeds,
} from "../src/lib/esfaManagedRedirects";
import { ESFA_REDIRECTS } from "../src/lib/esfaRedirects";
import { ANIVERSARIO_7_ESFA_REDIRECTS, ANIVERSARIO_7_LEGACY_REDIRECTS } from "../src/lib/aniversario7Redirects";

test("buildEsfaManagedRedirectSeed infers metadata for migrated esfa redirects", () => {
    const seed = buildEsfaManagedRedirectSeed({
        slugPath: "/bss/clubebotox",
        destinationUrl: "https://payment-link-v3.stone.com.br/pl_lqrbavJ9pR50k6HBBt48jYoAPENQXxek",
        now: 123,
    });

    assert.equal(seed.id.startsWith("esfa_"), true);
    assert.equal(seed.siteHost, "esfa.co");
    assert.equal(seed.slugPath, "/bss/clubebotox");
    assert.equal(seed.placement, "payment");
    assert.equal(seed.unitSlug, "barrashoppingsul");
    assert.equal(seed.source, ESFA_MIGRATED_SOURCE);
    assert.equal(seed.createdAtMs, 123);
});

test("listEsfaManagedRedirectSeeds covers the full static catalog", () => {
    const seeds = listEsfaManagedRedirectSeeds(456);

    assert.equal(seeds.length, Object.keys(ESFA_REDIRECTS).length);
    assert.equal(new Set(seeds.map((seed) => seed.slugPath)).size, seeds.length);
    assert.equal(seeds.every((seed) => seed.siteHost === "esfa.co"), true);
});

test("aniversario 7 campaign aliases converge to the canonical short links", () => {
    assert.equal(ANIVERSARIO_7_ESFA_REDIRECTS["/bss/aniver6anos"], "https://esfa.co/bss/aniver7anos");
    assert.equal(ANIVERSARIO_7_ESFA_REDIRECTS["/nh/aniver6anos"], "https://esfa.co/nh/aniver7anos");
    assert.match(ANIVERSARIO_7_ESFA_REDIRECTS["/bss/aniver7anos"], /unit=barrashoppingsul/);
    assert.match(ANIVERSARIO_7_ESFA_REDIRECTS["/nh/aniver7anos"], /unit=novo-hamburgo/);
    assert.equal(ANIVERSARIO_7_LEGACY_REDIRECTS["/barrashoppingsul/aniver6anos"], "https://esfa.co/bss/aniver7anos");
    assert.equal(ANIVERSARIO_7_LEGACY_REDIRECTS["/novohamburgo/aniver6anos"], "https://esfa.co/nh/aniver7anos");
});

test("listEsfaFallbackRedirects excludes redirects already migrated to D1", () => {
    const fallbacks = listEsfaFallbackRedirects([
        { site_host: "esfa.co", slug_path: "/bss/comochegar" },
        { site_host: "espacofacial.com", slug_path: "/campanhas/botox-nh" },
    ]);

    assert.equal(fallbacks.some((entry) => entry.slugPath === "/bss/comochegar"), false);
    assert.equal(fallbacks.some((entry) => entry.slugPath === "/nh/comochegar"), true);
});

test("retired Marina esfa redirects land on unit pages instead of legacy WhatsApp links", () => {
    assert.equal(ESFA_REDIRECTS["/bss/dramarinalima"], "https://espacofacial.com/barrashoppingsul");
    assert.equal(ESFA_REDIRECTS["/nh/dramarinalima"], "https://espacofacial.com/novohamburgo");
});
