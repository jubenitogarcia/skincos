import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = (relativePath: string) => new URL(`../${relativePath}`, import.meta.url);

test("desktop price offer keeps campaign conditions in the editorial flow", async () => {
    const styles = await readFile(sourceUrl("src/components/BeautyMovementExperience.module.css"), "utf8");
    const desktopOfferBlockStart = styles.indexOf("/* Price cards need the campaign conditions in the editorial flow on desktop,");
    const desktopOfferBlockEnd = styles.indexOf("\n}\n\n@media (max-width: 720px) {", desktopOfferBlockStart);

    assert.ok(desktopOfferBlockStart >= 0, "the desktop price-offer block is present");
    assert.ok(desktopOfferBlockEnd > desktopOfferBlockStart, "the desktop price-offer block closes before mobile overrides");

    const desktopOfferStyles = styles.slice(desktopOfferBlockStart, desktopOfferBlockEnd + 2);

    assert.match(desktopOfferStyles, /@media \(min-width: 721px\)\s*\{/);
    assert.match(desktopOfferStyles, /\.specialCardModalDialog \.specialCardWithPrice\s*\{\s*min-height: 456px;/);
    assert.match(
        desktopOfferStyles,
        /\.specialCardModalDialog \.specialCardWithPrice \.specialCardWhatsappAction\s*\{\s*margin-bottom: 0;/,
    );
    assert.match(
        desktopOfferStyles,
        /\.specialCardModalDialog \.specialCardWithPrice \.specialCardConditions\s*\{\s*position: static;\s*width: 100%;\s*margin-top: 0;/,
    );
    assert.match(
        desktopOfferStyles,
        /\.specialCardModalDialog \.specialCardWithPrice:has\(\.specialCardConditions\[open\]\)\s*\{\s*min-height: 560px;/,
    );
});
