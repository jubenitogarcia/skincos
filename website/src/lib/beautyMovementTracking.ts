import type { SiteBehaviorEventName } from "@/lib/siteBehavior";
import { getCookieConsent } from "@/lib/cookieConsent";

const BEAUTY_MOVEMENT_TRACKABLE_EVENTS = new Set<SiteBehaviorEventName>([
    "beauty_movement_open",
    "beauty_movement_act_view",
    "beauty_movement_card_revealed",
    "beauty_movement_confirmed",
    "beauty_movement_result_view",
    "beauty_movement_conditions_open",
    "beauty_movement_whatsapp",
    "beauty_movement_share",
]);

export function isBeautyMovementTrackableEvent(value: string): value is SiteBehaviorEventName {
    return BEAUTY_MOVEMENT_TRACKABLE_EVENTS.has(value as SiteBehaviorEventName);
}

/** Keeps campaign telemetry aggregate and non-identifying by construction. */
export function sanitizeBeautyMovementTrackingParams(input: Record<string, string | number | boolean | null | undefined> = {}) {
    const result: Record<string, string | number | boolean> = {};
    const actIndex = input.actIndex;
    if (typeof actIndex === "number" && Number.isInteger(actIndex) && actIndex >= 1 && actIndex <= 3) {
        result.actIndex = actIndex;
    }
    const stage = input.stage;
    if (typeof stage === "string" && /^(act|confirmation|result)$/.test(stage)) {
        result.stage = stage;
    }
    const method = input.method;
    if (method === "web_share" || method === "download") {
        result.method = method;
    }
    return result;
}

export type BeautyMovementTrackingPayload = {
    eventName: SiteBehaviorEventName;
    params: Record<string, string | number | boolean>;
};

/**
 * Strict server-side counterpart of the client sanitizer. Campaign telemetry
 * accepts only aggregate state; unexpected fields fail closed instead of being
 * silently persisted in a generic event envelope.
 */
export function parseBeautyMovementTrackingPayload(input: unknown): BeautyMovementTrackingPayload | null {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const record = input as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "eventName" && key !== "params")) return null;
    if (typeof record.eventName !== "string" || !isBeautyMovementTrackableEvent(record.eventName)) return null;
    if (record.params !== undefined && (!record.params || typeof record.params !== "object" || Array.isArray(record.params))) return null;
    const params = (record.params ?? {}) as Record<string, unknown>;
    if (Object.keys(params).some((key) => key !== "actIndex" && key !== "stage" && key !== "method")) return null;
    const sanitized = sanitizeBeautyMovementTrackingParams(params as Record<string, string | number | boolean | null | undefined>);
    if (Object.keys(sanitized).length !== Object.keys(params).length) return null;
    return { eventName: record.eventName, params: sanitized };
}

/** Sends the campaign's separate, minimal analytics envelope after cookie consent. */
export function trackBeautyMovementSiteEvent(eventName: string, params?: Record<string, string | number | boolean | null | undefined>): boolean {
    if (typeof window === "undefined" || !isBeautyMovementTrackableEvent(eventName)) return false;
    if (getCookieConsent()?.analytics !== true) return false;
    const body = JSON.stringify({ eventName, params: sanitizeBeautyMovementTrackingParams(params) });
    try {
        if (navigator.sendBeacon) {
            const blob = new Blob([body], { type: "application/json" });
            if (navigator.sendBeacon("/api/tracking/site-event", blob)) return true;
        }
    } catch {
        // Fall through to fetch; unavailable telemetry must never block the journey.
    }
    void fetch("/api/tracking/site-event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
        credentials: "same-origin",
    }).catch(() => null);
    return true;
}
