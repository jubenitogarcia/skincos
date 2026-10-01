import assert from "node:assert/strict";
import test from "node:test";
import {
    ESFA_MIGRATED_SOURCE,
    buildEsfaManagedRedirectSeed,
    listEsfaFallbackRedirects,
    listEsfaManagedRedirectSeeds,
} from "../src/lib/esfaManagedRedirects";
import {
    ESFA_REDIRECTS,
    ESFA_RETIRED_REDIRECTS,
    normalizeEsfaRedirectPath,
} from "../src/lib/esfaRedirects";
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

test("Clube Botox U aliases resolve to the requested Asaas payment links", () => {
    const redirects = {
        "/bss/ClubeBotoxA60URec": {
            destinationUrl: "https://www.asaas.com/c/j09bzb3zy2igqune",
            unitSlug: "barrashoppingsul",
        },
        "/nh/ClubeBotoxA60URec": {
            destinationUrl: "https://www.asaas.com/c/kmqx08rera7xwnc6",
            unitSlug: "novo-hamburgo",
        },
        "/nh/ClubeBotox40U": {
            destinationUrl: "https://www.asaas.com/c/85kw6n2otrtdhjqe",
            unitSlug: "novo-hamburgo",
        },
        "/nh/ClubeBotox50U": {
            destinationUrl: "https://www.asaas.com/c/93fcmgkhgcin2igk",
            unitSlug: "novo-hamburgo",
        },
        "/nh/ClubeBotox60U": {
            destinationUrl: "https://www.asaas.com/c/hqown86982e9y7f4",
            unitSlug: "novo-hamburgo",
        },
    };

    for (const [requestedPath, { destinationUrl, unitSlug }] of Object.entries(redirects)) {
        const slugPath = normalizeEsfaRedirectPath(requestedPath);
        assert.equal(ESFA_REDIRECTS[slugPath], destinationUrl);

        const seed = buildEsfaManagedRedirectSeed({ slugPath, destinationUrl, now: 789 });
        assert.equal(seed.destinationHost, "www.asaas.com");
        assert.equal(seed.placement, "payment");
        assert.equal(seed.unitSlug, unitSlug);
    }
});

test("listEsfaManagedRedirectSeeds covers the active and retired catalog", () => {
    const seeds = listEsfaManagedRedirectSeeds(456);

    assert.equal(seeds.length, Object.keys(ESFA_REDIRECTS).length + Object.keys(ESFA_RETIRED_REDIRECTS).length);
    assert.equal(new Set(seeds.map((seed) => seed.slugPath)).size, seeds.length);
    assert.equal(seeds.every((seed) => seed.siteHost === "esfa.co"), true);
});

test("generic Clube Botox aliases are retired when the NH catalog is promoted", () => {
    const seeds = listEsfaManagedRedirectSeeds(789);
    const retired = seeds.filter((seed) => Object.hasOwn(ESFA_RETIRED_REDIRECTS, seed.slugPath));

    assert.equal(retired.length, 3);
    assert.equal(retired.every((seed) => seed.active === false), true);
    assert.deepEqual(
        retired.map((seed) => seed.slugPath).sort(),
        Object.keys(ESFA_RETIRED_REDIRECTS).sort(),
    );
    assert.equal(ESFA_REDIRECTS["/clubebotox40u"], undefined);
    assert.equal(ESFA_REDIRECTS["/nh/clubebotox40u"], "https://www.asaas.com/c/85kw6n2otrtdhjqe");
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
