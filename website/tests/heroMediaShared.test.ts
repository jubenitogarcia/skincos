import assert from "node:assert/strict";
import test from "node:test";
import {
    HERO_AGOSTO_2026_DESKTOP_ITEMS,
    HERO_AGOSTO_2026_MOBILE_ITEMS,
    composeHeroMediaItems,
    filterHeroMediaItemsByCampaignWindow,
    getHeroMediaAspectRatio,
    getLocalHeroItems,
    resolveScopedHeroMediaItems,
} from "../src/lib/heroMediaShared";
import type { HeroMediaItem } from "../src/lib/heroMediaShared";

const TEST_CAMPAIGN_WINDOW = {
    startsOn: "2026-01-01",
    endsOn: "2099-12-31",
};

test("compose hero media orders unit-specific banners before global banners", () => {
    const items = composeHeroMediaItems({
        unitSlug: "barrashoppingsul",
        unitItems: [
            { id: "unit-2", type: "image", src: "https://cdn.example.com/unit-2.jpg", order: 20, campaignWindow: TEST_CAMPAIGN_WINDOW },
            { id: "unit-1", type: "image", src: "https://cdn.example.com/unit-1.jpg", order: 10, campaignWindow: TEST_CAMPAIGN_WINDOW },
        ],
        globalItems: [
            { id: "global-2", type: "image", src: "https://cdn.example.com/global-2.jpg", order: 20, campaignWindow: TEST_CAMPAIGN_WINDOW },
            { id: "global-1", type: "image", src: "https://cdn.example.com/global-1.jpg", order: 10, campaignWindow: TEST_CAMPAIGN_WINDOW },
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
        unitItems: [{ id: "banner-dup", type: "image", src: "https://cdn.example.com/unit.jpg", alt: "Banner unidade", campaignWindow: TEST_CAMPAIGN_WINDOW }],
        globalItems: [{ id: "banner-dup", type: "image", src: "https://cdn.example.com/global.jpg", alt: "Banner global", campaignWindow: TEST_CAMPAIGN_WINDOW }],
    });

    assert.equal(items.length, 1);
    assert.equal(items[0]?.src, "https://cdn.example.com/unit.jpg");
    assert.equal(items[0]?.alt, "Banner unidade");
});

test("compose hero media falls back to type+src dedupe when id is absent", () => {
    const items = composeHeroMediaItems({
        unitSlug: "barrashoppingsul",
        unitItems: [{ type: "image", src: "https://cdn.example.com/shared.jpg", alt: "Local", campaignWindow: TEST_CAMPAIGN_WINDOW }],
        globalItems: [{ type: "image", src: "https://cdn.example.com/shared.jpg", alt: "Global", campaignWindow: TEST_CAMPAIGN_WINDOW }],
    });

    assert.equal(items.length, 1);
    assert.equal(items[0]?.alt, "Local");
});

test("scoped resolver selects global + current unit and defaults missing scope to global", () => {
    const source: HeroMediaItem[] = [
        { id: "global-a", type: "image", src: "https://cdn.example.com/global-a.jpg", scope: "global" as const, campaignWindow: TEST_CAMPAIGN_WINDOW },
        { id: "unit-a", type: "image", src: "https://cdn.example.com/unit-a.jpg", scope: "unit:barrashoppingsul" as const, campaignWindow: TEST_CAMPAIGN_WINDOW },
        { id: "legacy-no-scope", type: "image", src: "https://cdn.example.com/legacy.jpg", campaignWindow: TEST_CAMPAIGN_WINDOW },
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

test("local hero items use the agosto 2026 global campaign for a unit page", () => {
    const items = getLocalHeroItems("desktop", {
        unitSlug: "barrashoppingsul",
        now: new Date("2026-08-31T12:00:00-03:00"),
    });

    assert.equal(items.length, 8);
    assert.ok(items.every((item) => item.src.includes("/images/hero/campaigns/agosto-2026/desktop/")));
    assert.ok(items.every((item) => item.scope !== "unit:barrashoppingsul"));
});

test("agosto 2026 local hero campaign keeps separate desktop and mobile assets", () => {
    assert.equal(HERO_AGOSTO_2026_DESKTOP_ITEMS.length, 8);
    assert.equal(HERO_AGOSTO_2026_MOBILE_ITEMS.length, 8);

    assert.ok(HERO_AGOSTO_2026_DESKTOP_ITEMS.every((item) => item.src.includes("/desktop/")));
    assert.ok(HERO_AGOSTO_2026_DESKTOP_ITEMS.every((item) => item.src.endsWith(".png")));
    assert.ok(HERO_AGOSTO_2026_MOBILE_ITEMS.every((item) => item.src.includes("/mobile/")));
    assert.ok(HERO_AGOSTO_2026_MOBILE_ITEMS.every((item) => item.src.endsWith(".png")));
    assert.ok(HERO_AGOSTO_2026_DESKTOP_ITEMS.every((item) => item.campaignWindow?.startsOn === "2026-08-10" && item.campaignWindow.endsOn === "2026-08-31"));
    assert.ok(HERO_AGOSTO_2026_MOBILE_ITEMS.every((item) => item.campaignWindow?.startsOn === "2026-08-10" && item.campaignWindow.endsOn === "2026-08-31"));

    assert.deepEqual(
        HERO_AGOSTO_2026_DESKTOP_ITEMS.map((item) => item.id),
        Array.from({ length: 8 }, (_, index) => `agosto-2026-desktop-banner-${String(index + 1).padStart(2, "0")}`),
    );

    assert.deepEqual(
        HERO_AGOSTO_2026_MOBILE_ITEMS.map((item) => item.id),
        Array.from({ length: 8 }, (_, index) => `agosto-2026-mobile-banner-${String(index + 1).padStart(2, "0")}`),
    );

    assert.deepEqual(
        HERO_AGOSTO_2026_DESKTOP_ITEMS.map((item) => item.src.replace("/desktop/", "/mobile/")),
        HERO_AGOSTO_2026_MOBILE_ITEMS.map((item) => item.src),
    );
});

test("agosto 2026 local hero campaign exposes dimensions before image load", () => {
    assert.deepEqual(
        HERO_AGOSTO_2026_DESKTOP_ITEMS.map((item) => ({
            width: item.width,
            height: item.height,
            aspectRatio: getHeroMediaAspectRatio(item),
        })),
        Array.from({ length: 8 }, () => ({ width: 1733, height: 907, aspectRatio: "1733 / 907" })),
    );

    assert.deepEqual(
        HERO_AGOSTO_2026_MOBILE_ITEMS.map((item) => ({
            width: item.width,
            height: item.height,
            aspectRatio: getHeroMediaAspectRatio(item),
        })),
        Array.from({ length: 8 }, () => ({ width: 941, height: 1672, aspectRatio: "941 / 1672" })),
    );
});

test("hero selection requires a valid campaign window and treats the end date as inclusive in Sao Paulo", () => {
    const windowed: HeroMediaItem = {
        id: "windowed",
        type: "image",
        src: "/campaign.png",
        campaignWindow: { startsOn: "2026-09-28", endsOn: "2026-09-30" },
    };
    const beforeStart = new Date("2026-09-28T02:59:59.999Z");
    const start = new Date("2026-09-28T03:00:00.000Z");
    const lastMoment = new Date("2026-10-01T02:59:59.999Z");
    const afterEnd = new Date("2026-10-01T03:00:00.000Z");

    assert.deepEqual(filterHeroMediaItemsByCampaignWindow([windowed], beforeStart), []);
    assert.deepEqual(filterHeroMediaItemsByCampaignWindow([windowed], start), [windowed]);
    assert.deepEqual(filterHeroMediaItemsByCampaignWindow([windowed], lastMoment), [windowed]);
    assert.deepEqual(filterHeroMediaItemsByCampaignWindow([windowed], afterEnd), []);
    assert.deepEqual(filterHeroMediaItemsByCampaignWindow([{ ...windowed, campaignWindow: undefined }], start), []);
    assert.deepEqual(
        filterHeroMediaItemsByCampaignWindow([
            { ...windowed, campaignWindow: { startsOn: "2026-02-30", endsOn: "2026-10-01" } },
        ], start),
        [],
    );
});

test("expired August hero campaigns are not selectable on desktop or mobile", () => {
    const expiredAt = new Date("2026-09-28T12:00:00-03:00");
    assert.deepEqual(getLocalHeroItems("desktop", { now: expiredAt }), []);
    assert.deepEqual(getLocalHeroItems("mobile", { now: expiredAt }), []);
});
