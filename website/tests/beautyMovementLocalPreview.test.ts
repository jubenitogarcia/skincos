import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = (relativePath: string) => new URL(`../src/${relativePath}`, import.meta.url);

test("local preview is synthetic, blocks production, and cannot open the real WhatsApp redirect", async () => {
    const [page, preview, experience] = await Promise.all([
        readFile(sourceUrl("app/beleza-em-movimento/local-preview/page.tsx"), "utf8"),
        readFile(sourceUrl("components/BeautyMovementLocalPreview.tsx"), "utf8"),
        readFile(sourceUrl("components/BeautyMovementExperience.tsx"), "utf8"),
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
});
