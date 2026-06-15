import { NextResponse } from "next/server";
import { getBookingDb, type BookingRequestRow } from "@/lib/bookingDb";
import { listEsfaRedirects } from "@/lib/esfaRedirects";
import { getRuntimeSecret } from "@/lib/runtimeSecrets";
import { serializeSiteCustomUrl, type SiteCustomUrlRow } from "@/lib/siteCustomUrls";
import {
    DEFAULT_SITE_HOST,
    defaultSiteConnection,
    normalizeOptionalSiteHost,
    serializeSiteConnection,
    type SiteConnectionRow,
} from "@/lib/siteConnections";

export const dynamic = "force-dynamic";

type WhatsappClickRow = {
    id: string;
    event_id: string;
    wa_click_id: string;
    placement: string | null;
    source: string | null;
    unit_slug: string | null;
    doctor_name: string | null;
    booking_id: string | null;
    destination_url: string;
    redirect_url: string;
    page_url: string | null;
    page_path: string | null;
    tracking_context_json: string | null;
    created_at_ms: number;
};

type MetaDeliveryRow = {
    id: string;
    channel: string;
    event_name: string;
    event_id: string;
    endpoint: string;
    ok: number;
    http_status: number | null;
    response_body: string | null;
    error_message: string | null;
    booking_id: string | null;
    wa_click_id: string | null;
    created_at_ms: number;
};

type SiteBehaviorRow = {
    id: string;
    event_name: string;
    session_id: string;
    created_at_ms: number;
    page_url: string | null;
    page_path: string | null;
    page_host: string | null;
    referrer: string | null;
    landing_page: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    fbclid: string | null;
    fbp: string | null;
    fbc: string | null;
    link_url: string | null;
    link_host: string | null;
    link_path: string | null;
    link_type: string | null;
    placement: string | null;
    source: string | null;
    unit_slug: string | null;
    service_id: string | null;
    booking_id: string | null;
    consent_analytics: number;
    consent_marketing: number;
    metadata_json: string | null;
};

function json(data: unknown, init?: ResponseInit) {
    return NextResponse.json(data, {
        headers: { "cache-control": "no-store" },
        ...init,
    });
}

function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function readToken(request: Request): string {
    const auth = (request.headers.get("authorization") ?? "").trim();
    if (auth.toLowerCase().startsWith("bearer ")) {
        return auth.slice(7).trim();
    }
    return (request.headers.get("x-tracking-dashboard-token") ?? "").trim();
}

async function isAuthorized(request: Request): Promise<boolean> {
    const expected = await getRuntimeSecret("TRACKING_DASHBOARD_TOKEN");
    if (process.env.NODE_ENV === "production" && !expected) {
        return false;
    }
    if (!expected) return true;
    return constantTimeEqual(readToken(request), expected);
}

function parsePositiveInt(value: string | null, fallback: number): number {
    const raw = Number(value ?? "");
    if (!Number.isFinite(raw)) return fallback;
    const parsed = Math.floor(raw);
    if (parsed <= 0) return fallback;
    return parsed;
}

function safeJsonParse(value: string | null | undefined): Record<string, unknown> | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
        return null;
    } catch {
        return null;
    }
}

function readNestedString(input: unknown, path: string[]): string | null {
    let current: unknown = input;
    for (const segment of path) {
        if (!current || typeof current !== "object") return null;
        current = (current as Record<string, unknown>)[segment];
    }
    return typeof current === "string" && current.trim() ? current.trim() : null;
}

function maskPersonName(value: string | null | undefined): string | null {
    const parts = String(value ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (!parts.length) return null;
    if (parts.length === 1) return parts[0];
    const last = parts[parts.length - 1];
    return `${parts[0]} ${last.charAt(0)}.`;
}

function maskPhone(value: string | null | undefined): string | null {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (!digits) return null;
    if (digits.length <= 4) return digits;
    return `${digits.slice(0, Math.min(4, digits.length - 4))}...${digits.slice(-4)}`;
}

function normalizeAttribution(input: Record<string, unknown> | null) {
    if (!input) {
        return {
            utmSource: null,
            utmCampaign: null,
            utmMedium: null,
            fbclid: null,
            fbp: null,
            fbc: null,
            landingPage: null,
            pagePath: null,
        };
    }

    return {
        utmSource:
            readNestedString(input, ["params", "utm_source"]) ??
            readNestedString(input, ["lastTouch", "params", "utm_source"]) ??
            readNestedString(input, ["firstTouch", "params", "utm_source"]),
        utmCampaign:
            readNestedString(input, ["params", "utm_campaign"]) ??
            readNestedString(input, ["lastTouch", "params", "utm_campaign"]) ??
            readNestedString(input, ["firstTouch", "params", "utm_campaign"]),
        utmMedium:
            readNestedString(input, ["params", "utm_medium"]) ??
            readNestedString(input, ["lastTouch", "params", "utm_medium"]) ??
            readNestedString(input, ["firstTouch", "params", "utm_medium"]),
        fbclid: readNestedString(input, ["fbclid"]) ?? readNestedString(input, ["params", "fbclid"]),
        fbp: readNestedString(input, ["fbp"]),
        fbc: readNestedString(input, ["fbc"]),
        landingPage: readNestedString(input, ["landingPath"]) ?? readNestedString(input, ["lastTouch", "landingPath"]),
        pagePath: readNestedString(input, ["pagePath"]),
    };
}

function incrementMap(map: Map<string, number>, key: string | null) {
    const normalized = (key ?? "").trim() || "direto";
    map.set(normalized, (map.get(normalized) ?? 0) + 1);
}

function normalizeDashboardLabel(params: {
    value: string | null;
    hasTrackingContext: boolean;
    emptyLabel: string;
}) {
    const normalized = (params.value ?? "").trim();
    if (normalized) return normalized;
    return params.hasTrackingContext ? params.emptyLabel : "sem_tracking_context";
}

function sortMapEntries(map: Map<string, number>, valueKey: string) {
    return Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => ({ [valueKey]: label, count }));
}

function percent(numerator: number, denominator: number): number {
    if (!denominator) return 0;
    return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
    for (const value of values) {
        const normalized = (value ?? "").trim();
        if (normalized) return normalized;
    }
    return null;
}

function linkLabel(row: SiteBehaviorRow): string | null {
    if (row.link_url) return row.link_url;
    if (row.link_host || row.link_path) return `${row.link_host ?? ""}${row.link_path ?? ""}`;
    return null;
}

function hostMatches(urlValue: string | null | undefined, siteHost: string | null): boolean {
    if (!siteHost) return true;
    const expected = siteHost.toLowerCase();
    const expectedWww = `www.${expected}`;
    try {
        const parsed = new URL(urlValue ?? "");
        const host = parsed.hostname.toLowerCase();
        return host === expected || host === expectedWww;
    } catch {
        return expected === DEFAULT_SITE_HOST && !urlValue;
    }
}

function pageHostMatches(pageHost: string | null | undefined, siteHost: string): boolean {
    const normalized = (pageHost ?? "").toLowerCase();
    return normalized === siteHost || normalized === `www.${siteHost}` || (siteHost === DEFAULT_SITE_HOST && !normalized);
}

function classifyCoverageBucket(params: {
    hasTrackingContext: boolean;
    hasMetaEventId: boolean;
    hasFacebookIds: boolean;
    marketingConsent: boolean;
    hasAnyAttribution: boolean;
}) {
    if (params.hasTrackingContext && params.hasMetaEventId && params.hasFacebookIds && params.marketingConsent) {
        return "origem_meta_completa";
    }
    if (params.hasAnyAttribution || params.hasTrackingContext || params.hasMetaEventId || params.hasFacebookIds) {
        return "origem_first_party";
    }
    return "sem_origem";
}

function buildIncompleteTrackingCauses(params: {
    hasTrackingContext: boolean;
    hasMetaEventId: boolean;
    hasFacebookIds: boolean;
    marketingConsent: boolean;
    analyticsConsent: boolean;
    scheduleStatus: string | null;
}) {
    const causes: string[] = [];
    if (!params.hasTrackingContext) causes.push("sem_tracking_context");
    if (!params.hasMetaEventId) causes.push("sem_meta_event_id");
    if (!params.hasFacebookIds) causes.push("sem_fb_ids");
    if (!params.marketingConsent) causes.push("marketing_sem_consentimento");
    if (!params.analyticsConsent) causes.push("analytics_sem_consentimento");
    if (params.scheduleStatus === "failed") causes.push("schedule_capi_falhou");
    if (params.scheduleStatus === "skipped_no_config") causes.push("schedule_capi_sem_config");
    return causes;
}

function normalizeMetaFailureReason(message: string | null | undefined, httpStatus: number | null | undefined) {
    const normalized = (message ?? "").trim().toLowerCase();
    if (normalized === "missing_meta_capi_config") return "missing_meta_capi_config";
    if (normalized === "marketing_consent_denied") return "marketing_consent_denied";
    if (normalized.includes("invalid oauth") || normalized.includes("cannot parse access token")) return "invalid_oauth_token";
    if (normalized.includes("permission") || normalized.includes("not authorized")) return "meta_permission_denied";
    if (normalized.includes("timeout") || normalized.includes("timed out")) return "meta_timeout";
    if (normalized.includes("network") || normalized.includes("fetch failed") || normalized.includes("connection")) return "meta_network_error";
    if (httpStatus === 429) return "meta_rate_limited";
    if (httpStatus === 408 || httpStatus === 500 || httpStatus === 502 || httpStatus === 503 || httpStatus === 504) {
        return "meta_transient_http_error";
    }
    if (httpStatus === 400) return "meta_bad_request";
    if (httpStatus === 401 || httpStatus === 403) return "meta_auth_error";
    return normalized || "delivery_failed";
}

function isRetryableMetaFailure(message: string | null | undefined, httpStatus: number | null | undefined) {
    const reason = normalizeMetaFailureReason(message, httpStatus);
    return new Set([
        "meta_timeout",
        "meta_network_error",
        "meta_rate_limited",
        "meta_transient_http_error",
    ]).has(reason);
}

async function readMetaConfigStatus() {
    const pixelId =
        ((await getRuntimeSecret("META_PIXEL_ID")) ?? "").trim() ||
        ((process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "").trim());
    const accessToken = ((await getRuntimeSecret("META_ACCESS_TOKEN")) ?? "").trim();
    const dashboardToken = ((await getRuntimeSecret("TRACKING_DASHBOARD_TOKEN")) ?? "").trim();

    return {
        metaPixelConfigured: Boolean(pixelId),
        metaCapiConfigured: Boolean(pixelId && accessToken),
        dashboardTokenConfigured: Boolean(dashboardToken),
    };
}

export async function GET(request: Request) {
    if (!(await isAuthorized(request))) {
        return json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const days = Math.min(parsePositiveInt(url.searchParams.get("days"), 30), 90);
    const offsetDays = Math.min(parsePositiveInt(url.searchParams.get("offsetDays"), 0), 365);
    const limit = Math.min(parsePositiveInt(url.searchParams.get("limit"), 12), 50);
    const selectedSiteHost = normalizeOptionalSiteHost(url.searchParams.get("siteHost"));
    const selectedSiteHostWww = selectedSiteHost ? `www.${selectedSiteHost}` : null;
    const untilMs = Date.now() - offsetDays * 24 * 60 * 60 * 1000;
    const sinceMs = untilMs - days * 24 * 60 * 60 * 1000;

    const db = await getBookingDb();
    const config = await readMetaConfigStatus();

    const bookingRows = (
        await db
            .prepare(
                `SELECT id, unit_slug, doctor_slug, service_id, status, patient_name, whatsapp, created_at_ms,
                        tracking_context_json, meta_event_id, marketing_consent, analytics_consent, fbp, fbc, fbclid,
                        landing_page, referrer
                 FROM booking_requests
                 WHERE created_at_ms >= ? AND created_at_ms < ? AND status = 'confirmed'
                 ORDER BY created_at_ms DESC`,
            )
            .bind(sinceMs, untilMs)
            .all<BookingRequestRow>()
    ).results ?? [];

    const whatsappRows = (
        await db
            .prepare(
                `SELECT id, event_id, wa_click_id, placement, source, unit_slug, doctor_name, booking_id,
                        destination_url, redirect_url, page_url, page_path, tracking_context_json, created_at_ms
                 FROM whatsapp_click_events
                 WHERE created_at_ms >= ? AND created_at_ms < ?
                 ORDER BY created_at_ms DESC`,
            )
            .bind(sinceMs, untilMs)
            .all<WhatsappClickRow>()
    ).results ?? [];

    const capiRows = (
        await db
            .prepare(
                `SELECT id, channel, event_name, event_id, endpoint, ok, http_status, response_body, error_message,
                        booking_id, wa_click_id, created_at_ms
                 FROM meta_capi_delivery_logs
                 WHERE created_at_ms >= ? AND created_at_ms < ?
                 ORDER BY created_at_ms DESC`,
            )
            .bind(sinceMs, untilMs)
            .all<MetaDeliveryRow>()
    ).results ?? [];

    const siteBehaviorQuery = selectedSiteHost
        ? `SELECT id, event_name, session_id, created_at_ms, page_url, page_path, page_host, referrer, landing_page,
                        utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, fbp, fbc,
                        link_url, link_host, link_path, link_type, placement, source, unit_slug, service_id,
                        booking_id, consent_analytics, consent_marketing, metadata_json
                 FROM site_behavior_events
                 WHERE created_at_ms >= ? AND created_at_ms < ?
                   AND (
                    lower(page_host) = ?
                    OR lower(page_host) = ?
                    OR (? = ? AND page_host IS NULL)
                   )
                 ORDER BY created_at_ms DESC
                 LIMIT 5000`
        : `SELECT id, event_name, session_id, created_at_ms, page_url, page_path, page_host, referrer, landing_page,
                        utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, fbp, fbc,
                        link_url, link_host, link_path, link_type, placement, source, unit_slug, service_id,
                        booking_id, consent_analytics, consent_marketing, metadata_json
                 FROM site_behavior_events
                 WHERE created_at_ms >= ? AND created_at_ms < ?
                 ORDER BY created_at_ms DESC
                 LIMIT 5000`;
    const siteBehaviorStatement = db.prepare(siteBehaviorQuery);
    const siteBehaviorRows = (
        await (selectedSiteHost
            ? siteBehaviorStatement.bind(sinceMs, untilMs, selectedSiteHost, selectedSiteHostWww, selectedSiteHost, DEFAULT_SITE_HOST)
            : siteBehaviorStatement.bind(sinceMs, untilMs)
        ).all<SiteBehaviorRow>()
    ).results ?? [];

    const customUrlQuery = selectedSiteHost
        ? `SELECT
                    u.id, u.site_host, u.name, u.slug_path, u.destination_url, u.destination_host, u.destination_path,
                    u.description, u.source, u.placement, u.unit_slug, u.service_id,
                    u.utm_source, u.utm_medium, u.utm_campaign, u.utm_content, u.utm_term,
                    u.active, u.created_at_ms, u.updated_at_ms,
                    COUNT(e.id) AS click_count,
                    MAX(e.created_at_ms) AS last_click_at_ms
                 FROM site_custom_urls u
                 LEFT JOIN site_behavior_events e
                    ON e.created_at_ms >= ? AND e.created_at_ms < ?
                    AND (lower(e.page_host) = ? OR lower(e.page_host) = ?)
                    AND (
                        e.link_url = u.destination_url
                        OR e.link_path = u.destination_path
                        OR (u.utm_campaign IS NOT NULL AND e.utm_campaign = u.utm_campaign)
                    )
                 WHERE u.site_host = ?
                 GROUP BY u.id
                 ORDER BY u.updated_at_ms DESC
                 LIMIT ?`
        : `SELECT
                    u.id, u.site_host, u.name, u.slug_path, u.destination_url, u.destination_host, u.destination_path,
                    u.description, u.source, u.placement, u.unit_slug, u.service_id,
                    u.utm_source, u.utm_medium, u.utm_campaign, u.utm_content, u.utm_term,
                    u.active, u.created_at_ms, u.updated_at_ms,
                    COUNT(e.id) AS click_count,
                    MAX(e.created_at_ms) AS last_click_at_ms
                 FROM site_custom_urls u
                 LEFT JOIN site_behavior_events e
                    ON e.created_at_ms >= ? AND e.created_at_ms < ?
                    AND (
                        e.link_url = u.destination_url
                        OR e.link_path = u.destination_path
                        OR (u.utm_campaign IS NOT NULL AND e.utm_campaign = u.utm_campaign)
                    )
                 GROUP BY u.id
                 ORDER BY u.updated_at_ms DESC
                 LIMIT ?`;
    const customUrlStatement = db.prepare(customUrlQuery);
    const customUrlRows = (
        await (selectedSiteHost
            ? customUrlStatement.bind(sinceMs, untilMs, selectedSiteHost, selectedSiteHostWww, selectedSiteHost, limit)
            : customUrlStatement.bind(sinceMs, untilMs, limit)
        ).all<SiteCustomUrlRow>()
    ).results ?? [];

    const siteConnectionRows = (
        await db
            .prepare(
                `SELECT
                    c.id, c.site_host, c.name, c.status_label, c.status_tone, c.source,
                    c.active, c.created_at_ms, c.updated_at_ms,
                    COUNT(e.id) AS event_count,
                    MAX(e.created_at_ms) AS last_event_at_ms
                 FROM site_connections c
                 LEFT JOIN site_behavior_events e
                    ON lower(e.page_host) = c.site_host
                    OR lower(e.page_host) = ('www.' || c.site_host)
                 GROUP BY c.id
                 ORDER BY c.updated_at_ms DESC
                 LIMIT 100`,
            )
            .all<SiteConnectionRow>()
    ).results ?? [];

    const sourceCounts = new Map<string, number>();
    const campaignCounts = new Map<string, number>();
    const unitCounts = new Map<string, number>();

    let bookingsWithTrackingContext = 0;
    let bookingsWithMetaEventId = 0;
    let bookingsWithMarketingConsent = 0;
    let bookingsWithAnalyticsConsent = 0;
    let bookingsWithFbIdentifiers = 0;
    const coverageBucketCounts = new Map<string, number>([
        ["sem_origem", 0],
        ["origem_first_party", 0],
        ["origem_meta_completa", 0],
    ]);
    const scheduleStatusByBookingId = new Map<string, string>();

    const scopedWhatsappRows = selectedSiteHost
        ? whatsappRows.filter((row) => hostMatches(row.page_url, selectedSiteHost))
        : whatsappRows;
    let whatsappClicksWithTracking = 0;
    const recentWhatsappClicks = scopedWhatsappRows.slice(0, limit).map((row) => {
        const tracking = normalizeAttribution(safeJsonParse(row.tracking_context_json));
        if (row.tracking_context_json) whatsappClicksWithTracking += 1;
        return {
            id: row.id,
            createdAtMs: row.created_at_ms,
            eventId: row.event_id,
            waClickId: row.wa_click_id,
            placement: row.placement,
            source: row.source,
            unitSlug: row.unit_slug,
            doctorName: row.doctor_name,
            bookingId: row.booking_id,
            pagePath: row.page_path ?? tracking.pagePath,
            utmSource: tracking.utmSource,
            utmCampaign: tracking.utmCampaign,
        };
    });
    whatsappClicksWithTracking += scopedWhatsappRows.slice(limit).filter((row) => row.tracking_context_json).length;

    let capiScheduleOk = 0;
    let capiScheduleFailed = 0;
    let capiScheduleSkippedNoConfig = 0;
    let capiScheduleSkippedConsent = 0;
    let capiContactOk = 0;
    let capiContactFailed = 0;
    let capiContactSkippedNoConfig = 0;
    let capiContactSkippedConsent = 0;
    const capiIssueReasonCounts = new Map<string, number>();
    const recentCapiIssues = [];
    const recentRetryCandidates = [];

    for (const row of capiRows) {
        const ok = row.ok === 1;
        const errorReason = (row.error_message ?? "").trim() || "delivery_failed";
        const skippedNoConfig = errorReason === "missing_meta_capi_config";
        const skippedConsent = errorReason === "marketing_consent_denied";
        if (row.event_name === "Schedule") {
            if (ok) capiScheduleOk += 1;
            else if (skippedNoConfig) capiScheduleSkippedNoConfig += 1;
            else if (skippedConsent) capiScheduleSkippedConsent += 1;
            else capiScheduleFailed += 1;
            if (row.booking_id && !scheduleStatusByBookingId.has(row.booking_id)) {
                scheduleStatusByBookingId.set(
                    row.booking_id,
                    ok ? "ok" : skippedNoConfig ? "skipped_no_config" : skippedConsent ? "skipped_consent" : "failed",
                );
            }
        }
        if (row.event_name === "Contact") {
            if (ok) capiContactOk += 1;
            else if (skippedNoConfig) capiContactSkippedNoConfig += 1;
            else if (skippedConsent) capiContactSkippedConsent += 1;
            else capiContactFailed += 1;
        }
        if (!ok) {
            incrementMap(capiIssueReasonCounts, normalizeMetaFailureReason(row.error_message, row.http_status));
        }
        if (!ok && recentCapiIssues.length < limit) {
            recentCapiIssues.push({
                id: row.id,
                createdAtMs: row.created_at_ms,
                eventName: row.event_name,
                eventId: row.event_id,
                bookingId: row.booking_id,
                waClickId: row.wa_click_id,
                httpStatus: row.http_status,
                errorMessage: row.error_message,
                normalizedReason: normalizeMetaFailureReason(row.error_message, row.http_status),
                retryable: isRetryableMetaFailure(row.error_message, row.http_status),
            });
        }
        if (!ok && isRetryableMetaFailure(row.error_message, row.http_status) && recentRetryCandidates.length < limit) {
            recentRetryCandidates.push({
                id: row.id,
                createdAtMs: row.created_at_ms,
                eventName: row.event_name,
                eventId: row.event_id,
                bookingId: row.booking_id,
                waClickId: row.wa_click_id,
                httpStatus: row.http_status,
                errorMessage: row.error_message,
                normalizedReason: normalizeMetaFailureReason(row.error_message, row.http_status),
            });
        }
    }

    const normalizedBookings = bookingRows.map((row) => {
        const tracking = normalizeAttribution(safeJsonParse(row.tracking_context_json));
        const hasTrackingContext = Boolean(row.tracking_context_json);
        const marketingConsent = (row.marketing_consent ?? 0) === 1;
        const analyticsConsent = (row.analytics_consent ?? 0) === 1;
        const hasMetaEventId = Boolean(row.meta_event_id);
        const hasFacebookIds = Boolean(row.fbp || row.fbc || row.fbclid || tracking.fbclid || tracking.fbp || tracking.fbc);
        const utmSource = normalizeDashboardLabel({ value: tracking.utmSource, hasTrackingContext, emptyLabel: "direto" });
        const utmCampaign = normalizeDashboardLabel({ value: tracking.utmCampaign, hasTrackingContext, emptyLabel: "sem_campanha" });
        const utmMedium = tracking.utmMedium;
        const landingPage = row.landing_page ?? tracking.landingPage;
        const referrer = row.referrer ?? null;
        const hasAnyAttribution =
            hasTrackingContext ||
            hasMetaEventId ||
            hasFacebookIds ||
            Boolean((landingPage ?? "").trim()) ||
            Boolean((referrer ?? "").trim()) ||
            (utmSource !== "sem_tracking_context" && utmSource !== "direto") ||
            (utmCampaign !== "sem_tracking_context" && utmCampaign !== "sem_campanha");
        const coverageBucket = classifyCoverageBucket({
            hasTrackingContext,
            hasMetaEventId,
            hasFacebookIds,
            marketingConsent,
            hasAnyAttribution,
        });
        const scheduleStatus = scheduleStatusByBookingId.get(row.id) ?? null;
        const incompleteCauses = buildIncompleteTrackingCauses({
            hasTrackingContext,
            hasMetaEventId,
            hasFacebookIds,
            marketingConsent,
            analyticsConsent,
            scheduleStatus,
        });

        incrementMap(sourceCounts, utmSource);
        incrementMap(campaignCounts, utmCampaign);
        incrementMap(unitCounts, row.unit_slug);

        if (hasTrackingContext) bookingsWithTrackingContext += 1;
        if (hasMetaEventId) bookingsWithMetaEventId += 1;
        if (marketingConsent) bookingsWithMarketingConsent += 1;
        if (analyticsConsent) bookingsWithAnalyticsConsent += 1;
        if (hasFacebookIds) bookingsWithFbIdentifiers += 1;
        coverageBucketCounts.set(coverageBucket, (coverageBucketCounts.get(coverageBucket) ?? 0) + 1);

        return {
            id: row.id,
            createdAtMs: row.created_at_ms,
            unitSlug: row.unit_slug,
            doctorSlug: row.doctor_slug,
            serviceId: row.service_id,
            patient: maskPersonName(row.patient_name),
            whatsapp: maskPhone(row.whatsapp),
            metaEventId: row.meta_event_id ?? null,
            marketingConsent,
            analyticsConsent,
            utmSource,
            utmCampaign,
            utmMedium,
            landingPage,
            referrer,
            hasFacebookIds,
            coverageBucket,
            incompleteCauses,
            scheduleStatus,
        };
    });

    const recentBookings = normalizedBookings.slice(0, limit);
    const recentIncompleteBookings = normalizedBookings
        .filter((row) => row.coverageBucket !== "origem_meta_completa" || row.incompleteCauses.length > 0)
        .slice(0, limit)
        .map((row) => ({
            ...row,
            primaryCause: row.incompleteCauses[0] ?? "sem_causa_normalizada",
        }));

    const coverageBuckets = [
        { bucket: "sem_origem", label: "Sem origem", count: coverageBucketCounts.get("sem_origem") ?? 0 },
        { bucket: "origem_first_party", label: "Origem first-party", count: coverageBucketCounts.get("origem_first_party") ?? 0 },
        { bucket: "origem_meta_completa", label: "Origem Meta completa", count: coverageBucketCounts.get("origem_meta_completa") ?? 0 },
    ];

    const behaviorSessions = new Set<string>();
    const behaviorEventCounts = new Map<string, number>();
    const behaviorPageCounts = new Map<string, number>();
    const behaviorEntryBySession = new Map<string, SiteBehaviorRow>();
    const behaviorLandingToBookingCounts = new Map<string, number>();
    const behaviorUtmContentCounts = new Map<string, number>();
    const behaviorLinkCounts = new Map<string, number>();
    const behaviorMissingUtmLinkCounts = new Map<string, number>();
    const behaviorPlacementCounts = new Map<string, number>();
    const behaviorWhatsappUnitCounts = new Map<string, number>();
    const behaviorServiceCounts = new Map<string, number>();
    const behaviorUnitCounts = new Map<string, number>();
    let behaviorEventsWithCampaign = 0;
    let behaviorEventsWithFbIds = 0;
    let behaviorAnalyticsConsentEvents = 0;
    let behaviorMarketingConsentEvents = 0;

    for (const row of siteBehaviorRows) {
        if (row.session_id) behaviorSessions.add(row.session_id);
        incrementMap(behaviorEventCounts, row.event_name);
        if (row.consent_analytics === 1) behaviorAnalyticsConsentEvents += 1;
        if (row.consent_marketing === 1) behaviorMarketingConsentEvents += 1;
        if ((row.utm_campaign ?? "").trim()) behaviorEventsWithCampaign += 1;
        if ((row.fbclid ?? row.fbp ?? row.fbc ?? "").trim()) behaviorEventsWithFbIds += 1;
        if (row.utm_content) incrementMap(behaviorUtmContentCounts, row.utm_content);
        if (row.unit_slug) incrementMap(behaviorUnitCounts, row.unit_slug);
        if (row.service_id) incrementMap(behaviorServiceCounts, row.service_id);

        if (row.event_name === "page_view" && row.page_path) {
            incrementMap(behaviorPageCounts, row.page_path);
            const existing = behaviorEntryBySession.get(row.session_id);
            if (!existing || row.created_at_ms < existing.created_at_ms) {
                behaviorEntryBySession.set(row.session_id, row);
            }
        }

        if (row.event_name === "booking_confirmed") {
            incrementMap(behaviorLandingToBookingCounts, firstNonEmpty(row.landing_page, row.page_path, "sem_landing"));
        }

        if (row.event_name === "custom_link_click" || row.event_name === "external_link_click" || row.event_name === "whatsapp_redirect_click" || row.event_name === "cta_click") {
            const label = linkLabel(row);
            if (label) incrementMap(behaviorLinkCounts, label);
            if (label && !row.utm_campaign) incrementMap(behaviorMissingUtmLinkCounts, label);
            if (row.placement) incrementMap(behaviorPlacementCounts, row.placement);
        }

        if (row.event_name === "whatsapp_redirect_click") {
            incrementMap(behaviorWhatsappUnitCounts, row.unit_slug);
        }
    }

    const entryPageCounts = new Map<string, number>();
    for (const row of behaviorEntryBySession.values()) {
        incrementMap(entryPageCounts, firstNonEmpty(row.page_path, row.landing_page, "sem_pagina"));
    }

    const behaviorSummary = {
        events: siteBehaviorRows.length,
        sessions: behaviorSessions.size,
        pageViews: behaviorEventCounts.get("page_view") ?? 0,
        ctaClicks: behaviorEventCounts.get("cta_click") ?? 0,
        customLinkClicks: behaviorEventCounts.get("custom_link_click") ?? 0,
        externalLinkClicks: behaviorEventCounts.get("external_link_click") ?? 0,
        whatsappRedirectClicks: behaviorEventCounts.get("whatsapp_redirect_click") ?? 0,
        bookingStepViews: behaviorEventCounts.get("booking_step_view") ?? 0,
        bookingStepCompleted: behaviorEventCounts.get("booking_step_completed") ?? 0,
        bookingSubmitAttempts: behaviorEventCounts.get("booking_submit_attempt") ?? 0,
        bookingConfirmed: behaviorEventCounts.get("booking_confirmed") ?? 0,
    };

    const siteFunnel = {
        sessions: behaviorSummary.sessions,
        pageViews: behaviorSummary.pageViews,
        ctaClicks: behaviorSummary.ctaClicks + behaviorSummary.customLinkClicks + behaviorSummary.whatsappRedirectClicks,
        bookingStarted: behaviorEventCounts.get("booking_step_completed") ?? 0,
        finalStepOpened: behaviorSummary.bookingStepViews,
        submitAttempts: behaviorSummary.bookingSubmitAttempts,
        confirmedBookings: bookingRows.length,
        visitToBookingRate: percent(bookingRows.length, behaviorSummary.sessions),
        ctaToBookingRate: percent(bookingRows.length, behaviorSummary.ctaClicks + behaviorSummary.customLinkClicks + behaviorSummary.whatsappRedirectClicks),
    };

    const siteBehavior = {
        summary: behaviorSummary,
        topPages: sortMapEntries(behaviorPageCounts, "pagePath").slice(0, 10),
        topEntryPages: sortMapEntries(entryPageCounts, "pagePath").slice(0, 10),
        topBookingLandingPages: sortMapEntries(behaviorLandingToBookingCounts, "pagePath").slice(0, 10),
        byUnit: sortMapEntries(behaviorUnitCounts, "unitSlug").slice(0, 10),
        byService: sortMapEntries(behaviorServiceCounts, "serviceId").slice(0, 10),
    };

    const customLinks = {
        managedUrls: customUrlRows.map(serializeSiteCustomUrl),
        cloudflareRedirects: listEsfaRedirects(),
        topLinks: sortMapEntries(behaviorLinkCounts, "linkUrl").slice(0, 10),
        topUtmContent: sortMapEntries(behaviorUtmContentCounts, "utmContent").slice(0, 10),
        linksMissingUtm: sortMapEntries(behaviorMissingUtmLinkCounts, "linkUrl").slice(0, 10),
        byPlacement: sortMapEntries(behaviorPlacementCounts, "placement").slice(0, 10),
        whatsappByUnit: sortMapEntries(behaviorWhatsappUnitCounts, "unitSlug").slice(0, 10),
        recentClicks: siteBehaviorRows
            .filter((row) => ["custom_link_click", "external_link_click", "whatsapp_redirect_click", "cta_click"].includes(row.event_name))
            .slice(0, limit)
            .map((row) => ({
                id: row.id,
                createdAtMs: row.created_at_ms,
                eventName: row.event_name,
                linkUrl: row.link_url,
                linkHost: row.link_host,
                linkPath: row.link_path,
                placement: row.placement,
                source: row.source,
                unitSlug: row.unit_slug,
                serviceId: row.service_id,
                pagePath: row.page_path,
                utmSource: row.utm_source,
                utmCampaign: row.utm_campaign,
                utmContent: row.utm_content,
            })),
    };

    const serializedConnections = siteConnectionRows.map(serializeSiteConnection);
    if (!serializedConnections.some((site) => site.siteHost === DEFAULT_SITE_HOST)) {
        const canonicalConnection = defaultSiteConnection();
        const canonicalEvents = siteBehaviorRows.filter((row) => pageHostMatches(row.page_host, DEFAULT_SITE_HOST));
        canonicalConnection.eventCount = canonicalEvents.length;
        canonicalConnection.lastEventAtMs = canonicalEvents[0]?.created_at_ms ?? null;
        serializedConnections.unshift(canonicalConnection);
    }

    const behaviorQuality = {
        eventsWithCampaign: behaviorEventsWithCampaign,
        eventsWithFacebookIds: behaviorEventsWithFbIds,
        analyticsConsentEvents: behaviorAnalyticsConsentEvents,
        marketingConsentEvents: behaviorMarketingConsentEvents,
        campaignCoverage: percent(behaviorEventsWithCampaign, siteBehaviorRows.length),
        facebookIdCoverage: percent(behaviorEventsWithFbIds, siteBehaviorRows.length),
        marketingConsentCoverage: percent(behaviorMarketingConsentEvents, siteBehaviorRows.length),
    };

    return json({
        ok: true,
        source: "website_d1",
        generatedAt: Date.now(),
        window: {
            days,
            sinceMs,
            untilMs,
            offsetDays,
        },
        summary: {
            confirmedBookings: bookingRows.length,
            bookingsWithTrackingContext,
            bookingsWithMetaEventId,
            bookingsWithMarketingConsent,
            bookingsWithAnalyticsConsent,
            bookingsWithFacebookIds: bookingsWithFbIdentifiers,
            whatsappClicks: scopedWhatsappRows.length,
            whatsappClicksWithTrackingContext: whatsappClicksWithTracking,
            capiScheduleOk,
            capiScheduleFailed,
            capiScheduleSkippedNoConfig,
            capiScheduleSkippedConsent,
            capiContactOk,
            capiContactFailed,
            capiContactSkippedNoConfig,
            capiContactSkippedConsent,
        },
        config,
        topSources: sortMapEntries(sourceCounts, "utmSource").slice(0, 6),
        topCampaigns: sortMapEntries(campaignCounts, "utmCampaign").slice(0, 6),
        byUnit: sortMapEntries(unitCounts, "unitSlug").slice(0, 6),
        siteBehavior,
        customLinks,
        siteConnections: {
            selectedSiteHost,
            sites: serializedConnections,
        },
        siteFunnel,
        behaviorQuality,
        recentBookings,
        recentIncompleteBookings,
        recentWhatsappClicks,
        coverageBuckets,
        capiIssueReasons: sortMapEntries(capiIssueReasonCounts, "reason").slice(0, 8),
        recentCapiIssues,
        recentRetryCandidates,
    });
}
