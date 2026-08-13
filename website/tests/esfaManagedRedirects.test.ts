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

test("Clube Botox aliases resolve to the requested Asaas payment links", () => {
    const redirects = {
        "/nh/ClubeBotox40U": "https://www.asaas.com/c/85kw6n2otrtdhjqe",
        "/nh/ClubeBotox50U": "https://www.asaas.com/c/93fcmgkhgcin2igk",
        "/nh/ClubeBotox60U": "https://www.asaas.com/c/hqown86982e9y7f4",
        "/nh/ClubeBotox90U": "https://www.asaas.com/c/y27jhi7xoq0nhiwi",
        "/nh/ClubeBotox40URec": "https://www.asaas.com/c/d6wi6vey83vare5o",
        "/nh/ClubeBotox50URec": "https://www.asaas.com/c/qfh7xmfkx75thufp",
        "/nh/ClubeBotox60URec": "https://www.asaas.com/c/s6pzbxxek5zupn20",
        "/nh/ClubeBotoxA60URec": "https://www.asaas.com/c/kmqx08rera7xwnc6",
        "/nh/ClubeBotox90URec": "https://www.asaas.com/c/nhimvltr035trkro",
        "/bss/ClubeBotox40U": "https://www.asaas.com/c/bv1wikkg0l1h53wc",
        "/bss/ClubeBotox50U": "https://www.asaas.com/c/tfy2w7livbb3pby9",
        "/bss/ClubeBotox60U": "https://www.asaas.com/c/0tt8mgwk40cs58gk",
        "/bss/ClubeBotox90U": "https://www.asaas.com/c/kjt19ogowi7an6gu",
        "/bss/ClubeBotox40URec": "https://www.asaas.com/c/pf2r6q16tiyrp9bc",
        "/bss/ClubeBotox50URec": "https://www.asaas.com/c/prjvdv7v95x50y32",
        "/bss/ClubeBotox60URec": "https://www.asaas.com/c/lr38ej38lji2kyuz",
        "/bss/ClubeBotoxA60URec": "https://www.asaas.com/c/j09bzb3zy2igqune",
        "/bss/ClubeBotox90URec": "https://www.asaas.com/c/zmfwvjotop3vpmjz",
    };

    for (const [requestedPath, destinationUrl] of Object.entries(redirects)) {
        const slugPath = normalizeEsfaRedirectPath(requestedPath);
        assert.equal(ESFA_REDIRECTS[slugPath], destinationUrl);

        const seed = buildEsfaManagedRedirectSeed({ slugPath, destinationUrl, now: 789 });
        assert.equal(seed.destinationHost, "www.asaas.com");
        assert.equal(seed.placement, "payment");
        assert.equal(seed.unitSlug, slugPath.startsWith("/nh/") ? "novo-hamburgo" : "barrashoppingsul");
    }
});

test("Instagram live WhatsApp aliases preserve the unit-specific prefilled message", () => {
    const message = "Vim pela live da *Espaço Facial* e quero saber mais sobre a _condição especial_ que vocês apresentaram!";
    const expected = {
        "/nh/iglivewa": "5551995811008",
        "/bss/iglivewa": "5551980882293",
    };

    for (const [slugPath, phone] of Object.entries(expected)) {
        const destinationUrl = ESFA_REDIRECTS[slugPath];
        const destination = new URL(destinationUrl);
        assert.equal(destination.hostname, "wa.me");
        assert.equal(destination.pathname, `/${phone}`);
        assert.equal(destination.searchParams.get("text"), message);

        const seed = buildEsfaManagedRedirectSeed({ slugPath, destinationUrl, now: 789 });
        assert.equal(seed.destinationHost, "wa.me");
        assert.equal(seed.placement, "whatsapp");
        assert.equal(seed.unitSlug, slugPath.startsWith("/nh/") ? "novo-hamburgo" : "barrashoppingsul");
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
