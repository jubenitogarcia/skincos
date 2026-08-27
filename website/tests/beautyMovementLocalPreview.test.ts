import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isBeautyMovementLocalPreviewAllowed } from "../src/lib/beautyMovementLocalPreview";

test("local preview stays available only in development and cannot be opened in production", () => {
    assert.equal(isBeautyMovementLocalPreviewAllowed({ isProduction: false }), true);
    assert.equal(isBeautyMovementLocalPreviewAllowed({ isProduction: true }), false);
});

test("outcome QA shortcut remounts the experience with the resolved initial state", async () => {
    const source = await readFile(
        new URL("../src/components/BeautyMovementLocalPreview.tsx", import.meta.url),
        "utf8",
    );

    assert.match(source, /const \[previewRevision, setPreviewRevision\] = useState\("interactive"\);/);
    assert.match(source, /setPreviewRevision\(`outcome-\$\{requested\}`\);/);
    assert.match(source, /<BeautyMovementExperience\s+key=\{previewRevision\}/);
});
