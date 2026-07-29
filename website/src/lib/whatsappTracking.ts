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
const MAX_WHATSAPP_REDIRECT_HREF_LENGTH = 2_000;

function normalizeUrl(value: string | null | undefined): string | null {
    const trimmed = (value ?? "").trim();
    return trimmed || null;
}

type CompactValueReference = 0 | 1 | string | null;
type CompactAttributionTouchV1 = [
    capturedAtMs: 0 | number,
    landingUrl: CompactValueReference,
    landingPath: CompactValueReference,
    referrer: 0 | string | null,
    params: 0 | NonNullable<TrackingContext["firstTouch"]>["params"],
    fbclid: 0 | string | null,
    fbp: CompactValueReference,
    fbc: CompactValueReference,
];

type CompactTrackingContextV1 = {
    v: 1;
    c: number;
    u: string | null;
    p: 0 | string | null;
    r: string | null;
    o: [analytics: boolean, marketing: boolean];
    q: TrackingContext["params"];
    i: 0 | string | null;
    b: string | null;
    f: string | null;
    l: CompactValueReference;
    h: CompactValueReference;
    a: CompactAttributionTouchV1 | null;
    z: CompactAttributionTouchV1 | null;
};

function pathFromUrl(value: string | null): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return null;
    }
}

function campaignParamsEqual(
    left: TrackingContext["params"],
    right: TrackingContext["params"],
): boolean {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every((key) => left[key as keyof typeof left] === right[key as keyof typeof right]);
}

function compactValue(
    value: string | null,
    primary: string | null,
    secondary: string | null = null,
): CompactValueReference {
    if (value === primary) return 0;
    if (value === secondary) return 1;
    return value;
}

function compactTouch(
    touch: TrackingContext["firstTouch"],
    context: TrackingContext,
): CompactAttributionTouchV1 | null {
    if (!touch) return null;
    return [
        touch.capturedAtMs === context.capturedAtMs ? 0 : touch.capturedAtMs,
        compactValue(touch.landingUrl, context.landingUrl, context.pageUrl),
        compactValue(touch.landingPath, context.landingPath, context.pagePath),
        touch.referrer === context.referrer ? 0 : touch.referrer,
        campaignParamsEqual(touch.params, context.params) ? 0 : touch.params,
        touch.fbclid === context.fbclid ? 0 : touch.fbclid,
        compactValue(touch.fbp, context.fbp),
        compactValue(touch.fbc, context.fbc),
    ];
}

function compactTrackingContext(context: TrackingContext): CompactTrackingContextV1 {
    return {
        v: 1,
        c: context.capturedAtMs,
        u: context.pageUrl,
        p: context.pagePath === pathFromUrl(context.pageUrl) ? 0 : context.pagePath,
        r: context.referrer,
        o: [context.consent.analytics, context.consent.marketing],
        q: context.params,
        i: context.fbclid === context.params.fbclid ? 0 : context.fbclid,
        b: context.fbp,
        f: context.fbc,
        l: compactValue(context.landingUrl, context.pageUrl),
        h: compactValue(context.landingPath, context.pagePath),
        // The compact tuple preserves each touch's own URL/path and identifiers.
        // References 0/1 avoid repeating the top-level first/current values.
        a: compactTouch(context.firstTouch, context),
        z: compactTouch(context.lastTouch, context),
    };
}

export function expandWhatsappTrackingContext(raw: unknown): unknown {
    if (!raw || typeof raw !== "object") return raw;
    const context = raw as Partial<CompactTrackingContextV1>;
    if (context.v !== 1 || !Array.isArray(context.o)) return raw;

    const pageUrl = context.u ?? null;
    const pagePath = context.p === 0 ? pathFromUrl(pageUrl) : context.p ?? null;
    const expandValue = (
        value: CompactValueReference,
        primary: string | null,
        secondary: string | null = null,
    ): string | null => {
        if (value === 0) return primary;
        if (value === 1) return secondary;
        return value;
    };
    const landingUrl = expandValue(context.l ?? null, pageUrl);
    const landingPath = expandValue(context.h ?? null, pagePath);
    const fbclid = context.i === 0 ? context.q?.fbclid ?? null : context.i ?? null;
    const expandTouch = (
        touch: CompactAttributionTouchV1 | null | undefined,
    ) => {
        if (!touch) return null;
        return {
            capturedAtMs: touch[0] === 0 ? context.c : touch[0],
            landingUrl: expandValue(touch[1], landingUrl, pageUrl),
            landingPath: expandValue(touch[2], landingPath, pagePath),
            referrer: touch[3] === 0 ? context.r ?? null : touch[3],
            params: touch[4] === 0 ? context.q ?? {} : touch[4],
            fbclid: touch[5] === 0 ? fbclid : touch[5],
            fbp: expandValue(touch[6], context.b ?? null),
            fbc: expandValue(touch[7], context.f ?? null),
        };
    };

    return {
        capturedAtMs: context.c,
        pageUrl,
        pagePath,
        referrer: context.r ?? null,
        consent: {
            analytics: context.o[0] === true,
            marketing: context.o[1] === true,
        },
        params: context.q ?? {},
        fbclid,
        fbp: context.b ?? null,
        fbc: context.f ?? null,
        landingUrl,
        landingPath,
        firstTouch: expandTouch(context.a),
        lastTouch: expandTouch(context.z),
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

    const redirectHref = `${url.pathname}${url.search}`;
    if (redirectHref.length <= MAX_WHATSAPP_REDIRECT_HREF_LENGTH) {
        return redirectHref;
    }

    // A direct WhatsApp destination keeps contact functional and avoids a
    // request whose tracking context would be truncated before reaching the
    // Worker. In that rare fallback, server-side CAPI remains fail-closed.
    return destinationUrl.length <= MAX_WHATSAPP_REDIRECT_HREF_LENGTH
        ? destinationUrl
        : null;
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
