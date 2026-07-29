import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedSyntheticBookingTest } from "../src/lib/syntheticBookingTest";

const validInput = {
    expectedToken: "temporary-test-token",
    providedToken: "temporary-test-token",
    patientName: "META CAPI TEST Synthetic",
    email: "schedule@capi-test.invalid",
    whatsapp: "555199990000",
};

test("synthetic booking notification suppression requires the secret and all fake identity markers", () => {
    assert.equal(isAuthorizedSyntheticBookingTest(validInput), true);
    assert.equal(isAuthorizedSyntheticBookingTest({ ...validInput, providedToken: "wrong-token" }), false);
    assert.equal(isAuthorizedSyntheticBookingTest({ ...validInput, patientName: "Maria Silva" }), false);
    assert.equal(isAuthorizedSyntheticBookingTest({ ...validInput, email: "maria@example.com" }), false);
    assert.equal(isAuthorizedSyntheticBookingTest({ ...validInput, whatsapp: "555199999999" }), false);
});
