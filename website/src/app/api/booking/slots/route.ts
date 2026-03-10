import { NextResponse } from "next/server";
import { getBookingDb, nowMs, addMinutes, isValidDateKey, isValidTimeKey, toSaoPauloIso } from "@/lib/bookingDb";
import { getAgendaDb } from "@/lib/agendaDb";
import { getServiceById } from "@/data/services";
import { getUnitDoctorsResult } from "@/lib/injectorsDirectory";

export const dynamic = "force-dynamic";

type AgendaRange = { start: number; end: number };
type AgendaCacheEntry = { expiresAtMs: number; ranges: AgendaRange[]; count: number };

const agendaCache = new Map<string, AgendaCacheEntry>();
const AGENDA_CACHE_TTL_MS = 60_000;

function json(data: unknown, init?: ResponseInit) {
    return NextResponse.json(data, init);
}

function parseUnitSlug(value: string | null): string {
    return (value ?? "").trim();
}

function parseDoctorSlug(value: string | null): string {
    return (value ?? "").trim();
}

function formatTimeHHMM(hours: number, minutes: number): string {
    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    return `${hh}:${mm}`;
}

function parseDateKey(dateKey: string): Date | null {
    const [y, m, d] = dateKey.split("-").map((value) => Number(value));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
}

function getUnitSchedule(unitSlug: string, dateKey: string): { startMinutes: number; endMinutes: number } | null {
    const date = parseDateKey(dateKey);
    if (!date) return null;

    const day = date.getDay();
    if (day === 0) return null;

    if (unitSlug === "novo-hamburgo") {
        if (day === 6) return { startMinutes: 9 * 60 + 30, endMinutes: 18 * 60 + 30 };
        return { startMinutes: 10 * 60, endMinutes: 19 * 60 };
    }

    if (unitSlug === "barrashoppingsul") {
        return { startMinutes: 11 * 60 + 30, endMinutes: 20 * 60 + 30 };
    }

    return null;
}

function buildDaySlots(unitSlug: string, dateKey: string, durationMinutes: number) {
    const slots: Array<{ time: string; startOffsetMin: number }> = [];
    const schedule = getUnitSchedule(unitSlug, dateKey);
    if (!schedule) return slots;

    const step = 15;

    for (let startMin = schedule.startMinutes; startMin <= schedule.endMinutes - durationMinutes; startMin += step) {
        const hours = Math.floor(startMin / 60);
        const minutes = startMin % 60;
        slots.push({ time: formatTimeHHMM(hours, minutes), startOffsetMin: startMin });
    }

    return slots;
}

async function expireIfNeeded(db: Awaited<ReturnType<typeof getBookingDb>>, id: string) {
    // Best-effort: mark pending approvals as expired after confirm_by.
    const row = await db
        .prepare("SELECT id, status, confirm_by_ms FROM booking_requests WHERE id = ?")
        .bind(id)
        .first<{ id: string; status: string; confirm_by_ms: number }>();

    if (!row) return;
    const status = (row.status ?? "").toString();
    if (status !== "pending" && status !== "needs_approval") return;

    const now = nowMs();
    if (now <= Number(row.confirm_by_ms)) return;

    await db
        .prepare(
            "UPDATE booking_requests SET status = 'expired', decided_at_ms = ?, decision_note = COALESCE(decision_note, 'auto_expired') WHERE id = ? AND (status = 'pending' OR status = 'needs_approval')",
        )
        .bind(now, id)
        .run();
}

export async function GET(req: Request) {
    const url = new URL(req.url);

    const unitSlug = parseUnitSlug(url.searchParams.get("unit"));
    const doctorSlug = parseDoctorSlug(url.searchParams.get("doctor"));
    const serviceId = (url.searchParams.get("service") ?? "").trim();
    const durationMinutesRaw = Number((url.searchParams.get("durationMinutes") ?? "").trim() || NaN);
    const date = (url.searchParams.get("date") ?? "").trim();

    if (!unitSlug || !doctorSlug || !serviceId || !date) {
        return json({ ok: false, error: "missing_params" }, { status: 400 });
    }

    if (unitSlug !== "barrashoppingsul" && unitSlug !== "novo-hamburgo") {
        return json({ ok: false, error: "invalid_unit" }, { status: 400 });
    }

    if (!isValidDateKey(date)) {
        return json({ ok: false, error: "invalid_date" }, { status: 400 });
    }

    if (serviceId !== "any") {
        const service = getServiceById(serviceId);
        if (!service) {
            return json({ ok: false, error: "invalid_service" }, { status: 400 });
        }
    }

    if (!Number.isFinite(durationMinutesRaw)) {
        return json({ ok: false, error: "missing_duration" }, { status: 400 });
    }
    const durationMinutes = Math.round(durationMinutesRaw);
    if (durationMinutes <= 0 || durationMinutes > 180 || durationMinutes % 15 !== 0) {
        return json({ ok: false, error: "invalid_duration" }, { status: 400 });
    }
    const daySlots = buildDaySlots(unitSlug, date, durationMinutes);

    const db = await getBookingDb();
    const wantsAnyDoctor = doctorSlug === "any";
    const unitDoctorsResult = wantsAnyDoctor ? await getUnitDoctorsResult(unitSlug) : null;
    if (wantsAnyDoctor && unitDoctorsResult && !unitDoctorsResult.ok) {
        return json({ ok: false, error: "doctors_unavailable" }, { status: 503 });
    }

    const unitDoctors = wantsAnyDoctor ? unitDoctorsResult!.doctors : [];
    const doctorSlugs = wantsAnyDoctor ? unitDoctors.map((d) => d.slug) : [doctorSlug];
    if (wantsAnyDoctor && doctorSlugs.length === 0) {
        return json({ ok: false, error: "no_doctors_for_unit" }, { status: 400 });
    }

    const cacheKey = `${unitSlug}|${date}`;
    const cached = agendaCache.get(cacheKey);
    const nowTs = Date.now();
    let agendaRanges: AgendaRange[] = [];
    let agendaRowsCount = 0;
    let agendaCacheHit = false;
    if (cached && cached.expiresAtMs > nowTs) {
        agendaRanges = cached.ranges;
        agendaRowsCount = cached.count;
        agendaCacheHit = true;
    } else {
        const agendaDb = await getAgendaDb();
        const agendaRows = await agendaDb
            .prepare(
                `SELECT time_key, duration_min
                 FROM agenda_appointments
                 WHERE unit_slug = ? AND date_key = ? AND removed_at_ms IS NULL`,
            )
            .bind(unitSlug, date)
            .all<{ time_key: string; duration_min: number | null }>();
        agendaRanges = [];
        for (const row of agendaRows.results ?? []) {
            const time = (row.time_key ?? "").toString().trim();
            if (!time || !isValidTimeKey(time)) continue;
            const startIso = toSaoPauloIso(date, time);
            const startMs = Date.parse(startIso);
            if (!Number.isFinite(startMs)) continue;
            const durationMin = Number(row.duration_min ?? 0);
            const durationMs = Number.isFinite(durationMin) && durationMin > 0 ? durationMin * 60_000 : 1;
            agendaRanges.push({ start: startMs, end: startMs + durationMs });
        }
        agendaRowsCount = agendaRows.results?.length ?? 0;
        agendaCache.set(cacheKey, {
            expiresAtMs: nowTs + AGENDA_CACHE_TTL_MS,
            ranges: agendaRanges,
            count: agendaRowsCount,
        });
    }

    // Fetch existing bookings for that day (unit + doctor(s))
    const dayStartIso = toSaoPauloIso(date, "00:00");
    const dayStartMs = Date.parse(dayStartIso);
    const dayEndMs = addMinutes(dayStartMs, 24 * 60);

    const inPlaceholders = doctorSlugs.map(() => "?").join(", ");
    const existing = await db
        .prepare(
            `SELECT id, doctor_slug, start_at_ms, end_at_ms, status, confirm_by_ms FROM booking_requests WHERE unit_slug = ? AND doctor_slug IN (${inPlaceholders}) AND start_at_ms < ? AND end_at_ms > ?`,
        )
        .bind(unitSlug, ...doctorSlugs, dayEndMs, dayStartMs)
        .all<{ id: string; doctor_slug: string; start_at_ms: number; end_at_ms: number; status: string; confirm_by_ms: number }>();

    // Expire stale rows we just loaded.
    for (const row of existing.results) {
        await expireIfNeeded(db, row.id);
    }

    const now = nowMs();

    const normalizedExisting = existing.results
        .map((r) => {
            const status = (r.status ?? "").toString();
            const confirmBy = Number(r.confirm_by_ms ?? 0);
            const activePending = (status === "pending" || status === "needs_approval") && now <= confirmBy;
            const activeConfirmed = status === "confirmed";
            return {
                id: r.id,
                doctorSlug: (r.doctor_slug ?? "").toString(),
                start: Number(r.start_at_ms),
                end: Number(r.end_at_ms),
                status,
                active: activeConfirmed || activePending,
                isConfirmed: activeConfirmed,
            };
        })
        .filter((r) => r.active);

    const byDoctor = new Map<string, Array<{ start: number; end: number; isConfirmed: boolean }>>();
    for (const e of normalizedExisting) {
        const key = e.doctorSlug;
        const list = byDoctor.get(key) ?? [];
        list.push({ start: e.start, end: e.end, isConfirmed: e.isConfirmed });
        if (!byDoctor.has(key)) byDoctor.set(key, list);
    }

    let agendaBlockedCount = 0;
    const out = daySlots.map((s) => {
        const time = s.time;
        if (!isValidTimeKey(time)) {
            return { time, available: false, reason: "invalid_time" };
        }

        const startIso = toSaoPauloIso(date, time);
        const startMs = Date.parse(startIso);
        const endMs = addMinutes(startMs, durationMinutes);

        let available = true;
        let reason: string | null = null;

        // Past times always win over other reasons.
        if (startMs < now) {
            return { time, startAtMs: startMs, endAtMs: endMs, available: false, reason: "past" };
        }

        if (agendaRanges.some((r) => r.start < endMs && r.end > startMs)) {
            agendaBlockedCount += 1;
            return { time, available: false, reason: "agenda" };
        }

        if (!wantsAnyDoctor) {
            for (const e of normalizedExisting) {
                const overlaps = e.start < endMs && e.end > startMs;
                if (!overlaps) continue;
                available = false;
                reason = e.isConfirmed ? "booked" : "in_review";
                break;
            }
        } else {
            let hasPending = false;
            let hasConfirmed = false;
            let anyFree = false;

            for (const slug of doctorSlugs) {
                const ranges = byDoctor.get(slug) ?? [];
                const overlap = ranges.some((e) => e.start < endMs && e.end > startMs);
                if (!overlap) {
                    anyFree = true;
                    break;
                }
                if (ranges.some((e) => e.start < endMs && e.end > startMs && e.isConfirmed)) hasConfirmed = true;
                if (ranges.some((e) => e.start < endMs && e.end > startMs && !e.isConfirmed)) hasPending = true;
            }

            if (!anyFree) {
                available = false;
                reason = hasPending ? "in_review" : hasConfirmed ? "booked" : "booked";
            }
        }

        return {
            time,
            startAtMs: startMs,
            endAtMs: endMs,
            available,
            reason,
        };
    });

    logSlotsSummary({
        unit: unitSlug,
        date,
        doctor: doctorSlug,
        service: serviceId,
        durationMinutes,
        agendaRows: agendaRowsCount,
        agendaBlocked: agendaBlockedCount,
        totalSlots: out.length,
        agendaCacheHit,
    });

    return json({ ok: true, unitSlug, doctorSlug, serviceId, durationMinutes, date, slots: out }, { status: 200 });
}

function logSlotsSummary(params: {
    unit: string;
    date: string;
    doctor: string;
    service: string;
    durationMinutes: number;
    agendaRows: number;
    agendaBlocked: number;
    totalSlots: number;
    agendaCacheHit: boolean;
}) {
    try {
        console.info("booking.slots", params);
    } catch {
        // noop
    }
}
