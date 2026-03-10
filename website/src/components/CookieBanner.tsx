"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    dispatchConsent,
    hasStoredConsent,
    setCookieConsent,
    COOKIE_CONSENT_OPEN_EVENT,
    type CookieConsent,
} from "@/lib/cookieConsent";

export default function CookieBanner() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        setVisible(!hasStoredConsent());
    }, []);

    useEffect(() => {
        function onOpenPrefs() {
            setVisible(true);
        }

        window.addEventListener(COOKIE_CONSENT_OPEN_EVENT, onOpenPrefs);
        return () => window.removeEventListener(COOKIE_CONSENT_OPEN_EVENT, onOpenPrefs);
    }, []);

    if (!visible) return null;

    function applyConsent(consent: CookieConsent) {
        setCookieConsent(consent);
        dispatchConsent(consent);
        setVisible(false);
    }

    return (
        <div className="cookieBanner" role="dialog" aria-label="Cookies">
            <button
                className="cookieBannerClose"
                type="button"
                aria-label="Rejeitar cookies"
                onClick={() => {
                    applyConsent({ analytics: false, marketing: false });
                }}
            >
                ×
            </button>
            <div className="cookieBannerInner cookieBannerInner--compact">
                <div className="cookieBannerText">
                    Usamos cookies essenciais e, com seu consentimento, cookies de análise e marketing para melhorar
                    sua experiência, medir resultados e oferecer conteúdos relevantes.
                    <span style={{ display: "inline-block", marginLeft: 6 }}>
                        <Link href="/privacidade" style={{ textDecoration: "underline" }}>
                            Saiba mais
                        </Link>
                        .
                    </span>
                </div>

                <div className="cookieBannerActions">
                    <button
                        className="cookieBannerButton"
                        onClick={() => {
                            applyConsent({ analytics: true, marketing: true });
                        }}
                    >
                        Aceitar
                    </button>
                </div>
            </div>
        </div>
    );
}
