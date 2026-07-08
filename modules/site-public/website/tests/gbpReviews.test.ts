import assert from "node:assert/strict";
import test from "node:test";
import { parseGoogleStarRating } from "../src/lib/googleGbp";
import { computeWeightedRatingFromRows } from "../src/lib/gbpReviewsDb";

test("parseGoogleStarRating maps Google enum values", () => {
    assert.equal(parseGoogleStarRating("ONE"), 1);
    assert.equal(parseGoogleStarRating("FIVE"), 5);
    assert.equal(parseGoogleStarRating(""), null);
    assert.equal(parseGoogleStarRating("UNKNOWN"), null);
});

test("computeWeightedRatingFromRows returns weighted average", () => {
    const rating = computeWeightedRatingFromRows([
        { averageRating: 4.6, totalReviews: 61 },
        { averageRating: 4.8, totalReviews: 150 },
    ]);

    assert.equal(Number(rating.toFixed(3)), 4.742);
});
