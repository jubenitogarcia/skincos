import { getCookieConsent } from "@/lib/cookieConsent";
import { trackMetaStandardEvent } from "@/lib/metaBrowser";

const GOOGLE_ADS_LEAD_SEND_TO = process.env.NEXT_PUBLIC_GOOGLE_ADS_LEAD_SEND_TO;
const GOOGLE_ADS_CONTACT_SEND_TO = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONTACT_SEND_TO;

function hasMarketingConsent(): boolean {
    if (typeof window === "undefined") return false;
    return getCookieConsent()?.marketing === true;
}

function fireGoogleAdsConversion(sendTo: string | undefined, params: Record<string, unknown> = {}) {
    if (!sendTo) return;
    if (typeof window === "undefined") return;
    if (typeof window.gtag !== "function") return;

    try {
        window.gtag("event", "conversion", {
            send_to: sendTo,
            ...params,
        });
    } catch {
        // noop
    }
}

export function trackLeadConversion(
    params: Record<string, unknown> = {},
    options: { eventId?: string; dedupeKey?: string } = {},
) {
    if (!hasMarketingConsent()) return;

    fireGoogleAdsConversion(GOOGLE_ADS_LEAD_SEND_TO, params);
    trackMetaStandardEvent("Lead", params, options);
}

export function trackContactConversion(
    params: Record<string, unknown> = {},
    options: { eventId?: string; dedupeKey?: string } = {},
) {
    if (!hasMarketingConsent()) return;

    fireGoogleAdsConversion(GOOGLE_ADS_CONTACT_SEND_TO, params);
    trackMetaStandardEvent("Contact", params, options);
}
