import { getCookieConsent } from "@/lib/cookieConsent";

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

function fireMetaEvent(eventName: string, params: Record<string, unknown> = {}) {
    if (typeof window === "undefined") return;
    const fbq = (window as { fbq?: unknown }).fbq;
    if (typeof fbq !== "function") return;

    try {
        (fbq as (...args: unknown[]) => void)("track", eventName, params);
    } catch {
        // noop
    }
}

export function trackLeadConversion(params: Record<string, unknown> = {}) {
    if (!hasMarketingConsent()) return;

    fireGoogleAdsConversion(GOOGLE_ADS_LEAD_SEND_TO, params);
    fireMetaEvent("Lead", params);
}

export function trackContactConversion(params: Record<string, unknown> = {}) {
    if (!hasMarketingConsent()) return;

    fireGoogleAdsConversion(GOOGLE_ADS_CONTACT_SEND_TO, params);
    fireMetaEvent("Contact", params);
}
