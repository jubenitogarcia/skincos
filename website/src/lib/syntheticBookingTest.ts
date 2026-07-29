import { constantTimeEqual } from "@/lib/bookingSecurity";

export const SYNTHETIC_BOOKING_TEST_TOKEN_HEADER = "x-booking-synthetic-test-token";

type SyntheticBookingTestInput = {
    expectedToken: string;
    providedToken: string;
    patientName: string;
    email: string;
    whatsapp: string;
};

/**
 * A production-only, operator-authenticated escape hatch for synthetic CAPI
 * verification. It is inert without the short-lived Worker secret and accepts
 * only an unmistakably fake identity, so a normal booking can never suppress
 * notifications or automation.
 */
export function isAuthorizedSyntheticBookingTest(input: SyntheticBookingTestInput): boolean {
    const expectedToken = input.expectedToken.trim();
    const providedToken = input.providedToken.trim();
    if (!expectedToken || !providedToken || !constantTimeEqual(providedToken, expectedToken)) {
        return false;
    }

    return (
        input.patientName.trim().toUpperCase().startsWith("META CAPI TEST") &&
        input.email.trim().toLowerCase().endsWith("@capi-test.invalid") &&
        input.whatsapp.trim() === "555199990000"
    );
}
