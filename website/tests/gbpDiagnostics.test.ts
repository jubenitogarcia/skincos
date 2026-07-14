import assert from "node:assert/strict";
import test from "node:test";
import { buildGbpLocationResource, parseGbpLocationId } from "../src/lib/gbpDiagnostics";

test("accepts only numeric Google Business Profile location identifiers", () => {
    assert.equal(parseGbpLocationId("123456"), "123456");
    assert.equal(parseGbpLocationId("locations/123456"), "123456");
    assert.equal(parseGbpLocationId(" accounts/123/locations/456 "), null);
});

test("rejects path and query injection in Google Business Profile identifiers", () => {
    for (const value of ["locations/123?alt=json", "locations/123/reviews", "../123", "123#fragment", "123%2freviews"]) {
        assert.equal(parseGbpLocationId(value), null);
    }

    assert.equal(buildGbpLocationResource("456", "123"), "accounts/456/locations/123");
    assert.throws(() => buildGbpLocationResource("456?x=1", "123"), /invalid_gbp_resource_identifier/);
});
