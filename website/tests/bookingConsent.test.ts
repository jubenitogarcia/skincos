import assert from "node:assert/strict";
import test from "node:test";
import { hasFullMeasurementConsent, shouldShowBookingMeasurementOptIn } from "../src/lib/bookingConsent";

test("full measurement consent requires analytics and marketing together", () => {
    assert.equal(hasFullMeasurementConsent({ analytics: true, marketing: true }), true);
    assert.equal(hasFullMeasurementConsent({ analytics: true, marketing: false }), false);
    assert.equal(hasFullMeasurementConsent({ analytics: false, marketing: true }), false);
    assert.equal(hasFullMeasurementConsent(null), false);
});

test("booking measurement opt-in only shows when full consent is still missing", () => {
    assert.equal(shouldShowBookingMeasurementOptIn({ analytics: true, marketing: true }), false);
    assert.equal(shouldShowBookingMeasurementOptIn({ analytics: true, marketing: false }), true);
    assert.equal(shouldShowBookingMeasurementOptIn({ analytics: false, marketing: false }), true);
    assert.equal(shouldShowBookingMeasurementOptIn(null), true);
});
