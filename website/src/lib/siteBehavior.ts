import { buildTrackingContextFromBrowser, type CampaignParams } from "@/lib/attribution";
import { getCookieConsent, type CookieConsent } from "@/lib/cookieConsent";
import { isSupportedWhatsappUrl } from "@/lib/whatsappTracking";

export const SITE_BEHAVIOR_EVENT_NAMES = [
    "page_view",
    "cta_click",
    "custom_link_click",
    "external_link_click",
    "booking_step_view",
    "booking_step_completed",
    "booking_submit_attempt",
    "booking_confirmed",
    "whatsapp_redirect_click",
] as const;

export type SiteBehaviorEventName = (typeof SITE_BEHAVIOR_EVENT_NAMES)[number];

export type SiteBehaviorPayload = {
    eventName: SiteBehaviorEventName;
    pageUrl?: string | null;
    pagePath?: string | null;
    referrer?: string | null;
    landingPage?: string | null;
    params?: CampaignParams;
    fbclid?: string | null;
    fbp?: string | null;
    fbc?: string | null;
    linkUrl?: string | null;
    linkHost?: string | null;
    linkPath?: string | null;
    linkType?: string | null;
    placement?: string | null;
    source?: string | null;
    unitSlug?: string | null;
    serviceId?: string | null;
    bookingId?: string | null;
    metadata?: Record<string, unknown> | null;
};

const SESSION_STORAGE_KEY = "ef:site-behavior:session:v1";
const MAX_METADATA_KEYS = 12;
const MAX_METADATA_VALUE_LENGTH = 120;

function isBrowser(): boolean {
    return typeof window !== "undefined";
}

function normalizeString(value: unknown, max = 500): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (!trimmed) return null;
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function readOrCreateSessionId(): string | null {
    if (!isBrowser()) return null;
    try {
        const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (existing) return existing;
        const next = crypto.randomUUID();
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, next);
        return next;
    } catch {
        return null;
    }
}

export function sanitizeSiteBehaviorMetadata(input: Record<string, unknown> | null | undefined): Record<string, string | number | boolean | null> | null {
    if (!input || typeof input !== "object") return null;
    const out: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(input).slice(0, MAX_METADATA_KEYS)) {
        const cleanKey = normalizeString(key, 40);
        if (!cleanKey) continue;
        if (typeof value === "string") out[cleanKey] = normalizeString(value, MAX_METADATA_VALUE_LENGTH);
        else if (typeof value === "number" && Number.isFinite(value)) out[cleanKey] = value;
        else if (typeof value === "boolean" || value === null) out[cleanKey] = value;
    }
    return Object.keys(out).length ? out : null;
}

export function classifySiteLinkClick(rawHref: string, currentHost: string): SiteBehaviorEventName | null {
    try {
        const baseUrl = isBrowser() ? window.location.origin : "https://espacofacial.com";
        const url = new URL(rawHref, baseUrl);
        const isWhatsappRedirect = url.pathname === "/api/whatsapp/redirect";
        const dest = url.searchParams.get("dest");
        if (isWhatsappRedirect && dest && isSupportedWhatsappUrl(dest)) return "whatsapp_redirect_click";

        const hasUtm = Array.from(url.searchParams.keys()).some((key) => key.startsWith("utm_"));
        if (hasUtm) return "custom_link_click";

        const isExternal = url.hostname !== currentHost;
        if (isExternal) return "external_link_click";

        if (url.pathname.startsWith("/agendamento") || url.pathname.includes("faleconosco")) return "cta_click";
        return null;
    } catch {
        return null;
    }
}

function buildClientPayload(payload: SiteBehaviorPayload, consent: CookieConsent) {
    const trackingContext = buildTrackingContextFromBrowser({
        pageUrl: payload.pageUrl ?? window.location.href,
        pagePath: payload.pagePath ?? `${window.location.pathname}${window.location.search}${window.location.hash}`,
        referrer: payload.referrer ?? document.referrer,
    });
    const params = payload.params ?? trackingContext?.params ?? {};
    const allowMarketing = consent.marketing === true;

    return {
        eventName: payload.eventName,
        sessionId: readOrCreateSessionId(),
        pageUrl: payload.pageUrl ?? window.location.href,
        pagePath: payload.pagePath ?? `${window.location.pathname}${window.location.search}${window.location.hash}`,
        referrer: payload.referrer ?? document.referrer,
        landingPage: payload.landingPage ?? trackingContext?.landingPath ?? null,
        params,
        fbclid: allowMarketing ? payload.fbclid ?? trackingContext?.fbclid ?? params.fbclid ?? null : null,
        fbp: allowMarketing ? payload.fbp ?? trackingContext?.fbp ?? null : null,
        fbc: allowMarketing ? payload.fbc ?? trackingContext?.fbc ?? null : null,
        linkUrl: payload.linkUrl ?? null,
        linkHost: payload.linkHost ?? null,
        linkPath: payload.linkPath ?? null,
        linkType: payload.linkType ?? null,
        placement: payload.placement ?? null,
        source: payload.source ?? null,
        unitSlug: payload.unitSlug ?? null,
        serviceId: payload.serviceId ?? null,
        bookingId: payload.bookingId ?? null,
        consent: {
            analytics: consent.analytics === true,
            marketing: consent.marketing === true,
        },
        metadata: sanitizeSiteBehaviorMetadata(payload.metadata),
    };
}

export function trackSiteBehaviorEvent(payload: SiteBehaviorPayload): boolean {
    if (!isBrowser()) return false;
    const consent = getCookieConsent();
    if (consent?.analytics !== true) return false;

    const body = JSON.stringify(buildClientPayload(payload, consent));
    try {
        if (navigator.sendBeacon) {
            const blob = new Blob([body], { type: "application/json" });
            if (navigator.sendBeacon("/api/tracking/site-event", blob)) return true;
        }
    } catch {
        // fall back to fetch
    }

    void fetch("/api/tracking/site-event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
    }).catch(() => null);
    return true;
}
