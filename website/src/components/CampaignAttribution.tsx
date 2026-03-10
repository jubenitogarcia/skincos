"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { extractCampaignParamsFromSearchParams, persistCampaignParams } from "@/lib/campaign";
import { COOKIE_CONSENT_EVENT, getCookieConsent, type CookieConsent } from "@/lib/cookieConsent";

function canPersistCampaignParams(consent: CookieConsent | null): boolean {
    return Boolean(consent?.analytics || consent?.marketing);
}

export default function CampaignAttribution() {
    const searchParams = useSearchParams();

    useEffect(() => {
        const consent = getCookieConsent();
        if (!canPersistCampaignParams(consent)) return;
        const params = extractCampaignParamsFromSearchParams(new URLSearchParams(searchParams.toString()));
        persistCampaignParams(params);
    }, [searchParams]);

    useEffect(() => {
        function onConsent(event: Event) {
            const detail = (event as CustomEvent<CookieConsent>).detail;
            if (!canPersistCampaignParams(detail ?? null)) return;
            const params = extractCampaignParamsFromSearchParams(new URLSearchParams(window.location.search));
            persistCampaignParams(params);
        }

        window.addEventListener(COOKIE_CONSENT_EVENT, onConsent);
        return () => window.removeEventListener(COOKIE_CONSENT_EVENT, onConsent);
    }, []);

    return null;
}
