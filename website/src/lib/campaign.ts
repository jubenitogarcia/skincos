import { getCookieConsent } from "@/lib/cookieConsent";

export const CAMPAIGN_PARAM_KEYS = [
    // Google Ads / analytics
    "gclid",
    "gbraid",
    "wbraid",
    "msclkid",

    // UTMs
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",

    // common social / misc
    "fbclid",
] as const;

export type CampaignParamKey = (typeof CAMPAIGN_PARAM_KEYS)[number];
export type CampaignParams = Partial<Record<CampaignParamKey, string>>;

const STORAGE_KEY = "ef_campaign_params_v1";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function isCampaignTrackingAllowed(): boolean {
    if (typeof window === "undefined") return false;
    const consent = getCookieConsent();
    return Boolean(consent?.analytics || consent?.marketing);
}

function isBrowser(): boolean {
    return typeof window !== "undefined";
}

export function extractCampaignParamsFromSearchParams(searchParams: URLSearchParams): CampaignParams {
    const result: CampaignParams = {};

    for (const key of CAMPAIGN_PARAM_KEYS) {
        const value = searchParams.get(key);
        if (value && value.trim()) {
            result[key] = value.trim();
        }
    }

    return result;
}

export function persistCampaignParams(params: CampaignParams): void {
    if (!isBrowser()) return;
    if (!isCampaignTrackingAllowed()) return;

    const entries = Object.entries(params).filter(([, v]) => typeof v === "string" && v.trim().length > 0);
    if (entries.length === 0) return;

    const payload = {
        v: 1,
        ts: Date.now(),
        params: Object.fromEntries(entries),
    };

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // noop
    }

    try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // noop
    }
}

export function readPersistedCampaignParams(): CampaignParams {
    if (!isBrowser()) return {};
    if (!isCampaignTrackingAllowed()) return {};

    const raw =
        (() => {
            try {
                return window.sessionStorage.getItem(STORAGE_KEY);
            } catch {
                return null;
            }
        })() ??
        (() => {
            try {
                return window.localStorage.getItem(STORAGE_KEY);
            } catch {
                return null;
            }
        })();

    if (!raw) return {};

    try {
        const parsed = JSON.parse(raw) as { ts?: number; params?: Record<string, unknown> };
        if (!parsed || typeof parsed !== "object") return {};

        const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
        if (ts && Date.now() - ts > MAX_AGE_MS) return {};

        const params = parsed.params && typeof parsed.params === "object" ? parsed.params : null;
        if (!params) return {};

        const cleaned: CampaignParams = {};
        for (const key of CAMPAIGN_PARAM_KEYS) {
            const value = params[key];
            if (typeof value === "string" && value.trim()) {
                cleaned[key] = value.trim();
            }
        }

        return cleaned;
    } catch {
        return {};
    }
}

export function readCurrentCampaignParams(): CampaignParams {
    if (!isBrowser()) return {};
    if (!isCampaignTrackingAllowed()) return {};

    try {
        return extractCampaignParamsFromSearchParams(new URLSearchParams(window.location.search));
    } catch {
        return {};
    }
}

export function campaignParamsForEvent(): Record<string, string> {
    if (!isCampaignTrackingAllowed()) return {};
    const persisted = readPersistedCampaignParams();
    const current = readCurrentCampaignParams();
    const merged = { ...persisted, ...current };

    return Object.fromEntries(
        Object.entries(merged).filter(([, v]) => typeof v === "string" && v.length > 0)
    ) as Record<string, string>;
}
