import assert from "node:assert/strict";
import test from "node:test";
import { isBeautyMovementLocalPreviewAllowed } from "../src/lib/beautyMovementLocalPreview";

test("local preview stays available only in development and cannot be opened in production", () => {
    assert.equal(isBeautyMovementLocalPreviewAllowed({ isProduction: false }), true);
    assert.equal(isBeautyMovementLocalPreviewAllowed({ isProduction: true }), false);
});
