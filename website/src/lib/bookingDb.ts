import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { TrackingContext } from "@/lib/attribution";

type D1PreparedStatement = {
    bind: (...values: unknown[]) => D1PreparedStatement;
    first: <T = unknown>() => Promise<T | null>;
    all: <T = unknown>() => Promise<{ results: T[] }>;
    run: () => Promise<{ success: boolean; error?: string } | unknown>;
};

type D1DatabaseLike = {
    prepare: (query: string) => D1PreparedStatement;
    exec: (query: string) => Promise<unknown>;
};

export type BookingStatus = "pending" | "confirmed" | "declined" | "expired" | "needs_approval";

export type BookingRequestRow = {
    id: string;
    unit_slug: string;
    doctor_slug: string;
    service_id: string;
    start_at_ms: number;
    end_at_ms: number;
    status: BookingStatus;
    patient_name: string;
    whatsapp: string;
    customer_email: string | null;
    customer_cpf: string | null;
    customer_address: string | null;
    customer_id: string | null;
    notes: string | null;
    created_at_ms: number;
    confirm_by_ms: number;
    decided_at_ms: number | null;
    decided_by: string | null;
    decision_note: string | null;
    override_conflict: number;
    attribution_first_touch_json?: string | null;
    attribution_last_touch_json?: string | null;
    tracking_context_json?: string | null;
    meta_event_id?: string | null;
    marketing_consent?: number | null;
    analytics_consent?: number | null;
    fbp?: string | null;
    fbc?: string | null;
    fbclid?: string | null;
    landing_page?: string | null;
    referrer?: string | null;
};

type CloudflareEnv = {
    BOOKING_DB?: D1DatabaseLike;
};

function getDbOrThrow(): D1DatabaseLike {
    const { env } = getCloudflareContext();
    const typedEnv = env as unknown as CloudflareEnv;
    const db = typedEnv.BOOKING_DB;
    if (!db) {
        throw new Error("BOOKING_DB_not_configured");
    }
    return db;
}

let ensured = false;

export async function getBookingDb(): Promise<D1DatabaseLike> {
    const db = getDbOrThrow();
    if (!ensured) {
        await ensureSchema(db);
        ensured = true;
    }
    return db;
}

async function ensureSchema(db: D1DatabaseLike) {
    // Keep this idempotent so local preview works even before migrations.
    // Avoid multi-statement `exec` for maximum compatibility across runtimes.
    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS booking_requests (
                id TEXT PRIMARY KEY,
                unit_slug TEXT NOT NULL,
                doctor_slug TEXT NOT NULL,
                service_id TEXT NOT NULL,
                start_at_ms INTEGER NOT NULL,
                end_at_ms INTEGER NOT NULL,
                status TEXT NOT NULL,
                patient_name TEXT NOT NULL,
                whatsapp TEXT NOT NULL,
                customer_email TEXT,
                customer_cpf TEXT,
                customer_address TEXT,
                customer_id TEXT,
                notes TEXT,
                created_at_ms INTEGER NOT NULL,
                confirm_by_ms INTEGER NOT NULL,
                decided_at_ms INTEGER,
                decided_by TEXT,
                decision_note TEXT,
                override_conflict INTEGER NOT NULL DEFAULT 0
            );`,
        )
        .run();

    await tryAddColumn(db, "booking_requests", "customer_email TEXT");
    await tryAddColumn(db, "booking_requests", "customer_cpf TEXT");
    await tryAddColumn(db, "booking_requests", "customer_address TEXT");
    await tryAddColumn(db, "booking_requests", "customer_id TEXT");
    await tryAddColumn(db, "booking_requests", "attribution_first_touch_json TEXT");
    await tryAddColumn(db, "booking_requests", "attribution_last_touch_json TEXT");
    await tryAddColumn(db, "booking_requests", "tracking_context_json TEXT");
    await tryAddColumn(db, "booking_requests", "meta_event_id TEXT");
    await tryAddColumn(db, "booking_requests", "marketing_consent INTEGER NOT NULL DEFAULT 0");
    await tryAddColumn(db, "booking_requests", "analytics_consent INTEGER NOT NULL DEFAULT 0");
    await tryAddColumn(db, "booking_requests", "fbp TEXT");
    await tryAddColumn(db, "booking_requests", "fbc TEXT");
    await tryAddColumn(db, "booking_requests", "fbclid TEXT");
    await tryAddColumn(db, "booking_requests", "landing_page TEXT");
    await tryAddColumn(db, "booking_requests", "referrer TEXT");

    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS booking_customers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                whatsapp TEXT NOT NULL,
                cpf TEXT,
                address TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );`,
        )
        .run();

    await db
        .prepare(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_customers_email ON booking_customers(email);",
        )
        .run();

    await db
        .prepare(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_customers_cpf ON booking_customers(cpf);",
        )
        .run();

    await db
        .prepare(
            "CREATE INDEX IF NOT EXISTS idx_booking_unit_doctor_start ON booking_requests(unit_slug, doctor_slug, start_at_ms);",
        )
        .run();

    await db
        .prepare(
            "CREATE INDEX IF NOT EXISTS idx_booking_status_confirmby ON booking_requests(status, confirm_by_ms);",
        )
        .run();

    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS meta_capi_delivery_logs (
                id TEXT PRIMARY KEY,
                channel TEXT NOT NULL,
                event_name TEXT NOT NULL,
                event_id TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                ok INTEGER NOT NULL DEFAULT 0,
                http_status INTEGER,
                response_body TEXT,
                error_message TEXT,
                booking_id TEXT,
                wa_click_id TEXT,
                created_at_ms INTEGER NOT NULL
            );`,
        )
        .run();

    await db
        .prepare(
            "CREATE INDEX IF NOT EXISTS idx_meta_capi_event_id ON meta_capi_delivery_logs(event_id, created_at_ms);",
        )
        .run();

    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS whatsapp_click_events (
                id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL,
                wa_click_id TEXT NOT NULL,
                placement TEXT,
                source TEXT,
                unit_slug TEXT,
                doctor_name TEXT,
                booking_id TEXT,
                destination_url TEXT NOT NULL,
                redirect_url TEXT NOT NULL,
                page_url TEXT,
                page_path TEXT,
                tracking_context_json TEXT,
                client_ip TEXT,
                client_user_agent TEXT,
                created_at_ms INTEGER NOT NULL
            );`,
        )
        .run();

    await db
        .prepare(
            "CREATE INDEX IF NOT EXISTS idx_whatsapp_click_event_id ON whatsapp_click_events(event_id, created_at_ms);",
        )
        .run();

    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS site_behavior_events (
                id TEXT PRIMARY KEY,
                event_name TEXT NOT NULL,
                session_id TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                page_url TEXT,
                page_path TEXT,
                page_host TEXT,
                referrer TEXT,
                landing_page TEXT,
                utm_source TEXT,
                utm_medium TEXT,
                utm_campaign TEXT,
                utm_content TEXT,
                utm_term TEXT,
                fbclid TEXT,
                fbp TEXT,
                fbc TEXT,
                link_url TEXT,
                link_host TEXT,
                link_path TEXT,
                link_type TEXT,
                placement TEXT,
                source TEXT,
                unit_slug TEXT,
                service_id TEXT,
                booking_id TEXT,
                consent_analytics INTEGER NOT NULL DEFAULT 0,
                consent_marketing INTEGER NOT NULL DEFAULT 0,
                metadata_json TEXT
            );`,
        )
        .run();

    await db.prepare("CREATE INDEX IF NOT EXISTS idx_site_behavior_created_at ON site_behavior_events(created_at_ms);").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_site_behavior_event_name ON site_behavior_events(event_name, created_at_ms);").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_site_behavior_campaign ON site_behavior_events(utm_campaign, created_at_ms);").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_site_behavior_page_path ON site_behavior_events(page_path, created_at_ms);").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_site_behavior_unit ON site_behavior_events(unit_slug, created_at_ms);").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_site_behavior_service ON site_behavior_events(service_id, created_at_ms);").run();
}

async function tryAddColumn(db: D1DatabaseLike, table: string, columnDef: string) {
    try {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${columnDef};`).run();
    } catch {
        // Column already exists or ALTER not supported.
    }
}

export function nowMs(): number {
    return Date.now();
}

export function addMinutes(ms: number, minutes: number): number {
    return ms + minutes * 60_000;
}

export function clampText(value: string, max: number): string {
    const trimmed = (value ?? "").trim();
    if (trimmed.length <= max) return trimmed;
    return trimmed.slice(0, max);
}

export function sanitizeOneLine(value: string): string {
    return (value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizePhone(raw: string): string {
    const digits = (raw ?? "").replace(/\D/g, "");
    // Accept either:
    // - BR local formats: DDD + number (10-11 digits) -> prefix with country code 55
    // - E.164-ish digits already including country code (12+ digits) -> keep as-is
    if (digits.length < 10) return "";
    if (digits.startsWith("55")) return "+" + digits;
    if (digits.length === 10 || digits.length === 11) return "+55" + digits;
    return "+" + digits;
}

export function normalizeEmail(raw: string): string {
    const value = (raw ?? "").trim().toLowerCase();
    if (!value) return "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "";
    return value;
}

export function normalizeCpf(raw: string): string {
    const digits = (raw ?? "").replace(/\D/g, "");
    if (digits.length !== 11) return "";
    if (/^(\d)\1{10}$/.test(digits)) return "";
    return digits;
}

export function slugify(value: string): string {
    const v = (value ?? "").trim().toLowerCase();
    if (!v) return "";
    return v
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}

export function toSaoPauloIso(date: string, time: string): string {
    // We intentionally avoid asking the user for timezone.
    // Brazil is currently -03:00 (no DST). We store explicit offset.
    const d = (date ?? "").trim();
    const t = (time ?? "").trim();
    return `${d}T${t}:00-03:00`;
}

export function isValidDateKey(date: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test((date ?? "").trim());
}

export function isValidTimeKey(time: string): boolean {
    return /^\d{2}:\d{2}$/.test((time ?? "").trim());
}

export function parseCookieHeader(cookieHeader: string | null | undefined): Record<string, string> {
    const result: Record<string, string> = {};
    const raw = (cookieHeader ?? "").trim();
    if (!raw) return result;

    for (const item of raw.split(";")) {
        const [key, ...rest] = item.trim().split("=");
        if (!key) continue;
        result[key] = rest.join("=").trim();
    }

    return result;
}

export function safeJsonStringify(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
}

function sanitizeNullableString(value: unknown, max = 1000): string | null {
    if (typeof value !== "string") return null;
    const trimmed = sanitizeOneLine(value);
    if (!trimmed) return null;
    return clampText(trimmed, max);
}

function sanitizeCampaignParams(raw: unknown): TrackingContext["params"] {
    if (!raw || typeof raw !== "object") return {};
    const allowed = ["gclid", "gbraid", "wbraid", "msclkid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"];
    const result: TrackingContext["params"] = {};
    for (const key of allowed) {
        const value = (raw as Record<string, unknown>)[key];
        const cleaned = sanitizeNullableString(value, 200);
        if (cleaned) result[key as keyof TrackingContext["params"]] = cleaned;
    }
    return result;
}

function sanitizeTouch(raw: unknown): TrackingContext["firstTouch"] {
    if (!raw || typeof raw !== "object") return null;
    const capturedAtMs = Number((raw as { capturedAtMs?: unknown }).capturedAtMs ?? NaN);
    const landingUrl = sanitizeNullableString((raw as { landingUrl?: unknown }).landingUrl, 1000);
    const landingPath = sanitizeNullableString((raw as { landingPath?: unknown }).landingPath, 500);
    if (!landingUrl || !landingPath) return null;

    return {
        capturedAtMs: Number.isFinite(capturedAtMs) ? capturedAtMs : Date.now(),
        landingUrl,
        landingPath,
        referrer: sanitizeNullableString((raw as { referrer?: unknown }).referrer, 1000),
        params: sanitizeCampaignParams((raw as { params?: unknown }).params),
        fbclid: sanitizeNullableString((raw as { fbclid?: unknown }).fbclid, 255),
        fbp: sanitizeNullableString((raw as { fbp?: unknown }).fbp, 255),
        fbc: sanitizeNullableString((raw as { fbc?: unknown }).fbc, 255),
    };
}

export function coerceTrackingContext(raw: unknown): TrackingContext | null {
    if (!raw || typeof raw !== "object") return null;

    const capturedAtMs = Number((raw as { capturedAtMs?: unknown }).capturedAtMs ?? NaN);
    return {
        capturedAtMs: Number.isFinite(capturedAtMs) ? capturedAtMs : Date.now(),
        pageUrl: sanitizeNullableString((raw as { pageUrl?: unknown }).pageUrl, 1000),
        pagePath: sanitizeNullableString((raw as { pagePath?: unknown }).pagePath, 500),
        referrer: sanitizeNullableString((raw as { referrer?: unknown }).referrer, 1000),
        consent: {
            analytics: (raw as { consent?: { analytics?: unknown } }).consent?.analytics === true,
            marketing: (raw as { consent?: { marketing?: unknown } }).consent?.marketing === true,
        },
        params: sanitizeCampaignParams((raw as { params?: unknown }).params),
        fbclid: sanitizeNullableString((raw as { fbclid?: unknown }).fbclid, 255),
        fbp: sanitizeNullableString((raw as { fbp?: unknown }).fbp, 255),
        fbc: sanitizeNullableString((raw as { fbc?: unknown }).fbc, 255),
        landingUrl: sanitizeNullableString((raw as { landingUrl?: unknown }).landingUrl, 1000),
        landingPath: sanitizeNullableString((raw as { landingPath?: unknown }).landingPath, 500),
        firstTouch: sanitizeTouch((raw as { firstTouch?: unknown }).firstTouch),
        lastTouch: sanitizeTouch((raw as { lastTouch?: unknown }).lastTouch),
    };
}

export async function insertMetaCapiDeliveryLog(
    db: D1DatabaseLike,
    entry: {
        id: string;
        channel: "server";
        eventName: string;
        eventId: string;
        endpoint: string;
        ok: boolean;
        httpStatus: number | null;
        responseBody: string | null;
        errorMessage: string | null;
        bookingId?: string | null;
        waClickId?: string | null;
        createdAtMs: number;
    },
): Promise<void> {
    await db
        .prepare(
            "INSERT INTO meta_capi_delivery_logs (id, channel, event_name, event_id, endpoint, ok, http_status, response_body, error_message, booking_id, wa_click_id, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
            entry.id,
            entry.channel,
            entry.eventName,
            entry.eventId,
            entry.endpoint,
            entry.ok ? 1 : 0,
            entry.httpStatus,
            entry.responseBody,
            entry.errorMessage,
            entry.bookingId ?? null,
            entry.waClickId ?? null,
            entry.createdAtMs,
        )
        .run();
}

export async function insertWhatsappClickEvent(
    db: D1DatabaseLike,
    entry: {
        id: string;
        eventId: string;
        waClickId: string;
        placement?: string | null;
        source?: string | null;
        unitSlug?: string | null;
        doctorName?: string | null;
        bookingId?: string | null;
        destinationUrl: string;
        redirectUrl: string;
        pageUrl?: string | null;
        pagePath?: string | null;
        trackingContext?: TrackingContext | null;
        clientIp?: string | null;
        clientUserAgent?: string | null;
        createdAtMs: number;
    },
): Promise<void> {
    await db
        .prepare(
            "INSERT INTO whatsapp_click_events (id, event_id, wa_click_id, placement, source, unit_slug, doctor_name, booking_id, destination_url, redirect_url, page_url, page_path, tracking_context_json, client_ip, client_user_agent, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
            entry.id,
            entry.eventId,
            entry.waClickId,
            entry.placement ?? null,
            entry.source ?? null,
            entry.unitSlug ?? null,
            entry.doctorName ?? null,
            entry.bookingId ?? null,
            entry.destinationUrl,
            entry.redirectUrl,
            entry.pageUrl ?? null,
            entry.pagePath ?? null,
            safeJsonStringify(entry.trackingContext),
            entry.clientIp ?? null,
            entry.clientUserAgent ?? null,
            entry.createdAtMs,
        )
        .run();
}
