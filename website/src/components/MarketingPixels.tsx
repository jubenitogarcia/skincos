"use client";

import { useEffect, useMemo, useState } from "react";
import Script from "next/script";
import { COOKIE_CONSENT_EVENT, getCookieConsent, type CookieConsent } from "@/lib/cookieConsent";

const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;
const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;

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

type FbqFn = (...args: unknown[]) => void;

function getFbq(): FbqFn | null {
    if (typeof window === "undefined") return null;
    const fbq = (window as { fbq?: unknown }).fbq;
    if (typeof fbq !== "function") return null;
    return fbq as FbqFn;
}

function clearMarketingCookies() {
    if (typeof document === "undefined") return;
    const names = document.cookie
        .split(";")
        .map((c) => c.trim().split("=")[0])
        .filter((name) =>
            ["_fbp", "_fbc", "_gcl_", "IDE", "test_cookie"].some((prefix) => name.startsWith(prefix))
        );

    for (const name of names) {
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    }
}

export default function MarketingPixels() {
    const [consent, setConsent] = useState<CookieConsent>(() => getCookieConsent() ?? { analytics: false, marketing: false });
    const [gtagReady, setGtagReady] = useState(false);
    const marketingEnabled = consent.marketing;

    useEffect(() => {
        if (typeof window !== "undefined" && typeof window.gtag === "function") {
            setGtagReady(true);
        }
    }, []);

    useEffect(() => {
        function onConsent(event: Event) {
            const detail = (event as CustomEvent<CookieConsent>).detail;
            if (!detail) return;
            setConsent(detail);
            updateGtagConsent(detail);
            if (!detail.marketing) {
                clearMarketingCookies();
                const fbq = getFbq();
                if (!fbq) return;
                try {
                    fbq("consent", "revoke");
                } catch {
                    // noop
                }
            }
        }

        window.addEventListener(COOKIE_CONSENT_EVENT, onConsent);
        return () => window.removeEventListener(COOKIE_CONSENT_EVENT, onConsent);
    }, []);

    const consentParams = useMemo(() => consentModeParams(consent), [consent]);

    if (!marketingEnabled) return null;

    return (
        <>
            {GOOGLE_ADS_ID ? (
                <>
                    {!gtagReady ? (
                        <Script
                            id="ef-ads-gtag-src"
                            src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`}
                            strategy="afterInteractive"
                            onLoad={() => setGtagReady(true)}
                        />
                    ) : null}
                    <Script
                        id="ef-ads-gtag"
                        strategy="afterInteractive"
                        dangerouslySetInnerHTML={{
                            __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}window.gtag=window.gtag||gtag;
gtag('consent','default', ${JSON.stringify(consentParams)});
gtag('js', new Date());
gtag('config', '${GOOGLE_ADS_ID}');`,
                        }}
                    />
                </>
            ) : null}

            {META_PIXEL_ID ? (
                <Script
                    id="ef-meta-pixel"
                    strategy="afterInteractive"
                    dangerouslySetInnerHTML={{
                        __html: `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
 n.callMethod.apply(n,arguments):n.queue.push(arguments)};
 if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
 n.queue=[];t=b.createElement(e);t.async=!0;
 t.src=v;s=b.getElementsByTagName(e)[0];
 s.parentNode.insertBefore(t,s)}(window, document,'script',
 'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('consent','grant');
fbq('track', 'PageView');`,
                    }}
                />
            ) : null}
        </>
    );
}
