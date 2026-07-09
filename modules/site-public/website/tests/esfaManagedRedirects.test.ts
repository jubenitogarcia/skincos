import assert from "node:assert/strict";
import test from "node:test";
import {
    ESFA_MIGRATED_SOURCE,
    buildEsfaManagedRedirectSeed,
    listEsfaFallbackRedirects,
    listEsfaManagedRedirectSeeds,
} from "../src/lib/esfaManagedRedirects";
import { ESFA_REDIRECTS } from "../src/lib/esfaRedirects";

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

    assert.equal(seeds.length, 96);
    assert.equal(new Set(seeds.map((seed) => seed.slugPath)).size, seeds.length);
    assert.equal(seeds.every((seed) => seed.siteHost === "esfa.co"), true);
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
