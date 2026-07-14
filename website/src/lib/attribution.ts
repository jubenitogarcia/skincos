import { getCookieConsent, type CookieConsent } from "@/lib/cookieConsent";

export const CAMPAIGN_PARAM_KEYS = [
    "gclid",
    "gbraid",
    "wbraid",
    "msclkid",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "fbclid",
] as const;

export type CampaignParamKey = (typeof CAMPAIGN_PARAM_KEYS)[number];
export type CampaignParams = Partial<Record<CampaignParamKey, string>>;

export type AttributionTouch = {
    capturedAtMs: number;
    landingUrl: string;
    landingPath: string;
    referrer: string | null;
    params: CampaignParams;
    fbclid: string | null;
    fbp: string | null;
    fbc: string | null;
};

export type StoredAttribution = {
    v: 2;
    updatedAtMs: number;
    consent: CookieConsent;
    landingUrl: string | null;
    landingPath: string | null;
    referrer: string | null;
    params: CampaignParams;
    fbclid: string | null;
    fbp: string | null;
    fbc: string | null;
    firstTouch: AttributionTouch | null;
    lastTouch: AttributionTouch | null;
};

export type TrackingContext = {
    capturedAtMs: number;
    pageUrl: string | null;
    pagePath: string | null;
    referrer: string | null;
    consent: CookieConsent;
    params: CampaignParams;
    fbclid: string | null;
    fbp: string | null;
    fbc: string | null;
    landingUrl: string | null;
    landingPath: string | null;
    firstTouch: AttributionTouch | null;
    lastTouch: AttributionTouch | null;
};

const STORAGE_KEY = "ef:attribution:snapshot:v2";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function isBrowser(): boolean {
    return typeof window !== "undefined";
}

export function isTrackingAllowed(consent: CookieConsent | null | undefined): boolean {
    return Boolean(consent?.analytics || consent?.marketing);
}

function readCookieValue(name: string): string | null {
    if (typeof document === "undefined") return null;
    const entry = document.cookie
        .split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith(`${name}=`));
    if (!entry) return null;
    return entry.slice(name.length + 1).trim() || null;
}

function readStorage(key: string): string | null {
    if (!isBrowser()) return null;

    const fromSession =
        (() => {
            try {
                return window.sessionStorage.getItem(key);
            } catch {
                return null;
            }
        })();
    if (fromSession) return fromSession;

    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key: string, value: string): void {
    if (!isBrowser()) return;
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // noop
    }
    try {
        window.sessionStorage.setItem(key, value);
    } catch {
        // noop
    }
}

function normalizeUrl(value: string | null | undefined): string | null {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return null;
    return trimmed;
}

function currentPageUrl(): string | null {
    if (!isBrowser()) return null;
    return normalizeUrl(window.location.href);
}

function currentPagePath(): string | null {
    if (!isBrowser()) return null;
    return normalizeUrl(`${window.location.pathname}${window.location.search}${window.location.hash}`);
}

export function deriveFbcFromFbclid(fbclid: string | null | undefined, capturedAtMs: number): string | null {
    const normalized = (fbclid ?? "").trim();
    if (!normalized) return null;
    return `fb.1.${Math.floor(capturedAtMs / 1000)}.${normalized}`;
}

export function readFacebookBrowserId(): string | null {
    return normalizeUrl(readCookieValue("_fbp"));
}

export function readFacebookClickIdCookie(): string | null {
    return normalizeUrl(readCookieValue("_fbc"));
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

function cleanCampaignParams(params: Record<string, unknown> | null | undefined): CampaignParams {
    const cleaned: CampaignParams = {};
    if (!params || typeof params !== "object") return cleaned;

    for (const key of CAMPAIGN_PARAM_KEYS) {
        const value = params[key];
        if (typeof value === "string" && value.trim()) {
            cleaned[key] = value.trim();
        }
    }

    return cleaned;
}

function parseStored(raw: string | null): StoredAttribution | null {
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as Partial<StoredAttribution>;
        if (!parsed || typeof parsed !== "object") return null;
        const updatedAtMs = typeof parsed.updatedAtMs === "number" ? parsed.updatedAtMs : 0;
        if (!updatedAtMs || Date.now() - updatedAtMs > MAX_AGE_MS) return null;

        const consent = parsed.consent ?? { analytics: false, marketing: false };
        const firstTouch = parsed.firstTouch && typeof parsed.firstTouch === "object"
            ? {
                capturedAtMs: typeof parsed.firstTouch.capturedAtMs === "number" ? parsed.firstTouch.capturedAtMs : updatedAtMs,
                landingUrl: normalizeUrl(parsed.firstTouch.landingUrl) ?? "",
                landingPath: normalizeUrl(parsed.firstTouch.landingPath) ?? "",
                referrer: normalizeUrl(parsed.firstTouch.referrer),
                params: cleanCampaignParams(parsed.firstTouch.params),
                fbclid: normalizeUrl(parsed.firstTouch.fbclid),
                fbp: normalizeUrl(parsed.firstTouch.fbp),
                fbc: normalizeUrl(parsed.firstTouch.fbc),
            }
            : null;
        const lastTouch = parsed.lastTouch && typeof parsed.lastTouch === "object"
            ? {
                capturedAtMs: typeof parsed.lastTouch.capturedAtMs === "number" ? parsed.lastTouch.capturedAtMs : updatedAtMs,
                landingUrl: normalizeUrl(parsed.lastTouch.landingUrl) ?? "",
                landingPath: normalizeUrl(parsed.lastTouch.landingPath) ?? "",
                referrer: normalizeUrl(parsed.lastTouch.referrer),
                params: cleanCampaignParams(parsed.lastTouch.params),
                fbclid: normalizeUrl(parsed.lastTouch.fbclid),
                fbp: normalizeUrl(parsed.lastTouch.fbp),
                fbc: normalizeUrl(parsed.lastTouch.fbc),
            }
            : null;

        return {
            v: 2,
            updatedAtMs,
            consent: {
                analytics: consent.analytics === true,
                marketing: consent.marketing === true,
            },
            landingUrl: normalizeUrl(parsed.landingUrl),
            landingPath: normalizeUrl(parsed.landingPath),
            referrer: normalizeUrl(parsed.referrer),
            params: cleanCampaignParams(parsed.params),
            fbclid: normalizeUrl(parsed.fbclid),
            fbp: normalizeUrl(parsed.fbp),
            fbc: normalizeUrl(parsed.fbc),
            firstTouch,
            lastTouch,
        };
    } catch {
        return null;
    }
}

function buildTouch(params: {
    now: number;
    pageUrl: string | null;
    pagePath: string | null;
    referrer: string | null;
    campaignParams: CampaignParams;
    fbp: string | null;
    fbclid: string | null;
    fbc: string | null;
}): AttributionTouch | null {
    if (!params.pageUrl || !params.pagePath) return null;

    return {
        capturedAtMs: params.now,
        landingUrl: params.pageUrl,
        landingPath: params.pagePath,
        referrer: params.referrer,
        params: params.campaignParams,
        fbclid: params.fbclid,
        fbp: params.fbp,
        fbc: params.fbc,
    };
}

export function readPersistedAttribution(): StoredAttribution | null {
    if (!isBrowser()) return null;
    if (!isTrackingAllowed(getCookieConsent())) return null;
    return parseStored(readStorage(STORAGE_KEY));
}

export function readCurrentCampaignParams(): CampaignParams {
    if (!isBrowser()) return {};
    if (!isTrackingAllowed(getCookieConsent())) return {};

    try {
        return extractCampaignParamsFromSearchParams(new URLSearchParams(window.location.search));
    } catch {
        return {};
    }
}

export function persistAttributionSnapshot(params: {
    searchParams?: URLSearchParams;
    pageUrl?: string | null;
    pagePath?: string | null;
    referrer?: string | null;
    consent?: CookieConsent | null;
} = {}): StoredAttribution | null {
    if (!isBrowser()) return null;

    const consent = params.consent ?? getCookieConsent();
    if (!isTrackingAllowed(consent)) return null;

    const now = Date.now();
    const existing = parseStored(readStorage(STORAGE_KEY));
    const pageUrl = normalizeUrl(params.pageUrl) ?? currentPageUrl();
    const pagePath = normalizeUrl(params.pagePath) ?? currentPagePath();
    const referrer = normalizeUrl(params.referrer) ?? normalizeUrl(document.referrer);
    const searchParams = params.searchParams ?? new URLSearchParams(window.location.search);
    const campaignParams = extractCampaignParamsFromSearchParams(searchParams);
    const mergedParams = { ...(existing?.params ?? {}), ...campaignParams };
    const fbclid = campaignParams.fbclid ?? existing?.fbclid ?? null;
    const fbp = readFacebookBrowserId() ?? existing?.fbp ?? null;
    const fbc = readFacebookClickIdCookie() ?? deriveFbcFromFbclid(fbclid, now) ?? existing?.fbc ?? null;

    const hasFreshTouch = Object.keys(campaignParams).length > 0 || !existing?.firstTouch;
    const currentTouch = buildTouch({
        now,
        pageUrl,
        pagePath,
        referrer,
        campaignParams: mergedParams,
        fbp,
        fbclid,
        fbc,
    });

    const snapshot: StoredAttribution = {
        v: 2,
        updatedAtMs: now,
        consent: {
            analytics: consent?.analytics === true,
            marketing: consent?.marketing === true,
        },
        landingUrl: existing?.landingUrl ?? pageUrl,
        landingPath: existing?.landingPath ?? pagePath,
        referrer: existing?.referrer ?? referrer,
        params: mergedParams,
        fbclid,
        fbp,
        fbc,
        firstTouch: existing?.firstTouch ?? currentTouch,
        lastTouch: hasFreshTouch ? currentTouch : existing?.lastTouch ?? currentTouch,
    };

    writeStorage(STORAGE_KEY, JSON.stringify(snapshot));
    return snapshot;
}

export function persistCampaignParams(params: CampaignParams): void {
    if (!isBrowser()) return;
    if (!isTrackingAllowed(getCookieConsent())) return;
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === "string" && value.trim()) searchParams.set(key, value.trim());
    }
    persistAttributionSnapshot({ searchParams });
}

export function campaignParamsForEvent(): Record<string, string> {
    const snapshot = readPersistedAttribution();
    const current = readCurrentCampaignParams();
    const merged = {
        ...(snapshot?.params ?? {}),
        ...current,
    };

    return Object.fromEntries(
        Object.entries(merged).filter(([, value]) => typeof value === "string" && value.length > 0)
    ) as Record<string, string>;
}

export function buildTrackingContextFromBrowser(extra: {
    pageUrl?: string | null;
    pagePath?: string | null;
    referrer?: string | null;
} = {}): TrackingContext | null {
    if (!isBrowser()) return null;

    const consent = getCookieConsent();
    if (!isTrackingAllowed(consent)) return null;

    const snapshot = persistAttributionSnapshot({
        pageUrl: extra.pageUrl,
        pagePath: extra.pagePath,
        referrer: extra.referrer,
        consent,
    }) ?? readPersistedAttribution();
    if (!snapshot) return null;

    return {
        capturedAtMs: Date.now(),
        pageUrl: normalizeUrl(extra.pageUrl) ?? currentPageUrl(),
        pagePath: normalizeUrl(extra.pagePath) ?? currentPagePath(),
        referrer: normalizeUrl(extra.referrer) ?? normalizeUrl(document.referrer),
        consent: snapshot.consent,
        params: snapshot.params,
        fbclid: snapshot.fbclid,
        fbp: snapshot.fbp,
        fbc: snapshot.fbc,
        landingUrl: snapshot.landingUrl,
        landingPath: snapshot.landingPath,
        firstTouch: snapshot.firstTouch,
        lastTouch: snapshot.lastTouch,
    };
}
