import assert from "node:assert/strict";
import test from "node:test";
import {
    HERO_JUNHO_2026_DESKTOP_ITEMS,
    HERO_JUNHO_2026_MOBILE_ITEMS,
    composeHeroMediaItems,
    getLocalHeroItems,
    resolveScopedHeroMediaItems,
} from "../src/lib/heroMediaShared";
import type { HeroMediaItem } from "../src/lib/heroMediaShared";

test("compose hero media orders unit-specific banners before global banners", () => {
    const items = composeHeroMediaItems({
        unitSlug: "barrashoppingsul",
        unitItems: [
            { id: "unit-2", type: "image", src: "https://cdn.example.com/unit-2.jpg", order: 20 },
            { id: "unit-1", type: "image", src: "https://cdn.example.com/unit-1.jpg", order: 10 },
        ],
        globalItems: [
            { id: "global-2", type: "image", src: "https://cdn.example.com/global-2.jpg", order: 20 },
            { id: "global-1", type: "image", src: "https://cdn.example.com/global-1.jpg", order: 10 },
        ],
    });

    assert.deepEqual(
        items.map((item) => item.id),
        ["unit-1", "unit-2", "global-1", "global-2"],
    );
});

test("compose hero media keeps unit-specific item when duplicate id exists in global", () => {
    const items = composeHeroMediaItems({
        unitSlug: "barrashoppingsul",
        unitItems: [{ id: "banner-dup", type: "image", src: "https://cdn.example.com/unit.jpg", alt: "Banner unidade" }],
        globalItems: [{ id: "banner-dup", type: "image", src: "https://cdn.example.com/global.jpg", alt: "Banner global" }],
    });

    assert.equal(items.length, 1);
    assert.equal(items[0]?.src, "https://cdn.example.com/unit.jpg");
    assert.equal(items[0]?.alt, "Banner unidade");
});

test("compose hero media falls back to type+src dedupe when id is absent", () => {
    const items = composeHeroMediaItems({
        unitSlug: "barrashoppingsul",
        unitItems: [{ type: "image", src: "https://cdn.example.com/shared.jpg", alt: "Local" }],
        globalItems: [{ type: "image", src: "https://cdn.example.com/shared.jpg", alt: "Global" }],
    });

    assert.equal(items.length, 1);
    assert.equal(items[0]?.alt, "Local");
});

test("scoped resolver selects global + current unit and defaults missing scope to global", () => {
    const source: HeroMediaItem[] = [
        { id: "global-a", type: "image", src: "https://cdn.example.com/global-a.jpg", scope: "global" as const },
        { id: "unit-a", type: "image", src: "https://cdn.example.com/unit-a.jpg", scope: "unit:barrashoppingsul" as const },
        { id: "legacy-no-scope", type: "image", src: "https://cdn.example.com/legacy.jpg" },
    ];

    const barrashoppingsul = resolveScopedHeroMediaItems({
        items: source,
        unitSlug: "barrashoppingsul",
        fallbackScope: "global",
    });

    assert.deepEqual(
        barrashoppingsul.unitItems.map((item) => item.id),
        ["unit-a"],
    );
    assert.deepEqual(
        barrashoppingsul.globalItems.map((item) => item.id),
        ["global-a", "legacy-no-scope"],
    );

    const novohamburgo = resolveScopedHeroMediaItems({
        items: source,
        unitSlug: "novohamburgo",
        fallbackScope: "global",
    });

    assert.deepEqual(
        novohamburgo.unitItems.map((item) => item.id),
        [],
    );
    assert.deepEqual(
        novohamburgo.globalItems.map((item) => item.id),
        ["global-a", "legacy-no-scope"],
    );
});

test("local hero items use the Junho 2026 global campaign for a unit page", () => {
    const items = getLocalHeroItems("desktop", { unitSlug: "barrashoppingsul" });

    assert.equal(items.length, 13);
    assert.ok(items.every((item) => item.src.includes("/images/hero/campaigns/junho-2026/desktop/")));
    assert.ok(items.every((item) => item.scope !== "unit:barrashoppingsul"));
});

test("Junho 2026 local hero campaign keeps separate desktop and mobile assets", () => {
    assert.equal(HERO_JUNHO_2026_DESKTOP_ITEMS.length, 13);
    assert.equal(HERO_JUNHO_2026_MOBILE_ITEMS.length, 13);

    assert.ok(HERO_JUNHO_2026_DESKTOP_ITEMS.every((item) => item.src.includes("/desktop/")));
    assert.ok(HERO_JUNHO_2026_DESKTOP_ITEMS.every((item) => item.src.endsWith("__2x1.png")));
    assert.ok(HERO_JUNHO_2026_MOBILE_ITEMS.every((item) => item.src.includes("/mobile/")));
    assert.ok(HERO_JUNHO_2026_MOBILE_ITEMS.every((item) => item.src.endsWith("__9x16.png")));

    assert.deepEqual(
        HERO_JUNHO_2026_DESKTOP_ITEMS.map((item) => item.id?.replace("junho-2026-desktop-", "")),
        HERO_JUNHO_2026_MOBILE_ITEMS.map((item) => item.id?.replace("junho-2026-mobile-", "")),
    );
});
