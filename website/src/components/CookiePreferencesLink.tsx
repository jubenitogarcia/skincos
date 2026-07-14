"use client";

import { openConsentPreferences } from "@/lib/cookieConsent";

export default function CookiePreferencesLink({ label = "Gerenciar cookies" }: { label?: string }) {
    return (
        <button
            type="button"
            onClick={() => openConsentPreferences()}
            style={{
                textDecoration: "underline",
                background: "none",
                border: 0,
                padding: 0,
                color: "inherit",
                cursor: "pointer",
                font: "inherit",
            }}
        >
            {label}
        </button>
    );
}
