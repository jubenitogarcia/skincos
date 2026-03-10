import { getCloudflareContext } from "@opennextjs/cloudflare";

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
