import { NextResponse } from "next/server";
import { nowMs, addMinutes, isValidDateKey, isValidTimeKey, toSaoPauloIso } from "@/lib/bookingDb";
import { getAgendaDb } from "@/lib/agendaDb";
import { getServiceById } from "@/data/services";
import { getUnitDoctorsResult } from "@/lib/injectorsDirectory";
import { doctorSlugMatchesQuery } from "@/lib/doctorSlug";
import { fetchEscalaDaySchedule, personNameMatches } from "@/lib/escalaDb";

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

function buildUnavailableSlots(params: { date: string; durationMinutes: number; daySlots: Array<{ time: string }>; reason: string }) {
    return params.daySlots.map((slot) => {
        const startAtMs = Date.parse(toSaoPauloIso(params.date, slot.time));
        return {
            time: slot.time,
            startAtMs,
            endAtMs: addMinutes(startAtMs, params.durationMinutes),
            available: false,
            reason: params.reason,
        };
    });
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

    const wantsAnyDoctor = doctorSlug === "any";
    const unitDoctorsResult = await getUnitDoctorsResult(unitSlug);
    if (wantsAnyDoctor && !unitDoctorsResult.ok) {
        return json({ ok: false, error: "doctors_unavailable" }, { status: 503 });
    }

    const unitDoctors = unitDoctorsResult.ok ? unitDoctorsResult.doctors : [];
    const knownDoctor = !wantsAnyDoctor ? unitDoctors.find((doctor) => doctorSlugMatchesQuery(doctorSlug, doctor)) ?? null : null;
    let doctorSlugs = wantsAnyDoctor ? unitDoctors.map((doctor) => doctor.slug) : knownDoctor ? [knownDoctor.slug] : [doctorSlug];
    if (wantsAnyDoctor && doctorSlugs.length === 0) {
        return json({ ok: false, error: "no_doctors_for_unit" }, { status: 400 });
    }
    if (!wantsAnyDoctor && !knownDoctor) {
        return json({ ok: false, error: "invalid_doctor" }, { status: 400 });
    }

    const daySchedule = await fetchEscalaDaySchedule(unitSlug, date);
    if (daySchedule?.closed) {
        const slots = buildUnavailableSlots({ date, durationMinutes, daySlots, reason: "closed_day" });
        return json({ ok: true, unitSlug, doctorSlug, serviceId, durationMinutes, date, slots }, { status: 200 });
    }

    if (daySchedule) {
        if (daySchedule.professionalNames.length === 0) {
            const slots = buildUnavailableSlots({ date, durationMinutes, daySlots, reason: "doctor_off" });
            return json({ ok: true, unitSlug, doctorSlug, serviceId, durationMinutes, date, slots }, { status: 200 });
        }

        if (wantsAnyDoctor) {
            doctorSlugs = unitDoctors
                .filter((doctor) => daySchedule.professionalNames.some((name) => personNameMatches(name, doctor.name)))
                .map((doctor) => doctor.slug);

            if (doctorSlugs.length === 0) {
                const slots = buildUnavailableSlots({ date, durationMinutes, daySlots, reason: "doctor_off" });
                return json({ ok: true, unitSlug, doctorSlug, serviceId, durationMinutes, date, slots }, { status: 200 });
            }
        } else if (knownDoctor && !daySchedule.professionalNames.some((name) => personNameMatches(name, knownDoctor.name))) {
            const slots = buildUnavailableSlots({ date, durationMinutes, daySlots, reason: "doctor_off" });
            return json({ ok: true, unitSlug, doctorSlug, serviceId, durationMinutes, date, slots }, { status: 200 });
        }
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
                `SELECT time_key, duration_min, profissional
                 FROM agenda_appointments
                 WHERE unit_slug = ? AND date_key = ? AND removed_at_ms IS NULL`,
            )
            .bind(unitSlug, date)
            .all<{ time_key: string; duration_min: number | null; profissional: string | null }>();
        agendaRanges = [];
        for (const row of agendaRows.results ?? []) {
            const time = (row.time_key ?? "").toString().trim();
            if (!time || !isValidTimeKey(time)) continue;
            const startIso = toSaoPauloIso(date, time);
            const startMs = Date.parse(startIso);
            if (!Number.isFinite(startMs)) continue;
            const durationMin = Number(row.duration_min ?? 0);
            const durationMs = Number.isFinite(durationMin) && durationMin > 0 ? durationMin * 60_000 : 1;
            agendaRanges.push({
                start: startMs,
                end: startMs + durationMs,
            });
        }
        agendaRowsCount = agendaRows.results?.length ?? 0;
        agendaCache.set(cacheKey, {
            expiresAtMs: nowTs + AGENDA_CACHE_TTL_MS,
            ranges: agendaRanges,
            count: agendaRowsCount,
        });
    }

    const now = nowMs();
    let agendaBlockedCount = 0;
    const overlapsAgendaForDoctor = (startMs: number, endMs: number) => {
        // The site agenda must mirror the system agenda only.
        // Local website booking requests do not reserve slots until the automation creates them in app.espacofacial.com.br.
        return agendaRanges.some((r) => r.start < endMs && r.end > startMs);
    };
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

        if (!wantsAnyDoctor && overlapsAgendaForDoctor(startMs, endMs)) {
            agendaBlockedCount += 1;
            return { time, available: false, reason: "agenda" };
        }

        if (wantsAnyDoctor) {
            const hasAgendaConflict = doctorSlugs.length > 0 && overlapsAgendaForDoctor(startMs, endMs);
            if (hasAgendaConflict) {
                available = false;
                reason = "agenda";
                agendaBlockedCount += 1;
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
