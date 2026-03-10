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

export async function getAgendaDb(): Promise<D1DatabaseLike> {
    const db = getDbOrThrow();
    if (!ensured) {
        await ensureSchema(db);
        ensured = true;
    }
    return db;
}

async function ensureSchema(db: D1DatabaseLike) {
    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS agenda_appointments (
                appointment_id TEXT PRIMARY KEY,
                unit_slug TEXT NOT NULL,
                date_key TEXT NOT NULL,
                time_key TEXT NOT NULL,
                client TEXT NOT NULL,
                tipo TEXT NOT NULL,
                profissional TEXT NOT NULL,
                telefone TEXT,
                cpf TEXT,
                source TEXT,
                service TEXT,
                notes TEXT,
                status TEXT,
                duration_min INTEGER,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                last_seen_at_ms INTEGER NOT NULL,
                removed_at_ms INTEGER
            );`,
        )
        .run();

    await db
        .prepare(
            `CREATE INDEX IF NOT EXISTS idx_agenda_unit_date_time
             ON agenda_appointments(unit_slug, date_key, time_key);`,
        )
        .run();

    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS agenda_changes (
                id TEXT PRIMARY KEY,
                unit_slug TEXT NOT NULL,
                change_type TEXT NOT NULL,
                appointment_id TEXT,
                date_key TEXT,
                time_key TEXT,
                client TEXT,
                tipo TEXT,
                profissional TEXT,
                created_at_ms INTEGER NOT NULL
            );`,
        )
        .run();

    await db
        .prepare(
            `CREATE INDEX IF NOT EXISTS idx_agenda_changes_unit_time
             ON agenda_changes(unit_slug, created_at_ms);`,
        )
        .run();

    await addColumnIfMissing(db, "agenda_appointments", "duration_min INTEGER");
}

async function addColumnIfMissing(db: D1DatabaseLike, table: string, definition: string) {
    try {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition};`).run();
    } catch {
        // Ignore if column already exists or ALTER TABLE not supported in runtime.
    }
}

export function nowMs(): number {
    return Date.now();
}

export function normalizeOneLine(value: string): string {
    return (value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeKey(value: string): string {
    const v = normalizeOneLine(value).toLowerCase();
    if (!v) return "";
    return v
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}

export function toUnitSlug(unit: string): string {
    const raw = normalizeKey(unit);
    if (!raw) return "";
    if (raw === "barrashoppingsul" || raw === "barra-shopping-sul") return "barrashoppingsul";
    if (raw === "novohamburgo" || raw === "novo-hamburgo") return "novo-hamburgo";
    return raw;
}

export function parseDateKey(date: string): string {
    const raw = normalizeOneLine(date);
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
    if (!match) return "";
    const [, dd, mm, yyyy] = match;
    return `${yyyy}-${mm}-${dd}`;
}

export function parseTimeKey(time: string): string {
    const raw = normalizeOneLine(time);
    const match = /^(\d{2}):(\d{2})/.exec(raw);
    if (!match) return "";
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return "";
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return "";
    return `${match[1]}:${match[2]}`;
}

export function computeAppointmentId(params: {
    unitSlug: string;
    dateKey: string;
    timeKey: string;
    client: string;
    tipo: string;
    profissional: string;
}): string {
    const parts = [
        normalizeKey(params.unitSlug),
        normalizeKey(params.dateKey),
        normalizeKey(params.timeKey),
        normalizeKey(params.client),
        normalizeKey(params.tipo),
        normalizeKey(params.profissional),
    ];
    return parts.join("|");
}

export function newId(): string {
    const anyCrypto = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    if (anyCrypto.crypto?.randomUUID) return anyCrypto.crypto.randomUUID();
    return `chg_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}
