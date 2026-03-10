export const COOKIE_CONSENT_NAME = "ef_cookie_consent_v2";
const LEGACY_COOKIE_NAME = "ef_cookie_consent";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export type CookieConsent = {
    analytics: boolean;
    marketing: boolean;
};

export const COOKIE_CONSENT_EVENT = "ef_cookie_consent";
export const COOKIE_CONSENT_OPEN_EVENT = "ef_cookie_open";

function isBrowser(): boolean {
    return typeof document !== "undefined";
}

function parseConsentValue(value: string): CookieConsent | null {
    if (!value) return null;

    // Expected format: v=2&a=1&m=0
    const parts = value.split("&").map((p) => p.trim());
    const map = new Map<string, string>();
    for (const part of parts) {
        const [k, v] = part.split("=");
        if (k && v) map.set(k, v);
    }

    const hasVersion = map.get("v") === "2";
    if (!hasVersion) return null;

    const analytics = map.get("a") === "1";
    const marketing = map.get("m") === "1";

    return { analytics, marketing };
}

function serializeConsent(consent: CookieConsent): string {
    return `v=2&a=${consent.analytics ? "1" : "0"}&m=${consent.marketing ? "1" : "0"}`;
}

function readCookie(name: string): string | null {
    if (!isBrowser()) return null;
    const entry = document.cookie
        .split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${name}=`));
    if (!entry) return null;
    return entry.split("=")[1]?.trim() ?? null;
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
    if (!isBrowser()) return;
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
}

function deleteCookie(name: string): void {
    if (!isBrowser()) return;
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
}

export function getCookieConsent(): CookieConsent | null {
    const value = readCookie(COOKIE_CONSENT_NAME);
    const parsed = value ? parseConsentValue(value) : null;
    if (parsed) return parsed;

    // Legacy fallback: map old single-consent to analytics only.
    const legacy = readCookie(LEGACY_COOKIE_NAME);
    if (legacy === "1" || legacy === "0") {
        const mapped: CookieConsent = {
            analytics: legacy === "1",
            marketing: false,
        };
        setCookieConsent(mapped);
        deleteCookie(LEGACY_COOKIE_NAME);
        return mapped;
    }

    return null;
}

export function hasStoredConsent(): boolean {
    return getCookieConsent() !== null;
}

export function allowAnalytics(): boolean {
    return getCookieConsent()?.analytics === true;
}

export function allowMarketing(): boolean {
    return getCookieConsent()?.marketing === true;
}

export function setCookieConsent(consent: CookieConsent): void {
    writeCookie(COOKIE_CONSENT_NAME, serializeConsent(consent), ONE_YEAR_SECONDS);
}

export function clearCookieConsent(): void {
    deleteCookie(COOKIE_CONSENT_NAME);
}

export function dispatchConsent(consent: CookieConsent): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_EVENT, { detail: consent }));
}

export function openConsentPreferences(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(COOKIE_CONSENT_OPEN_EVENT));
}
