import { NextResponse } from "next/server";
import { getBookingDb, type BookingRequestRow } from "@/lib/bookingDb";
import { getRuntimeSecret } from "@/lib/runtimeSecrets";

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

    let whatsappClicksWithTracking = 0;
    const recentWhatsappClicks = whatsappRows.slice(0, limit).map((row) => {
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
    whatsappClicksWithTracking += whatsappRows.slice(limit).filter((row) => row.tracking_context_json).length;

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
            whatsappClicks: whatsappRows.length,
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
        recentBookings,
        recentIncompleteBookings,
        recentWhatsappClicks,
        coverageBuckets,
        capiIssueReasons: sortMapEntries(capiIssueReasonCounts, "reason").slice(0, 8),
        recentCapiIssues,
        recentRetryCandidates,
    });
}
