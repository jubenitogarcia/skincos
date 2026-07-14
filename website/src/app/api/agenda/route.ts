import { NextResponse } from "next/server";
import { getAgendaDb, toUnitSlug } from "@/lib/agendaDb";
import { getRuntimeSecret } from "@/lib/runtimeSecrets";

export const dynamic = "force-dynamic";

type AppointmentRow = {
    unit_slug: string;
    date_key: string;
    time_key: string;
    client: string;
    tipo: string;
    profissional: string;
    telefone: string | null;
    cpf: string | null;
    service: string | null;
    notes: string | null;
    status: string | null;
};

function json(data: unknown, init?: ResponseInit) {
    return NextResponse.json(data, init);
}

function readToken(request: Request): string {
    const auth = (request.headers.get("authorization") ?? "").trim();
    if (auth.toLowerCase().startsWith("bearer ")) {
        return auth.slice(7).trim();
    }
    return (request.headers.get("x-agenda-sync-token") ?? "").trim();
}

async function assertToken(request: Request): Promise<boolean> {
    const secret = await getRuntimeSecret("AGENDA_SYNC_TOKEN");
    if (process.env.NODE_ENV === "production" && !secret) {
        return false;
    }
    if (!secret) return true;
    return readToken(request) === secret;
}

function isValidDateKey(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test((value ?? "").trim());
}

function parseDateKeyToMs(value: string): number | null {
    if (!isValidDateKey(value)) return null;
    const [y, m, d] = value.split("-").map((v) => Number(v));
    if (!y || !m || !d) return null;
    return Date.UTC(y, m - 1, d);
}

function parsePositiveInt(value: string | null): number | null {
    if (!value) return null;
    const n = Number(value.trim());
    if (!Number.isFinite(n)) return null;
    const out = Math.floor(n);
    if (out <= 0) return null;
    return out;
}

export async function GET(request: Request) {
    if (!(await assertToken(request))) {
        return json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const unitSlugRaw = (url.searchParams.get("unit_slug") ?? "").trim();
    const dateFrom = (url.searchParams.get("date_from") ?? "").trim();
    const dateTo = (url.searchParams.get("date_to") ?? "").trim();
    const includePii = (url.searchParams.get("include_pii") ?? "").trim().toLowerCase() === "true";
    const page = parsePositiveInt(url.searchParams.get("page"));
    const pageSize = parsePositiveInt(url.searchParams.get("page_size"));

    if (!unitSlugRaw || !dateFrom || !dateTo) {
        return json({ ok: false, error: "missing_params" }, { status: 400 });
    }

    const unitSlug = toUnitSlug(unitSlugRaw);
    if (!unitSlug || (unitSlug !== "barrashoppingsul" && unitSlug !== "novo-hamburgo")) {
        return json({ ok: false, error: "invalid_unit" }, { status: 400 });
    }

    if (!isValidDateKey(dateFrom) || !isValidDateKey(dateTo)) {
        return json({ ok: false, error: "invalid_date" }, { status: 400 });
    }

    const fromMs = parseDateKeyToMs(dateFrom);
    const toMs = parseDateKeyToMs(dateTo);
    if (fromMs === null || toMs === null) {
        return json({ ok: false, error: "invalid_date" }, { status: 400 });
    }
    if (fromMs > toMs) {
        return json({ ok: false, error: "invalid_range" }, { status: 400 });
    }
    const maxDays = 31;
    const dayMs = 24 * 60 * 60 * 1000;
    const rangeDays = Math.floor((toMs - fromMs) / dayMs) + 1;
    if (rangeDays > maxDays) {
        return json({ ok: false, error: "range_too_large", max_days: maxDays }, { status: 400 });
    }

    const safePageSize = Math.min(pageSize ?? 200, 500);
    const safePage = page ?? 1;
    const offset = (safePage - 1) * safePageSize;

    const db = await getAgendaDb();
    const result = await db
        .prepare(
            `SELECT unit_slug, date_key, time_key, client, tipo, profissional, telefone, cpf, service, notes, status
             FROM agenda_appointments
             WHERE unit_slug = ? AND date_key BETWEEN ? AND ? AND removed_at_ms IS NULL
             ORDER BY date_key ASC, time_key ASC
             LIMIT ? OFFSET ?;`,
        )
        .bind(unitSlug, dateFrom, dateTo, safePageSize + 1, offset)
        .all<AppointmentRow>();

    const rows = result.results ?? [];
    const hasMore = rows.length > safePageSize;
    const trimmed = hasMore ? rows.slice(0, safePageSize) : rows;
    const appointments = includePii
        ? trimmed
        : trimmed.map((row) => ({
              unit_slug: row.unit_slug,
              date_key: row.date_key,
              time_key: row.time_key,
              client: row.client,
              tipo: row.tipo,
              profissional: row.profissional,
              service: row.service,
              notes: row.notes,
              status: row.status,
          }));

    logAgendaRead({
        unit: unitSlug,
        dateFrom,
        dateTo,
        page: safePage,
        pageSize: safePageSize,
        includePii,
        count: appointments.length,
        hasMore,
    });

    return json(
        {
            ok: true,
            appointments,
            page: safePage,
            page_size: safePageSize,
            has_more: hasMore,
            include_pii: includePii,
        },
        { status: 200 },
    );
}

function logAgendaRead(params: {
    unit: string;
    dateFrom: string;
    dateTo: string;
    page: number;
    pageSize: number;
    includePii: boolean;
    count: number;
    hasMore: boolean;
}) {
    try {
        console.info("agenda.read", params);
    } catch {
        // noop
    }
}
