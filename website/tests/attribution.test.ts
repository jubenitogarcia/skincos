import assert from "node:assert/strict";
import test from "node:test";
import { deriveFbcFromFbclid } from "../src/lib/attribution";

test("deriveFbcFromFbclid follows Meta cookie format", () => {
    const result = deriveFbcFromFbclid("fbclid_123", 1_712_345_678_000);
    assert.equal(result, "fb.1.1712345678.fbclid_123");
});

test("deriveFbcFromFbclid returns null without fbclid", () => {
    assert.equal(deriveFbcFromFbclid("", 1_712_345_678_000), null);
});
