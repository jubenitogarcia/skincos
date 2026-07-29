import { buildWhatsAppUrl } from "@/lib/whatsapp";
import { mergeCampaignParamsIntoUrl } from "@/lib/mergeCampaignParams";
import type { TrackingContext } from "@/lib/attribution";

export type WhatsappTrackingPayload = {
    eventId?: string | null;
    placement?: string | null;
    unitSlug?: string | null;
    doctorName?: string | null;
    source?: string | null;
    pageUrl?: string | null;
    pagePath?: string | null;
    bookingId?: string | null;
    trackingContext?: TrackingContext | null;
};

const WHATSAPP_HOSTS = new Set(["wa.me", "api.whatsapp.com", "chat.whatsapp.com"]);

function normalizeUrl(value: string | null | undefined): string | null {
    const trimmed = (value ?? "").trim();
    return trimmed || null;
}

type CompactAttributionTouch = Pick<
    NonNullable<TrackingContext["firstTouch"]>,
    "capturedAtMs" | "referrer" | "params" | "fbclid"
>;

type CompactTrackingContext = Omit<TrackingContext, "firstTouch" | "lastTouch"> & {
    firstTouch: CompactAttributionTouch | null;
    lastTouch: CompactAttributionTouch | null;
};

function compactTouch(
    touch: TrackingContext["firstTouch"],
): CompactAttributionTouch | null {
    if (!touch) return null;
    return {
        capturedAtMs: touch.capturedAtMs,
        referrer: touch.referrer,
        params: touch.params,
        fbclid: touch.fbclid,
    };
}

function compactTrackingContext(context: TrackingContext): CompactTrackingContext {
    return {
        ...context,
        // The redirect already carries the normalized top-level attribution.
        // Keep the distinct touch timestamp/campaign/referrer while omitting
        // URLs and Facebook IDs that the server can reconstruct from the
        // corresponding top-level first/current fields.
        firstTouch: compactTouch(context.firstTouch),
        lastTouch: compactTouch(context.lastTouch),
    };
}

export function expandWhatsappTrackingContext(raw: unknown): unknown {
    if (!raw || typeof raw !== "object") return raw;
    const context = raw as Partial<CompactTrackingContext>;

    const expandTouch = (
        touch: CompactAttributionTouch | null | undefined,
        landingUrl: string | null | undefined,
        landingPath: string | null | undefined,
    ) => {
        if (!touch || !landingUrl || !landingPath) return null;
        return {
            ...touch,
            landingUrl,
            landingPath,
            fbp: context.fbp ?? null,
            fbc: context.fbc ?? null,
        };
    };

    return {
        ...context,
        firstTouch: expandTouch(
            context.firstTouch,
            context.landingUrl,
            context.landingPath,
        ),
        lastTouch: expandTouch(
            context.lastTouch,
            context.pageUrl ?? context.landingUrl,
            context.pagePath ?? context.landingPath,
        ),
    };
}

export function isSupportedWhatsappUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return WHATSAPP_HOSTS.has(url.hostname);
    } catch {
        return false;
    }
}

export function parseWhatsappDestination(rawUrl: string): { destinationUrl: string; phone: string | null; text: string | null } | null {
    try {
        const url = new URL(rawUrl);
        if (!WHATSAPP_HOSTS.has(url.hostname)) return null;

        if (url.hostname === "wa.me") {
            const phone = url.pathname.replace(/\//g, "").trim() || null;
            const text = normalizeUrl(url.searchParams.get("text"));
            return { destinationUrl: url.toString(), phone, text };
        }

        const phone =
            normalizeUrl(url.searchParams.get("phone")) ??
            normalizeUrl(url.pathname.replace(/^\/send\/?/, "").trim()) ??
            null;
        const text = normalizeUrl(url.searchParams.get("text"));
        return { destinationUrl: url.toString(), phone, text };
    } catch {
        return null;
    }
}

export function buildWhatsappRedirectHref(params: {
    rawUrl?: string | null;
    phone?: string | null;
    text?: string | null;
    tracking?: WhatsappTrackingPayload;
}): string | null {
    const destinationUrl =
        normalizeUrl(params.rawUrl) ??
        (params.phone ? buildWhatsAppUrl(params.phone, params.text ?? "") : null);
    if (!destinationUrl) return null;
    if (!isSupportedWhatsappUrl(destinationUrl)) return null;

    const url = new URL("/api/whatsapp/redirect", "https://espacofacial.com");
    url.searchParams.set("dest", destinationUrl);

    const tracking = params.tracking;
    if (tracking?.eventId) url.searchParams.set("event_id", tracking.eventId);
    if (tracking?.placement) url.searchParams.set("placement", tracking.placement);
    if (tracking?.unitSlug) url.searchParams.set("unit_slug", tracking.unitSlug);
    if (tracking?.doctorName) url.searchParams.set("doctor_name", tracking.doctorName);
    if (tracking?.source) url.searchParams.set("source", tracking.source);
    if (tracking?.pageUrl && !tracking.trackingContext) url.searchParams.set("page_url", tracking.pageUrl);
    if (tracking?.pagePath && !tracking.trackingContext) url.searchParams.set("page_path", tracking.pagePath);
    if (tracking?.bookingId) url.searchParams.set("booking_id", tracking.bookingId);
    if (tracking?.trackingContext) {
        url.searchParams.set("ctx", JSON.stringify(compactTrackingContext(tracking.trackingContext)));
    }

    return `${url.pathname}${url.search}`;
}

export function buildWhatsappRedirectHrefFromRequest(params: {
    requestUrl: string;
    rawUrl?: string | null;
    phone?: string | null;
    text?: string | null;
    tracking?: WhatsappTrackingPayload;
}): string | null {
    const destinationUrl =
        normalizeUrl(params.rawUrl) ??
        (params.phone ? buildWhatsAppUrl(params.phone, params.text ?? "") : null);
    if (!destinationUrl) return null;
    if (!isSupportedWhatsappUrl(destinationUrl)) return null;

    const mergedDestination = mergeCampaignParamsIntoUrl(destinationUrl, params.requestUrl);
    return buildWhatsappRedirectHref({
        rawUrl: mergedDestination,
        tracking: params.tracking,
    });
}

export function buildWhatsappClickToken(waClickId: string): string {
    return `EF-${waClickId.slice(0, 8).toUpperCase()}`;
}

export function injectWhatsappToken(message: string | null, token: string): string {
    const base = (message ?? "").trim();
    const suffix = ` Ref:${token}`;
    if (!base) return `Olá!${suffix}`;
    if (base.includes(token)) return base;
    return `${base}${suffix}`;
}
