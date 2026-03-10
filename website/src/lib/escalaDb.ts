import { getCloudflareContext } from "@opennextjs/cloudflare";

type D1PreparedStatement = {
    bind: (...values: unknown[]) => D1PreparedStatement;
    all: <T = unknown>() => Promise<{ results: T[] }>;
    first: <T = unknown>() => Promise<T | null>;
};

type D1DatabaseLike = {
    prepare: (query: string) => D1PreparedStatement;
};

type CloudflareEnv = {
    SKINCOS_ESCALA_DB?: D1DatabaseLike;
};

type RawProfessionalRow = {
    name: string;
    status: string | null;
    role: string | null;
    nickname: string | null;
    instagram: string | null;
    units_json: string | null;
};

type RawNameRow = { professional: string };
type RawCountRow = { total: number };

export type EscalaProfessional = {
    name: string;
    status: string | null;
    role: string | null;
    nickname: string | null;
    instagram: string | null;
    units: string[];
};

export type EscalaDaySchedule = {
    closed: boolean;
    professionalNames: string[];
};

type CachedDaySchedule = {
    expiresAtMs: number;
    value: EscalaDaySchedule;
};

const DAY_SCHEDULE_TTL_MS = 60_000;
const dayScheduleCache = new Map<string, CachedDaySchedule>();

function getEscalaDb(): D1DatabaseLike | null {
    try {
        const { env } = getCloudflareContext();
        const typedEnv = env as unknown as CloudflareEnv;
        return typedEnv.SKINCOS_ESCALA_DB ?? null;
    } catch {
        return null;
    }
}

function normalizeUnitKey(value: string): string {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
}

export function normalizePersonKey(value: string): string {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
}

export function unitLabelFromEscalaUnitSlug(unitSlug: string): string | null {
    const key = normalizeUnitKey(unitSlug);
    if (!key) return null;
    if (key === "barrashoppingsul") return "BarraShoppingSul";
    if (key === "novohamburgo") return "Novo Hamburgo";
    return null;
}

function parseUnitsJson(value: string | null): string[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
    } catch {
        return [];
    }
}

function normalizeOneLine(value: string | null): string {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeInstagramHandle(value: string | null): string | null {
    const raw = normalizeOneLine(value);
    if (!raw) return null;
    const noAt = raw.startsWith("@") ? raw.slice(1) : raw;
    const fromUrl = noAt.match(/instagram\.com\/(?:@)?([^/?#]+)/i)?.[1] ?? noAt;
    const cleaned = fromUrl.replace(/[^a-zA-Z0-9._]/g, "");
    return cleaned || null;
}

export async function fetchEscalaProfessionals(unitSlug: string | null): Promise<EscalaProfessional[] | null> {
    const db = getEscalaDb();
    if (!db) return null;

    try {
        const unitLabel = unitSlug ? unitLabelFromEscalaUnitSlug(unitSlug) : null;
        const unitKey = normalizeUnitKey(unitLabel ?? "");
        const result = await db
            .prepare(
                `SELECT name, status, role, nickname, instagram, units_json
                 FROM professionals
                 ORDER BY name ASC`,
            )
            .all<RawProfessionalRow>();

        const professionals = (result.results ?? [])
            .map((row) => {
                const units = parseUnitsJson(row.units_json);
                return {
                    name: normalizeOneLine(row.name),
                    status: normalizeOneLine(row.status),
                    role: normalizeOneLine(row.role),
                    nickname: normalizeOneLine(row.nickname),
                    instagram: normalizeInstagramHandle(row.instagram),
                    units,
                };
            })
            .filter((row) => {
                if (!row.name) return false;
                const status = row.status.toLowerCase();
                if (status && status !== "ativo") return false;

                if (!unitKey) return true;
                const rowUnitKeys = row.units.map((unit) => normalizeUnitKey(unit));
                if (!rowUnitKeys.length) return false;
                return rowUnitKeys.includes(unitKey);
            })
            .map((row) => ({
                name: row.name,
                status: row.status || null,
                role: row.role || null,
                nickname: row.nickname || null,
                instagram: row.instagram,
                units: row.units,
            }));

        return professionals;
    } catch {
        return null;
    }
}

export async function fetchEscalaDaySchedule(unitSlug: string, dateKey: string): Promise<EscalaDaySchedule | null> {
    const unitLabel = unitLabelFromEscalaUnitSlug(unitSlug);
    if (!unitLabel) return null;

    const cacheKey = `${normalizeUnitKey(unitLabel)}|${dateKey}`;
    const now = Date.now();
    const cached = dayScheduleCache.get(cacheKey);
    if (cached && cached.expiresAtMs > now) return cached.value;

    const db = getEscalaDb();
    if (!db) return null;

    try {
        const scheduleResult = await db
            .prepare(
                `SELECT professional_name AS professional
                 FROM schedule_entries
                 WHERE unit = ? AND date = ?
                 ORDER BY professional_name ASC`,
            )
            .bind(unitLabel, dateKey)
            .all<RawNameRow>();

        const closedDaysCount = await db
            .prepare("SELECT COUNT(*) AS total FROM closed_days WHERE unit = ? AND date = ?")
            .bind(unitLabel, dateKey)
            .first<RawCountRow>();

        const holidaysCount = await db
            .prepare("SELECT COUNT(*) AS total FROM holidays WHERE unit = ? AND date = ?")
            .bind(unitLabel, dateKey)
            .first<RawCountRow>();

        const names = Array.from(
            new Set(
                (scheduleResult.results ?? [])
                    .map((row) => normalizeOneLine(row.professional))
                    .filter(Boolean),
            ),
        );

        const value: EscalaDaySchedule = {
            closed: Number(closedDaysCount?.total ?? 0) > 0 || Number(holidaysCount?.total ?? 0) > 0,
            professionalNames: names,
        };

        dayScheduleCache.set(cacheKey, { value, expiresAtMs: now + DAY_SCHEDULE_TTL_MS });
        return value;
    } catch {
        return null;
    }
}
