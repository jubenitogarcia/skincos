import { getBookingDb, normalizeEmail, normalizePhone, nowMs, sanitizeOneLine } from "@/lib/bookingDb";

type D1PreparedStatement = {
    bind: (...values: unknown[]) => D1PreparedStatement;
    first: <T = unknown>() => Promise<T | null>;
    run: () => Promise<unknown>;
};

type D1DatabaseLike = {
    prepare: (query: string) => D1PreparedStatement;
};

export type CadastroLeadRow = {
    id: string;
    full_name: string;
    email: string;
    phone: string;
    unit_slug: string | null;
    prize_id: number | null;
    created_at_ms: number;
    updated_at_ms: number;
    awarded_at_ms: number | null;
};

export type CadastroLeadPrizeClaim = {
    prizeId: number;
    replay: boolean;
};

type D1RunResult = {
    success: boolean;
    error?: string;
    meta?: {
        changes?: number;
    };
};

let ensured = false;

function readD1RunResult(value: unknown): D1RunResult {
    if (!value || typeof value !== "object" || typeof (value as { success?: unknown }).success !== "boolean") {
        throw new Error("cadastro_wheel_prize_claim_invalid_d1_result");
    }
    return value as D1RunResult;
}

async function ensureCadastroLeadSchema(db: D1DatabaseLike) {
    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS cadastro_wheel_leads (
                id TEXT PRIMARY KEY,
                full_name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT NOT NULL,
                unit_slug TEXT,
                prize_id INTEGER,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                awarded_at_ms INTEGER
            );`,
        )
        .run();

    await db
        .prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_cadastro_wheel_leads_email ON cadastro_wheel_leads(email);")
        .run();

    await db
        .prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_cadastro_wheel_leads_phone ON cadastro_wheel_leads(phone);")
        .run();
}

async function getCadastroLeadDb(): Promise<D1DatabaseLike> {
    const db = await getBookingDb();
    if (!ensured) {
        await ensureCadastroLeadSchema(db);
        ensured = true;
    }
    return db;
}

function createLeadId(): string {
    return crypto.randomUUID();
}

export function normalizeCadastroLeadInput(input: { fullName?: string; email?: string; phone?: string; unitSlug?: string | null }) {
    return {
        fullName: sanitizeOneLine(input.fullName ?? ""),
        email: normalizeEmail(input.email ?? ""),
        phone: normalizePhone(input.phone ?? ""),
        unitSlug: sanitizeOneLine(input.unitSlug ?? "") || null,
    };
}

export async function findCadastroLeadById(id: string): Promise<CadastroLeadRow | null> {
    const safeId = sanitizeOneLine(id);
    if (!safeId) return null;
    const db = await getCadastroLeadDb();
    return db
        .prepare(
            `SELECT id, full_name, email, phone, unit_slug, prize_id, created_at_ms, updated_at_ms, awarded_at_ms
             FROM cadastro_wheel_leads
             WHERE id = ?
             LIMIT 1`,
        )
        .bind(safeId)
        .first<CadastroLeadRow>();
}

export async function findCadastroLeadByIdentity(params: { email: string; phone: string }): Promise<CadastroLeadRow | null> {
    const db = await getCadastroLeadDb();
    return db
        .prepare(
            `SELECT id, full_name, email, phone, unit_slug, prize_id, created_at_ms, updated_at_ms, awarded_at_ms
             FROM cadastro_wheel_leads
             WHERE email = ? OR phone = ?
             ORDER BY updated_at_ms DESC
             LIMIT 1`,
        )
        .bind(params.email, params.phone)
        .first<CadastroLeadRow>();
}

export async function createCadastroLead(params: {
    fullName: string;
    email: string;
    phone: string;
    unitSlug: string | null;
}): Promise<CadastroLeadRow> {
    const db = await getCadastroLeadDb();
    const ts = nowMs();
    const id = createLeadId();

    await db
        .prepare(
            `INSERT INTO cadastro_wheel_leads
                (id, full_name, email, phone, unit_slug, prize_id, created_at_ms, updated_at_ms, awarded_at_ms)
             VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
        )
        .bind(id, params.fullName, params.email, params.phone, params.unitSlug, ts, ts)
        .run();

    return {
        id,
        full_name: params.fullName,
        email: params.email,
        phone: params.phone,
        unit_slug: params.unitSlug,
        prize_id: null,
        created_at_ms: ts,
        updated_at_ms: ts,
        awarded_at_ms: null,
    };
}

export async function touchCadastroLead(params: {
    id: string;
    fullName: string;
    email: string;
    phone: string;
    unitSlug: string | null;
}): Promise<void> {
    const db = await getCadastroLeadDb();
    const ts = nowMs();
    await db
        .prepare(
            `UPDATE cadastro_wheel_leads
             SET full_name = ?, email = ?, phone = ?, unit_slug = ?, updated_at_ms = ?
             WHERE id = ?`,
        )
        .bind(params.fullName, params.email, params.phone, params.unitSlug, ts, params.id)
        .run();
}

export async function assignCadastroLeadPrize(params: { id: string; prizeId: number }): Promise<CadastroLeadPrizeClaim | null> {
    const safeId = sanitizeOneLine(params.id);
    if (!safeId || !Number.isInteger(params.prizeId) || params.prizeId < 1) {
        return null;
    }

    const db = await getCadastroLeadDb();
    const ts = nowMs();
    const update = readD1RunResult(
        await db
            .prepare(
                `UPDATE cadastro_wheel_leads
                 SET prize_id = ?, awarded_at_ms = COALESCE(awarded_at_ms, ?), updated_at_ms = ?
                 WHERE id = ? AND prize_id IS NULL`,
            )
            .bind(params.prizeId, ts, ts, safeId)
            .run(),
    );

    if (!update.success) {
        throw new Error("cadastro_wheel_prize_claim_failed");
    }

    if (update.meta?.changes === 1) {
        return {
            prizeId: params.prizeId,
            replay: false,
        };
    }

    if (update.meta?.changes !== 0) {
        throw new Error("cadastro_wheel_prize_claim_invalid_change_count");
    }

    const existing = await db
        .prepare(
            `SELECT prize_id
             FROM cadastro_wheel_leads
             WHERE id = ?
             LIMIT 1`,
        )
        .bind(safeId)
        .first<Pick<CadastroLeadRow, "prize_id">>();

    const existingPrizeId = existing?.prize_id;
    if (typeof existingPrizeId !== "number" || !Number.isInteger(existingPrizeId) || existingPrizeId < 1) {
        return null;
    }

    return {
        prizeId: existingPrizeId,
        replay: true,
    };
}
