import { getCookieConsent } from "@/lib/cookieConsent";

declare global {
    interface Window {
        fbq?: (...args: unknown[]) => void;
    }
}

type MetaEventParams = Record<string, unknown>;

const DEDUPE_STORAGE_KEY = "ef_meta_dedupe_v1";

function hasMarketingConsent(): boolean {
    if (typeof window === "undefined") return false;
    return getCookieConsent()?.marketing === true;
}

function getFbq(): ((...args: unknown[]) => void) | null {
    if (typeof window === "undefined") return null;
    return typeof window.fbq === "function" ? window.fbq : null;
}

function readDedupedMap(): Record<string, string> {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.sessionStorage.getItem(DEDUPE_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Record<string, string>;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function writeDedupedMap(map: Record<string, string>): void {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.setItem(DEDUPE_STORAGE_KEY, JSON.stringify(map));
    } catch {
        // noop
    }
}

export function createMetaEventId(prefix = "meta"): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function markMetaEventSent(dedupeKey: string, eventId: string): void {
    const map = readDedupedMap();
    map[dedupeKey] = eventId;
    writeDedupedMap(map);
}

export function readMetaEventSent(dedupeKey: string): string | null {
    return readDedupedMap()[dedupeKey] ?? null;
}

export function trackMetaStandardEvent(
    eventName: string,
    params: MetaEventParams = {},
    options: { eventId?: string; dedupeKey?: string } = {},
): string | null {
    if (!hasMarketingConsent()) return null;

    const fbq = getFbq();
    if (!fbq) return null;

    if (options.dedupeKey) {
        const previousEventId = readMetaEventSent(options.dedupeKey);
        if (previousEventId) return previousEventId;
    }

    const eventId = options.eventId ?? createMetaEventId(eventName.toLowerCase());

    try {
        fbq("track", eventName, params, { eventID: eventId });
        if (options.dedupeKey) {
            markMetaEventSent(options.dedupeKey, eventId);
        }
        return eventId;
    } catch {
        return null;
    }
}

export function trackMetaPageView(params: MetaEventParams = {}): string | null {
    return trackMetaStandardEvent("PageView", params);
}
