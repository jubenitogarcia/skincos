import { NextResponse } from "next/server";
import {
    computeAppointmentId,
    getAgendaDb,
    newId,
    normalizeOneLine,
    nowMs,
    parseDateKey,
    parseTimeKey,
    toUnitSlug,
} from "@/lib/agendaDb";
import { getRuntimeSecret } from "@/lib/runtimeSecrets";

export const dynamic = "force-dynamic";

type AppointmentPayload = {
    data?: string;
    horario?: string;
    cliente?: string;
    tipo?: string;
    profissional?: string;
    telefone?: string;
    cpf?: string;
    source?: string;
    servico?: string;
    observacoes?: string;
    status?: string;
    duration_min?: number | string;
};

type RemovalPayload = {
    data?: string;
    horario?: string;
    cliente?: string;
    tipo?: string;
    profissional?: string;
};

type Payload = {
    unit?: string;
    added?: AppointmentPayload[];
    removed?: RemovalPayload[];
    runId?: string;
    schema_version?: number | string;
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

function parseSchemaVersion(value: number | string | undefined): number | null {
    if (value === undefined || value === null) return null;
    const v = typeof value === "string" ? Number(value.trim()) : value;
    if (!Number.isFinite(v)) return null;
    return Math.round(v);
}

function parseDurationMin(value: number | string | undefined): number | null {
    if (value === undefined || value === null) return null;
    const v = typeof value === "string" ? Number(value.trim()) : value;
    if (!Number.isFinite(v)) return null;
    const out = Math.round(v);
    if (out <= 0 || out > 24 * 60) return null;
    return out;
}

export async function POST(request: Request) {
    if (!(await assertToken(request))) {
        return json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    let body: Payload;
    try {
        body = (await request.json()) as Payload;
    } catch {
        return json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    const schemaVersion = parseSchemaVersion(body.schema_version);
    if (schemaVersion !== null && schemaVersion !== 1) {
        return json({ ok: false, error: "invalid_schema_version" }, { status: 400 });
    }

    const unitSlug = toUnitSlug(body.unit ?? "");
    if (!unitSlug) {
        return json({ ok: false, error: "missing_unit" }, { status: 400 });
    }
    if (unitSlug !== "barrashoppingsul" && unitSlug !== "novo-hamburgo") {
        return json({ ok: false, error: "invalid_unit" }, { status: 400 });
    }

    const added = Array.isArray(body.added) ? body.added : [];
    const removed = Array.isArray(body.removed) ? body.removed : [];

    const db = await getAgendaDb();
    const now = nowMs();

    let addedOk = 0;
    let addedSkipped = 0;
    let removedOk = 0;
    let removedSkipped = 0;

    for (const item of added) {
        const dateKey = parseDateKey(item.data ?? "");
        const timeKey = parseTimeKey(item.horario ?? "");
        const client = normalizeOneLine(item.cliente ?? "");
        const tipo = normalizeOneLine(item.tipo ?? "");
        const profissional = normalizeOneLine(item.profissional ?? "");
        const durationMin = parseDurationMin(item.duration_min);
        if (!dateKey || !timeKey || !client || !tipo || !profissional) {
            addedSkipped += 1;
            continue;
        }

        const appointmentId = computeAppointmentId({
            unitSlug,
            dateKey,
            timeKey,
            client,
            tipo,
            profissional,
        });

        await db
            .prepare(
                `INSERT INTO agenda_appointments (
                    appointment_id,
                    unit_slug,
                    date_key,
                    time_key,
                    client,
                    tipo,
                    profissional,
                    telefone,
                    cpf,
                    source,
                    service,
                    notes,
                    status,
                    duration_min,
                    created_at_ms,
                    updated_at_ms,
                    last_seen_at_ms,
                    removed_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                ON CONFLICT(appointment_id) DO UPDATE SET
                    unit_slug = excluded.unit_slug,
                    date_key = excluded.date_key,
                    time_key = excluded.time_key,
                    client = excluded.client,
                    tipo = excluded.tipo,
                    profissional = excluded.profissional,
                    telefone = excluded.telefone,
                    cpf = excluded.cpf,
                    source = excluded.source,
                    service = excluded.service,
                    notes = excluded.notes,
                    status = excluded.status,
                    duration_min = excluded.duration_min,
                    updated_at_ms = excluded.updated_at_ms,
                    last_seen_at_ms = excluded.last_seen_at_ms,
                    removed_at_ms = NULL;`,
            )
            .bind(
                appointmentId,
                unitSlug,
                dateKey,
                timeKey,
                client,
                tipo,
                profissional,
                normalizeOneLine(item.telefone ?? ""),
                normalizeOneLine(item.cpf ?? ""),
                normalizeOneLine(item.source ?? ""),
                normalizeOneLine(item.servico ?? ""),
                normalizeOneLine(item.observacoes ?? ""),
                normalizeOneLine(item.status ?? ""),
                durationMin,
                now,
                now,
                now,
            )
            .run();

        await db
            .prepare(
                `INSERT INTO agenda_changes (
                    id, unit_slug, change_type, appointment_id, date_key, time_key, client, tipo, profissional, created_at_ms
                ) VALUES (?, ?, 'added', ?, ?, ?, ?, ?, ?, ?);`,
            )
            .bind(newId(), unitSlug, appointmentId, dateKey, timeKey, client, tipo, profissional, now)
            .run();

        addedOk += 1;
    }

    for (const item of removed) {
        const dateKey = parseDateKey(item.data ?? "");
        const timeKey = parseTimeKey(item.horario ?? "");
        const client = normalizeOneLine(item.cliente ?? "");
        const tipo = normalizeOneLine(item.tipo ?? "");
        const profissional = normalizeOneLine(item.profissional ?? "");
        if (!dateKey || !timeKey) {
            removedSkipped += 1;
            continue;
        }

        let appointmentId: string | null = null;
        if (client && tipo && profissional) {
            appointmentId = computeAppointmentId({
                unitSlug,
                dateKey,
                timeKey,
                client,
                tipo,
                profissional,
            });
            await db
                .prepare(
                    `UPDATE agenda_appointments
                     SET removed_at_ms = ?
                     WHERE appointment_id = ? AND removed_at_ms IS NULL;`,
                )
                .bind(now, appointmentId)
                .run();
        } else {
            await db
                .prepare(
                    `UPDATE agenda_appointments
                     SET removed_at_ms = ?
                     WHERE unit_slug = ? AND date_key = ? AND time_key = ? AND removed_at_ms IS NULL;`,
                )
                .bind(now, unitSlug, dateKey, timeKey)
                .run();
        }

        await db
            .prepare(
                `INSERT INTO agenda_changes (
                    id, unit_slug, change_type, appointment_id, date_key, time_key, client, tipo, profissional, created_at_ms
                ) VALUES (?, ?, 'removed', ?, ?, ?, ?, ?, ?, ?);`,
            )
            .bind(newId(), unitSlug, appointmentId, dateKey, timeKey, client, tipo, profissional, now)
            .run();

        removedOk += 1;
    }

    logSyncSummary({
        unit: unitSlug,
        added: addedOk,
        removed: removedOk,
        addedSkipped,
        removedSkipped,
        runId: body.runId ?? null,
        schemaVersion: schemaVersion ?? 1,
    });

    return json({
        ok: true,
        unit: unitSlug,
        added: addedOk,
        removed: removedOk,
        added_skipped: addedSkipped,
        removed_skipped: removedSkipped,
        runId: body.runId ?? null,
        schema_version: schemaVersion ?? 1,
    });
}

function logSyncSummary(params: {
    unit: string;
    added: number;
    removed: number;
    addedSkipped: number;
    removedSkipped: number;
    runId: string | null;
    schemaVersion: number;
}) {
    try {
        console.info("agenda.sync", params);
    } catch {
        // noop
    }
}
