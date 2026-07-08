"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    dispatchConsent,
    getCookieConsent,
    hasStoredConsent,
    setCookieConsent,
    COOKIE_CONSENT_OPEN_EVENT,
    type CookieConsent,
} from "@/lib/cookieConsent";

export default function CookieBanner() {
    const [visible, setVisible] = useState(false);
    const [showPreferences, setShowPreferences] = useState(false);
    const [preferences, setPreferences] = useState<CookieConsent>({ analytics: false, marketing: false });

    useEffect(() => {
        const consent = getCookieConsent();
        setPreferences(consent ?? { analytics: false, marketing: false });
        setVisible(!hasStoredConsent());
        setShowPreferences(false);
    }, []);

    useEffect(() => {
        function onOpenPrefs() {
            const consent = getCookieConsent();
            setPreferences(consent ?? { analytics: false, marketing: false });
            setShowPreferences(true);
            setVisible(true);
        }

        window.addEventListener(COOKIE_CONSENT_OPEN_EVENT, onOpenPrefs);
        return () => window.removeEventListener(COOKIE_CONSENT_OPEN_EVENT, onOpenPrefs);
    }, []);

    if (!visible) return null;

    function applyConsent(consent: CookieConsent) {
        setCookieConsent(consent);
        dispatchConsent(consent);
        setPreferences(consent);
        setShowPreferences(false);
        setVisible(false);
    }

    const hasExistingConsent = hasStoredConsent();
    const closeBanner = () => {
        if (hasExistingConsent) {
            setVisible(false);
            setShowPreferences(false);
            return;
        }

        applyConsent({ analytics: false, marketing: false });
    };

    return (
        <div className="cookieBanner" role="dialog" aria-modal="true" aria-label="Cookies">
            <button
                className="cookieBannerClose"
                type="button"
                aria-label={hasExistingConsent ? "Fechar preferências de cookies" : "Rejeitar cookies opcionais"}
                onClick={closeBanner}
            >
                ×
            </button>
            <div className={`cookieBannerInner ${showPreferences ? "cookieBannerInner--expanded" : "cookieBannerInner--compact"}`.trim()}>
                <div className="cookieBannerText">
                    Usamos cookies essenciais para manter tudo firme e no lugar. Com seu consentimento, também
                    usamos cookies de análise e marketing para dar mais glow à sua experiência. Nada de
                    procedimento invasivo: você aceita, recusa ou retoca suas preferências. 🍪
                    <span style={{ display: "inline-block", marginLeft: 6 }}>
                        <Link href="/privacidade" style={{ textDecoration: "underline" }}>
                            Saiba mais
                        </Link>
                        .
                    </span>
                </div>

                {showPreferences ? (
                    <div className="cookieBannerPreferences" aria-label="Preferências de cookies">
                        <label className="cookieToggle cookieToggle--locked">
                            <span className="cookieToggle__copy">
                                <strong>Essenciais</strong>
                                <span>Necessários para funcionamento, segurança básica e navegação do site.</span>
                            </span>
                            <span className="cookieToggle__state">Sempre ativos</span>
                        </label>

                        <label className="cookieToggle">
                            <span className="cookieToggle__copy">
                                <strong>Análise</strong>
                                <span>Permitem medir navegação, funil e desempenho para evoluir a experiência.</span>
                            </span>
                            <input
                                type="checkbox"
                                checked={preferences.analytics}
                                onChange={(event) =>
                                    setPreferences((current) => ({
                                        ...current,
                                        analytics: event.target.checked,
                                    }))
                                }
                            />
                        </label>

                        <label className="cookieToggle">
                            <span className="cookieToggle__copy">
                                <strong>Marketing</strong>
                                <span>Permitem atribuição de campanhas, remarketing e mensuração de mídia paga.</span>
                            </span>
                            <input
                                type="checkbox"
                                checked={preferences.marketing}
                                onChange={(event) =>
                                    setPreferences((current) => ({
                                        ...current,
                                        marketing: event.target.checked,
                                    }))
                                }
                            />
                        </label>
                    </div>
                ) : null}

                <div className="cookieBannerActions">
                    <button
                        className="cookieBannerButton cookieBannerButton--ghost"
                        onClick={() => {
                            if (showPreferences) {
                                applyConsent(preferences);
                                return;
                            }

                            setShowPreferences(true);
                        }}
                    >
                        Retocar
                    </button>
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
