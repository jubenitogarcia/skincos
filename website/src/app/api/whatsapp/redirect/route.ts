import { NextResponse } from "next/server";
import { getBookingDb, coerceTrackingContext, insertMetaCapiDeliveryLog, insertWhatsappClickEvent, nowMs, parseCookieHeader, sanitizeOneLine } from "@/lib/bookingDb";
import { sendMetaServerEvent } from "@/lib/metaConversionsApi";
import { buildWhatsappClickToken, injectWhatsappToken, parseWhatsappDestination } from "@/lib/whatsappTracking";

export const dynamic = "force-dynamic";

function uuid(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `wa_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function clientIp(request: Request): string | null {
    const fromCf = (request.headers.get("cf-connecting-ip") ?? "").trim();
    if (fromCf) return fromCf;
    const xff = (request.headers.get("x-forwarded-for") ?? "").trim();
    if (!xff) return null;
    return xff.split(",")[0]?.trim() || null;
}

export async function GET(request: Request) {
    const url = new URL(request.url);
    const rawDestination = (url.searchParams.get("dest") ?? "").trim();
    const parsedDestination = parseWhatsappDestination(rawDestination);
    if (!parsedDestination) {
        return NextResponse.json({ ok: false, error: "invalid_destination" }, { status: 400 });
    }

    const rawContext = url.searchParams.get("ctx");
    let trackingContext = null;
    if (rawContext) {
        try {
            trackingContext = coerceTrackingContext(JSON.parse(rawContext));
        } catch {
            trackingContext = null;
        }
    }
    const requestCookies = parseCookieHeader(request.headers.get("cookie"));
    const trackingContextResolved = trackingContext
        ? {
            ...trackingContext,
            fbp: trackingContext.fbp ?? requestCookies._fbp ?? null,
            fbc: trackingContext.fbc ?? requestCookies._fbc ?? null,
            fbclid: trackingContext.fbclid ?? trackingContext.params.fbclid ?? null,
        }
        : null;

    const eventId = sanitizeOneLine(url.searchParams.get("event_id") ?? "") || `contact_${uuid()}`;
    const waClickId = uuid().replace(/-/g, "");
    const token = buildWhatsappClickToken(waClickId);
    const placement = sanitizeOneLine(url.searchParams.get("placement") ?? "") || null;
    const source = sanitizeOneLine(url.searchParams.get("source") ?? "") || "site";
    const unitSlug = sanitizeOneLine(url.searchParams.get("unit_slug") ?? "") || null;
    const doctorName = sanitizeOneLine(url.searchParams.get("doctor_name") ?? "") || null;
    const bookingId = sanitizeOneLine(url.searchParams.get("booking_id") ?? "") || null;
    const pageUrl = sanitizeOneLine(url.searchParams.get("page_url") ?? "") || trackingContextResolved?.pageUrl || null;
    const pagePath = sanitizeOneLine(url.searchParams.get("page_path") ?? "") || trackingContextResolved?.pagePath || null;
    const clientUserAgent = sanitizeOneLine(request.headers.get("user-agent") ?? "") || null;

    const destinationUrl = new URL(parsedDestination.destinationUrl);
    const nextText = injectWhatsappToken(parsedDestination.text, token);
    if (destinationUrl.hostname === "wa.me") {
        destinationUrl.searchParams.set("text", nextText);
    } else if (destinationUrl.searchParams.has("text") || destinationUrl.hostname === "api.whatsapp.com") {
        destinationUrl.searchParams.set("text", nextText);
    }

    const redirectUrl = destinationUrl.toString();
    const createdAtMs = nowMs();
    const db = await getBookingDb();

    await insertWhatsappClickEvent(db, {
        id: uuid(),
        eventId,
        waClickId,
        placement,
        source,
        unitSlug,
        doctorName,
        bookingId,
        destinationUrl: parsedDestination.destinationUrl,
        redirectUrl,
        pageUrl,
        pagePath,
        trackingContext: trackingContextResolved,
        clientIp: clientIp(request),
        clientUserAgent,
        createdAtMs,
    });

    await sendMetaServerEvent(
        {
            eventName: "Contact",
            eventId,
            eventSourceUrl: pageUrl,
            userData: {
                clientIpAddress: clientIp(request),
                clientUserAgent,
                fbp: trackingContextResolved?.fbp ?? null,
                fbc: trackingContextResolved?.fbc ?? null,
            },
            customData: {
                placement,
                source,
                unit_slug: unitSlug,
                doctor_name: doctorName,
                booking_id: bookingId,
                wa_click_id: waClickId,
                whatsapp_token: token,
            },
            trackingContext: trackingContextResolved,
            waClickId,
            bookingId,
        },
        {
            logDelivery: async (entry) => {
                await insertMetaCapiDeliveryLog(db, {
                    id: uuid(),
                    ...entry,
                    createdAtMs: nowMs(),
                });
            },
        },
    );

    return NextResponse.redirect(redirectUrl, { status: 302 });
}
