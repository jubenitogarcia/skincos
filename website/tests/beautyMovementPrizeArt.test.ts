import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
// sharp exposes these declarations at runtime, but its package export map is
// not resolvable by the project's TypeScript checker.
// @ts-expect-error -- exercised by the Node test runner in this file.
import sharp from "sharp";

const sourceUrl = (relativePath: string) => new URL(`../${relativePath}`, import.meta.url);

test("prize art ships four compact branded illustrations instead of eager source-size rasters", async () => {
    const component = await readFile(sourceUrl("src/components/BeautyMovementPrizeArt.tsx"), "utf8");
    const expectedAssets = [
        "elleva-upgrade-cutout.webp",
        "filler-double-cutout.webp",
        "sculptra-classic-unlock-cutout.webp",
        "skinbooster-diamond-unlock-cutout.webp",
    ];

    for (const asset of expectedAssets) {
        assert.match(component, new RegExp(`/images/beauty-movement/rewards/${asset.replace(".", "\\.")}`));
        const assetUrl = sourceUrl(`public/images/beauty-movement/rewards/${asset}`);
        await access(assetUrl);

        const { data, info } = await sharp(fileURLToPath(assetUrl)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.equal(info.width, 384);
        assert.equal(info.height, 384);
        // This point sits inside the tote's open handle. It must be true alpha,
        // never the opaque gray-and-white checkerboard from an editor canvas.
        assert.equal(data[(50 * info.width + 230) * 4 + 3], 0);
    }

    assert.match(component, /width=\{384\}/);
    assert.match(component, /height=\{384\}/);
    assert.match(component, /sizes="\(max-width: 720px\) 174px, 122px"/);
    assert.doesNotMatch(component, /loading="eager"/);
    assert.doesNotMatch(component, /-v[23]\.png/);
    assert.doesNotMatch(component, /rewards\/(?:elleva-upgrade|filler-double|sculptra-classic-unlock|skinbooster-diamond-unlock)\.webp/);
});
