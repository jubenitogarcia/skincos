import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = (relativePath: string) => new URL(`../src/${relativePath}`, import.meta.url);

test("local preview is synthetic, blocks production, and cannot open the real WhatsApp redirect", async () => {
    const [page, preview, experience, styles] = await Promise.all([
        readFile(sourceUrl("app/beleza-em-movimento/local-preview/page.tsx"), "utf8"),
        readFile(sourceUrl("components/BeautyMovementLocalPreview.tsx"), "utf8"),
        readFile(sourceUrl("components/BeautyMovementExperience.tsx"), "utf8"),
        readFile(sourceUrl("components/BeautyMovementExperience.module.css"), "utf8"),
    ]);

    assert.match(page, /NODE_ENV === "production" && process\.env\.SKINCOS_LOCAL_PREVIEW !== "true"/);
    assert.match(page, /notFound\(\)/);
    assert.match(preview, /isLocalPreview/);
    assert.doesNotMatch(preview, /Lavieen/);
    assert.doesNotMatch(preview, /\/api\/beleza-em-movimento/);
    assert.doesNotMatch(preview, /trackEvent|trackSiteBehaviorEvent/);
    assert.match(preview, /enumerateBeautyMovementCombinations/);
    assert.match(preview, /NODE_ENV === "production"/);
    assert.match(experience, /if \(isLocalPreview\) \{/);
    assert.match(experience, /<button className=\{className\} type="button" onClick=\{handleWhatsappClick\}>/);
    assert.match(experience, /Prévia local: a abertura do WhatsApp foi simulada\./);
    assert.match(experience, /BEAUTY_MOVEMENT_OFFER_PRESENTATIONS/);
    assert.match(experience, /Suas três escolhas/);
    assert.match(experience, /const \[confirmedOffer, setConfirmedOffer\]/);
    assert.match(experience, /if \(commit && "offer" in commit\) setConfirmedOffer\(commit\.offer \?\? null\)/);
    assert.match(experience, /const offer = initialState\.offer \?\? confirmedOffer/);
    assert.match(experience, /Bioestimulação potencializada/);
    assert.match(experience, /Adquira 2 mL e receba 4 mL\./);
    assert.match(experience, /Adquira 1 mL de Restylane Classic e desbloqueie Sculptra por R\$ 1\.699\./);
    assert.match(experience, /Adquira 1 mL de Restylane Skinbooster e desbloqueie Diamond por R\$ 899\./);
    assert.match(experience, /specialCardConditions/);
    assert.match(styles, /\.specialCardFrontOffer \{/);
    assert.match(styles, /\.specialCardPriceBlock \{/);
    assert.match(styles, /\.specialCardConditions\[open\] \{/);
    assert.match(preview, /return \{ confirmed: true, offer \}/);
});
