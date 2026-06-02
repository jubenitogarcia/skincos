import { NextResponse } from "next/server";
import { getBookingDb, clampText } from "@/lib/bookingDb";
import { SITE_BEHAVIOR_EVENT_NAMES } from "@/lib/siteBehavior";

export const dynamic = "force-dynamic";

const ALLOWED_EVENT_NAMES = new Set<string>(SITE_BEHAVIOR_EVENT_NAMES);
type CampaignKey = "utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term";

function json(data: unknown, init?: ResponseInit) {
    return NextResponse.json(data, {
        headers: { "cache-control": "no-store" },
        ...init,
    });
}

function stringOrNull(value: unknown, max = 500): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (!trimmed) return null;
    return clampText(trimmed, max);
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readParam(params: Record<string, unknown> | null, key: CampaignKey): string | null {
    return stringOrNull(params?.[key], 160);
}

function safeJson(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    try {
        return clampText(JSON.stringify(value), 2000);
    } catch {
        return null;
    }
}

export async function POST(request: Request) {
    const body = objectOrNull(await request.json().catch(() => null));
    if (!body) return json({ ok: false, error: "invalid_payload" }, { status: 400 });

    const eventName = stringOrNull(body.eventName, 80);
    if (!eventName || !ALLOWED_EVENT_NAMES.has(eventName)) {
        return json({ ok: false, error: "invalid_event_name" }, { status: 400 });
    }

    const consent = objectOrNull(body.consent);
    const analyticsConsent = consent?.analytics === true;
    const marketingConsent = consent?.marketing === true;
    if (!analyticsConsent) {
        return json({ ok: true, skipped: true, reason: "analytics_consent_denied" });
    }

    const params = objectOrNull(body.params);
    const pageUrl = stringOrNull(body.pageUrl, 1000);
    let pageHost: string | null = null;
    try {
        pageHost = pageUrl ? new URL(pageUrl).hostname : null;
    } catch {
        pageHost = null;
    }

    const linkUrl = stringOrNull(body.linkUrl, 1000);
    let linkHost = stringOrNull(body.linkHost, 180);
    let linkPath = stringOrNull(body.linkPath, 1000);
    try {
        if (linkUrl) {
            const parsed = new URL(linkUrl);
            linkHost = parsed.hostname;
            linkPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
    } catch {
        // keep provided sanitized values
    }

    const id = crypto.randomUUID();
    const db = await getBookingDb();
    await db
        .prepare(
            `INSERT INTO site_behavior_events (
                id, event_name, session_id, created_at_ms, page_url, page_path, page_host, referrer, landing_page,
                utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, fbp, fbc,
                link_url, link_host, link_path, link_type, placement, source, unit_slug, service_id, booking_id,
                consent_analytics, consent_marketing, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            id,
            eventName,
            stringOrNull(body.sessionId, 100) ?? id,
            Date.now(),
            pageUrl,
            stringOrNull(body.pagePath, 1000),
            pageHost,
            stringOrNull(body.referrer, 1000),
            stringOrNull(body.landingPage, 1000),
            readParam(params, "utm_source"),
            readParam(params, "utm_medium"),
            readParam(params, "utm_campaign"),
            readParam(params, "utm_content"),
            readParam(params, "utm_term"),
            marketingConsent ? stringOrNull(body.fbclid, 500) : null,
            marketingConsent ? stringOrNull(body.fbp, 500) : null,
            marketingConsent ? stringOrNull(body.fbc, 500) : null,
            linkUrl,
            linkHost,
            linkPath,
            stringOrNull(body.linkType, 120),
            stringOrNull(body.placement, 120),
            stringOrNull(body.source, 160),
            stringOrNull(body.unitSlug, 120),
            stringOrNull(body.serviceId, 120),
            stringOrNull(body.bookingId, 160),
            analyticsConsent ? 1 : 0,
            marketingConsent ? 1 : 0,
            safeJson(body.metadata),
        )
        .run();

    return json({ ok: true, id });
}
