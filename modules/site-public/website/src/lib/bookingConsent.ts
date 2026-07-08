import type { CookieConsent } from "@/lib/cookieConsent";

export function hasFullMeasurementConsent(consent: CookieConsent | null | undefined): boolean {
    return consent?.analytics === true && consent?.marketing === true;
}

export function shouldShowBookingMeasurementOptIn(consent: CookieConsent | null | undefined): boolean {
    return !hasFullMeasurementConsent(consent);
}
