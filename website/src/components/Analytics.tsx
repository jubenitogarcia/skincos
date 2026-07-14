"use client";

import { useEffect, useMemo, useState } from "react";
import Script from "next/script";
import { COOKIE_CONSENT_EVENT, getCookieConsent, type CookieConsent } from "@/lib/cookieConsent";

const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID;
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;

function consentModeParams(consent: CookieConsent) {
    return {
        ad_storage: consent.marketing ? "granted" : "denied",
        analytics_storage: consent.analytics ? "granted" : "denied",
        ad_user_data: consent.marketing ? "granted" : "denied",
        ad_personalization: consent.marketing ? "granted" : "denied",
    } as const;
}

function updateGtagConsent(consent: CookieConsent) {
    if (typeof window === "undefined") return;
    if (typeof window.gtag !== "function") return;
    try {
        window.gtag("consent", "update", consentModeParams(consent));
    } catch {
        // noop
    }
}

function clearAnalyticsCookies() {
    if (typeof document === "undefined") return;
    const names = document.cookie
        .split(";")
        .map((c) => c.trim().split("=")[0])
        .filter((name) =>
            ["_ga", "_gid", "_gat", "_gcl_au"].some((prefix) => name.startsWith(prefix))
        );

    for (const name of names) {
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    }
}

export default function Analytics() {
    const [consent, setConsent] = useState<CookieConsent>(() => getCookieConsent() ?? { analytics: false, marketing: false });
    const analyticsEnabled = consent.analytics;

    useEffect(() => {
        function onConsent(event: Event) {
            const detail = (event as CustomEvent<CookieConsent>).detail;
            if (!detail) return;
            setConsent(detail);
            updateGtagConsent(detail);
            if (!detail.analytics) {
                clearAnalyticsCookies();
            }
        }

        window.addEventListener(COOKIE_CONSENT_EVENT, onConsent);
        return () => window.removeEventListener(COOKIE_CONSENT_EVENT, onConsent);
    }, []);

    const consentParams = useMemo(() => consentModeParams(consent), [consent]);

    if (!analyticsEnabled) return null;

    return (
        <>
            <Script
                id="ef-datalayer"
                strategy="afterInteractive"
                dangerouslySetInnerHTML={{
                    __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}window.gtag=gtag;
gtag('consent','default', ${JSON.stringify(consentParams)});`,
                }}
            />

            {GTM_ID ? (
                <Script
                    id="ef-gtm"
                    strategy="afterInteractive"
                    dangerouslySetInnerHTML={{
                        __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
 j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
 'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
 })(window,document,'script','dataLayer','${GTM_ID}');`,
                    }}
                />
            ) : null}

            {!GTM_ID && GA4_ID ? (
                <>
                    <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`} strategy="afterInteractive" />
                    <Script
                        id="ef-ga4"
                        strategy="afterInteractive"
                        dangerouslySetInnerHTML={{
                            __html: `gtag('js', new Date());
gtag('config', '${GA4_ID}', { send_page_view: true });`,
                        }}
                    />
                </>
            ) : null}
        </>
    );
}
