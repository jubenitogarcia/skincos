import { NextResponse } from "next/server";
import { getBookingDb, nowMs, addMinutes, clampText, normalizePhone, normalizeEmail, normalizeCpf, sanitizeOneLine, isValidDateKey, isValidTimeKey, toSaoPauloIso, slugify, coerceTrackingContext, insertMetaCapiDeliveryLog, parseCookieHeader } from "@/lib/bookingDb";
import { getServiceById } from "@/data/services";
import { getUnitDoctorsResult } from "@/lib/injectorsDirectory";
import { getAgendaDb } from "@/lib/agendaDb";
import { sendBookingNotifications, type PatientGender } from "@/lib/bookingNotifications";
import { doctorSlugMatchesQuery } from "@/lib/doctorSlug";
import { fetchEscalaDaySchedule, personNameMatches } from "@/lib/escalaDb";
import { issueBookingStatusToken } from "@/lib/bookingSecurity";
import { sendMetaServerEvent } from "@/lib/metaConversionsApi";
import { getRuntimeSecret } from "@/lib/runtimeSecrets";

export const dynamic = "force-dynamic";

type AgendaRange = { start: number; end: number };

type Payload = {
    unitSlug?: string;
    doctorSlug?: string;
    doctorName?: string;
    serviceId?: string;
    selectedServiceIds?: string[];
    durationMinutes?: number;
    includes?: { avaliacao?: boolean; procedimento?: boolean; revisao?: boolean };
    date?: string; // YYYY-MM-DD
    time?: string; // HH:MM
    patientName?: string;
    patientGender?: string;
    email?: string;
    whatsapp?: string;
    cpf?: string;
    address?: string;
    notes?: string;
    hp?: string;
    formStartedAtMs?: number;
    turnstileToken?: string | null;
    trackingContext?: unknown;
    metaEventId?: string;
};

function normalizePatientGender(raw: string): PatientGender | "" {
    const value = sanitizeOneLine(raw).toLowerCase();
    if (!value) return "";
    if (value === "male" || value === "masculino" || value === "masc" || value === "m") return "male";
    if (value === "female" || value === "feminino" || value === "fem" || value === "f") return "female";
    if (value === "unspecified" || value === "prefer_not_to_say" || value === "nao informar" || value === "não informar") return "unspecified";
    return "";
}

type CfCacheStorage = {
    default?: Cache;
};

function json(data: unknown, init?: ResponseInit) {
    return NextResponse.json(data, init);
}

function uuid(): string {
    const anyCrypto = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    if (anyCrypto.crypto?.randomUUID) return anyCrypto.crypto.randomUUID();
    return `req_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function getCloudflareCache(): Cache | null {
    const cachesAny = (globalThis as unknown as { caches?: CfCacheStorage }).caches;
    return cachesAny?.default ?? null;
}

function clientIp(request: Request): string | null {
    const fromCf = (request.headers.get("cf-connecting-ip") ?? "").trim();
    if (fromCf) return fromCf;
    const xff = (request.headers.get("x-forwarded-for") ?? "").trim();
    if (xff) return xff.split(",")[0]?.trim() || null;
    return null;
}

async function verifyTurnstile(params: { secret: string; token: string; ip: string | null }): Promise<{ ok: boolean }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);

    try {
        const body = new URLSearchParams();
        body.set("secret", params.secret);
        body.set("response", params.token);
        if (params.ip) body.set("remoteip", params.ip);

        const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body,
            signal: controller.signal,
        });

        const json = (await res.json().catch(() => null)) as { success?: boolean } | null;
        return { ok: !!res.ok && json?.success === true };
    } catch {
        return { ok: false };
    } finally {
        clearTimeout(timeout);
    }
}

async function tryPostWebhook(payload: unknown) {
    const url = await getRuntimeSecret("BOOKING_WEBHOOK_URL");
    if (!url) return;
    const secret = await getRuntimeSecret("BOOKING_WEBHOOK_SECRET");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    try {
        await fetch(url, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(secret ? { "x-booking-webhook-secret": secret } : null),
            } as Record<string, string>,
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
    } catch {
        // Best-effort: webhook failures should not break booking creation.
    } finally {
        clearTimeout(timeout);
    }
}

async function upsertCustomer(
    db: Awaited<ReturnType<typeof getBookingDb>>,
    params: { name: string; email: string; whatsapp: string; cpf: string | null; address: string | null; now: number },
) {
    const existing = await db
        .prepare("SELECT id FROM booking_customers WHERE email = ? OR (cpf IS NOT NULL AND cpf = ?) LIMIT 1")
        .bind(params.email, params.cpf)
        .first<{ id: string }>();

    if (existing?.id) {
        await db
            .prepare(
                "UPDATE booking_customers SET name = ?, email = ?, whatsapp = ?, cpf = ?, address = ?, updated_at_ms = ? WHERE id = ?",
            )
            .bind(params.name, params.email, params.whatsapp, params.cpf, params.address, params.now, existing.id)
            .run();
        return existing.id;
    }

    const id = uuid();
    await db
        .prepare(
            "INSERT INTO booking_customers (id, name, email, whatsapp, cpf, address, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id, params.name, params.email, params.whatsapp, params.cpf, params.address, params.now, params.now)
        .run();
    return id;
}

async function listAgendaRanges(params: { unitSlug: string; date: string }): Promise<AgendaRange[]> {
    const agendaDb = await getAgendaDb();
    const agendaRows = await agendaDb
        .prepare(
            `SELECT time_key, duration_min
             FROM agenda_appointments
             WHERE unit_slug = ? AND date_key = ? AND removed_at_ms IS NULL`,
        )
        .bind(params.unitSlug, params.date)
        .all<{ time_key: string; duration_min: number | null }>();

    const agendaRanges: AgendaRange[] = [];
    for (const row of agendaRows.results ?? []) {
        const timeKey = (row.time_key ?? "").toString().trim();
        if (!isValidTimeKey(timeKey)) continue;

        const agendaStartMs = Date.parse(toSaoPauloIso(params.date, timeKey));
        if (!Number.isFinite(agendaStartMs)) continue;

        const durationMin = Number(row.duration_min ?? 0);
        const agendaDurationMs = Number.isFinite(durationMin) && durationMin > 0 ? durationMin * 60_000 : 1;
        agendaRanges.push({
            start: agendaStartMs,
            end: agendaStartMs + agendaDurationMs,
        });
    }

    return agendaRanges;
}

function hasAgendaConflictForDoctor(params: {
    agendaRanges: AgendaRange[];
    startAtMs: number;
    endAtMs: number;
}): boolean {
    // Business rule: agenda slots from scraper block by unit+day+time regardless of "profissional".
    return params.agendaRanges.some((range) => range.start < params.endAtMs && range.end > params.startAtMs);
}

export async function POST(request: Request) {
    let body: Payload;
    try {
        body = (await request.json()) as Payload;
    } catch {
        return json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    const unitSlug = sanitizeOneLine(body.unitSlug ?? "");
    const doctorSlugRaw = sanitizeOneLine(body.doctorSlug ?? "");
    const doctorName = sanitizeOneLine(body.doctorName ?? "");
    const serviceId = sanitizeOneLine(body.serviceId ?? "");
    const selectedServiceIds = Array.isArray(body.selectedServiceIds)
        ? Array.from(new Set(body.selectedServiceIds.map((value) => sanitizeOneLine(String(value))).filter(Boolean))).slice(0, 8)
        : serviceId
            ? [serviceId]
            : [];
    const durationMinutesRaw = typeof body.durationMinutes === "number" ? body.durationMinutes : Number(body.durationMinutes ?? NaN);
    const date = sanitizeOneLine(body.date ?? "");
    const time = sanitizeOneLine(body.time ?? "");
    const hp = sanitizeOneLine(body.hp ?? "");
    const formStartedAtMsRaw = typeof body.formStartedAtMs === "number" ? body.formStartedAtMs : Number(body.formStartedAtMs ?? NaN);
    const turnstileToken = sanitizeOneLine((body.turnstileToken ?? "").toString());

    const patientName = clampText(sanitizeOneLine(body.patientName ?? ""), 80);
    const patientGender = normalizePatientGender(body.patientGender ?? "");
    const email = normalizeEmail(body.email ?? "");
    const whatsapp = normalizePhone(body.whatsapp ?? "");
    const cpf = normalizeCpf(body.cpf ?? "") || null;
    const address = clampText(sanitizeOneLine(body.address ?? ""), 160) || null;

    // Optional field, but avoid sensitive prompts.
    const rawNotes = clampText((body.notes ?? "").trim(), 300) || null;
    const trackingContext = coerceTrackingContext(body.trackingContext);
    const requestCookies = parseCookieHeader(request.headers.get("cookie"));
    const clientUserAgent = sanitizeOneLine(request.headers.get("user-agent") ?? "") || null;
    const trackingContextResolved = trackingContext
        ? {
            ...trackingContext,
            fbp: trackingContext.fbp ?? requestCookies._fbp ?? null,
            fbc: trackingContext.fbc ?? requestCookies._fbc ?? null,
            fbclid: trackingContext.fbclid ?? trackingContext.params.fbclid ?? null,
        }
        : null;

    if (!unitSlug || !doctorSlugRaw || !serviceId || !date || !time) {
        return json({ ok: false, error: "missing_fields" }, { status: 400 });
    }

    if (unitSlug !== "barrashoppingsul" && unitSlug !== "novo-hamburgo") {
        return json({ ok: false, error: "invalid_unit" }, { status: 400 });
    }

    if (!isValidDateKey(date) || !isValidTimeKey(time)) {
        return json({ ok: false, error: "invalid_datetime" }, { status: 400 });
    }

    if (!patientName) {
        return json({ ok: false, error: "missing_name" }, { status: 400 });
    }

    if (!email) {
        return json({ ok: false, error: "invalid_email" }, { status: 400 });
    }

    if (!patientGender) {
        return json({ ok: false, error: "invalid_gender" }, { status: 400 });
    }

    if (!whatsapp) {
        return json({ ok: false, error: "invalid_whatsapp" }, { status: 400 });
    }

    const service =
        serviceId === "any"
            ? { id: "any", name: "Outro" }
            : getServiceById(serviceId);
    if (!service) {
        return json({ ok: false, error: "invalid_service" }, { status: 400 });
    }

    const selectedProcedures = selectedServiceIds
        .map((id) => (id === "any" ? { id: "any", name: "Outro" } : getServiceById(id)))
        .filter((item): item is { id: string; name: string; subtitle?: string } => !!item);
    const selectedProcedureNames = selectedProcedures.map((item) => item.name);
    const procedureNotesPrefix =
        selectedProcedureNames.length > 1
            ? `Procedimentos selecionados: ${selectedProcedureNames.join(", ")}`
            : null;
    const notes = [procedureNotesPrefix, rawNotes].filter(Boolean).join("\n\n") || null;

    if (!Number.isFinite(durationMinutesRaw)) {
        return json({ ok: false, error: "missing_duration" }, { status: 400 });
    }
    const durationMinutes = Math.round(durationMinutesRaw);
    if (durationMinutes <= 0 || durationMinutes > 180 || durationMinutes % 15 !== 0) {
        return json({ ok: false, error: "invalid_duration" }, { status: 400 });
    }

    const wantsAnyDoctor = doctorSlugRaw === "any";
    const doctorSlug = wantsAnyDoctor ? "any" : doctorSlugRaw || (doctorName ? slugify(doctorName) : "");
    if (!doctorSlug) {
        return json({ ok: false, error: "invalid_doctor" }, { status: 400 });
    }

    const startIso = toSaoPauloIso(date, time);
    const startAtMs = Date.parse(startIso);
    if (!Number.isFinite(startAtMs)) {
        return json({ ok: false, error: "invalid_start" }, { status: 400 });
    }

    const endAtMs = addMinutes(startAtMs, durationMinutes);
    const createdAtMs = nowMs();
    const confirmByMs = addMinutes(createdAtMs, 60); // must be confirmed within 1h

    if (startAtMs < createdAtMs) {
        return json({ ok: false, error: "start_in_past" }, { status: 400 });
    }

    // Honeypot + minimum time-to-submit (best-effort spam filtering).
    if (hp) {
        return json({ ok: false, error: "spam_detected" }, { status: 400 });
    }
    if (Number.isFinite(formStartedAtMsRaw)) {
        const elapsed = createdAtMs - Number(formStartedAtMsRaw);
        // Avoid false positives with clock drift.
        if (elapsed >= 0 && elapsed < 1200) {
            return json({ ok: false, error: "too_fast" }, { status: 429 });
        }
    }

    // Best-effort rate limit to reduce spam bursts (per edge location/cache).
    // We apply this only after basic validation to avoid blocking genuine corrections.
    const cache = getCloudflareCache();
    const ip = clientIp(request);
    if (cache && ip) {
        const origin = new URL(request.url).origin;
        const cacheKey = new Request(`${origin}/__rate/booking_request/${encodeURIComponent(ip)}`);
        try {
            const hit = await cache.match(cacheKey);
            if (hit) {
                return json({ ok: false, error: "rate_limited" }, { status: 429 });
            }
            await cache.put(
                cacheKey,
                new Response("ok", {
                    status: 200,
                    headers: { "cache-control": "public, max-age=12, s-maxage=12" },
                }),
            );
        } catch {
            // ignore cache/rate-limit errors
        }
    }

    // Optional Cloudflare Turnstile verification (recommended for production).
    const turnstileSecret = await getRuntimeSecret("TURNSTILE_SECRET_KEY");
    const requireTurnstileRaw = (process.env.BOOKING_REQUIRE_TURNSTILE ?? "").trim().toLowerCase();
    const requireTurnstile =
        requireTurnstileRaw === "1" ||
        requireTurnstileRaw === "true" ||
        requireTurnstileRaw === "yes";
    if (requireTurnstile && !turnstileSecret) {
        return json({ ok: false, error: "turnstile_unavailable" }, { status: 503 });
    }
    if (turnstileSecret) {
        if (!turnstileToken) {
            return json({ ok: false, error: "turnstile_failed" }, { status: 403 });
        }
        const verify = await verifyTurnstile({ secret: turnstileSecret, token: turnstileToken, ip });
        if (!verify.ok) {
            return json({ ok: false, error: "turnstile_failed" }, { status: 403 });
        }
    }

    const doctorsResult = await getUnitDoctorsResult(unitSlug);
    if (!doctorsResult.ok) {
        return json({ ok: false, error: "doctors_unavailable" }, { status: 503 });
    }
    const doctors = doctorsResult.doctors;
    if (doctors.length === 0) {
        return json({ ok: false, error: "no_doctors_for_unit" }, { status: 400 });
    }

    const selectedDoctor = wantsAnyDoctor ? null : doctors.find((doctor) => doctorSlugMatchesQuery(doctorSlug, doctor)) ?? null;
    if (!wantsAnyDoctor && !selectedDoctor) {
        return json({ ok: false, error: "invalid_doctor" }, { status: 400 });
    }

    const daySchedule = await fetchEscalaDaySchedule(unitSlug, date);
    let doctorsAvailableBySchedule = doctors;
    if (daySchedule) {
        if (daySchedule.closed) {
            return json({ ok: false, error: "no_availability" }, { status: 409 });
        }

        doctorsAvailableBySchedule = doctors.filter((doctor) => daySchedule.professionalNames.some((name) => personNameMatches(name, doctor.name)));

        if (!wantsAnyDoctor && selectedDoctor && !daySchedule.professionalNames.some((name) => personNameMatches(name, selectedDoctor.name))) {
            return json({ ok: false, error: "no_availability" }, { status: 409 });
        }
        if (wantsAnyDoctor && doctorsAvailableBySchedule.length === 0) {
            return json({ ok: false, error: "no_availability" }, { status: 409 });
        }
    }
    const agendaRanges = await listAgendaRanges({ unitSlug, date });

    // If the user has no preference, pick a free doctor for that unit+slot.
    let effectiveDoctorSlug = doctorSlug;
    let safeDoctorName = clampText(selectedDoctor?.name || doctorName || doctorSlug, 120);
    if (wantsAnyDoctor) {
        const doctorsForSelection = daySchedule ? doctorsAvailableBySchedule : doctors;

        const pick = doctorsForSelection.find((doctor) => {
            return !hasAgendaConflictForDoctor({
                agendaRanges,
                startAtMs,
                endAtMs,
            });
        }) ?? null;
        if (!pick) {
            return json({ ok: false, error: "no_availability" }, { status: 409 });
        }

        effectiveDoctorSlug = pick.slug;
        safeDoctorName = clampText(pick.name, 120);
    }

    const blockedByAgenda = hasAgendaConflictForDoctor({
        agendaRanges,
        startAtMs,
        endAtMs,
    });
    if (blockedByAgenda) {
        return json({ ok: false, error: "no_availability" }, { status: 409 });
    }

    // Persist the website request for protocol/automation, but do not let local booking_requests
    // become a scheduling lock. Slot blocking must mirror agenda_appointments from the system only.
    const db = await getBookingDb();

    const status = "confirmed";

    const id = uuid();
    const metaEventId = clampText(sanitizeOneLine(body.metaEventId ?? ""), 120) || `schedule_${id}`;

    const decisionLinks = null;

    let customerId: string | null = null;
    try {
        customerId = await upsertCustomer(db, {
            name: patientName,
            email,
            whatsapp,
            cpf,
            address,
            now: createdAtMs,
        });
    } catch {
        // Best-effort: avoid blocking booking if customer upsert fails.
    }

    try {
        await db
            .prepare(
                "INSERT INTO booking_requests (id, unit_slug, doctor_slug, service_id, start_at_ms, end_at_ms, status, patient_name, whatsapp, customer_email, customer_cpf, customer_address, customer_id, notes, created_at_ms, confirm_by_ms, decided_at_ms, decided_by, decision_note, override_conflict) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0)",
            )
            .bind(
                id,
                unitSlug,
                effectiveDoctorSlug,
                serviceId,
                startAtMs,
                endAtMs,
                status,
                patientName,
                whatsapp,
                email,
                cpf,
                address,
                customerId,
                notes,
                createdAtMs,
                confirmByMs,
            )
            .run();
    } catch (e) {
        const msg = e instanceof Error ? e.message : "insert_failed";
        return json({ ok: false, error: "db_error", message: msg }, { status: 500 });
    }

    const statusTokenExpMs = addMinutes(confirmByMs, 120);
    const statusSecret = (await getRuntimeSecret("BOOKING_STATUS_SECRET")) || (await getRuntimeSecret("BOOKING_DECISION_SECRET"));
    let statusToken: string | null = null;
    if (statusSecret) {
        try {
            statusToken = await issueBookingStatusToken({ secret: statusSecret, id, expMs: statusTokenExpMs });
        } catch {
            statusToken = null;
        }
    }

    const notifications =
        status === "confirmed"
            ? await sendBookingNotifications({
                id,
                unitSlug,
                procedureName: selectedProcedureNames.length > 0 ? selectedProcedureNames.join(", ") : service.name,
                date,
                time,
                patientName,
                patientGender,
                email,
                whatsapp,
                cpf: cpf ?? undefined,
                address: address ?? undefined,
                doctorName: safeDoctorName,
                statusToken,
            })
            : {
                email: { ok: false, status: "skipped", error: "not_confirmed" },
                whatsapp: { ok: false, status: "skipped", error: "not_confirmed" },
                unitEmail: { ok: false, status: "skipped", error: "not_confirmed" },
            };

    if (status === "confirmed") {
        try {
            await db
                .prepare(
                    "UPDATE booking_requests SET attribution_first_touch_json = ?, attribution_last_touch_json = ?, tracking_context_json = ?, meta_event_id = ?, marketing_consent = ?, analytics_consent = ?, fbp = ?, fbc = ?, fbclid = ?, landing_page = ?, referrer = ? WHERE id = ?",
                )
                .bind(
                    trackingContextResolved?.firstTouch ? JSON.stringify(trackingContextResolved.firstTouch) : null,
                    trackingContextResolved?.lastTouch ? JSON.stringify(trackingContextResolved.lastTouch) : null,
                    trackingContextResolved ? JSON.stringify(trackingContextResolved) : null,
                    metaEventId,
                    trackingContextResolved?.consent.marketing ? 1 : 0,
                    trackingContextResolved?.consent.analytics ? 1 : 0,
                    trackingContextResolved?.fbp ?? null,
                    trackingContextResolved?.fbc ?? null,
                    trackingContextResolved?.fbclid ?? null,
                    trackingContextResolved?.landingPath ?? trackingContextResolved?.pagePath ?? null,
                    trackingContextResolved?.referrer ?? null,
                    id,
                )
                .run();
        } catch {
            // Keep booking creation resilient if tracking persistence fails.
        }

        await sendMetaServerEvent(
            {
                eventName: "Schedule",
                eventId: metaEventId,
                eventSourceUrl:
                    trackingContextResolved?.pageUrl ??
                    `${(process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "")}/agendamento`,
                userData: {
                    email,
                    phone: whatsapp,
                    externalId: customerId ?? email ?? whatsapp,
                    clientIpAddress: clientIp(request),
                    clientUserAgent,
                    fbp: trackingContextResolved?.fbp ?? null,
                    fbc: trackingContextResolved?.fbc ?? null,
                },
                customData: {
                    booking_id: id,
                    unit_slug: unitSlug,
                    doctor_slug: effectiveDoctorSlug,
                    doctor_name: safeDoctorName,
                    service_id: service.id,
                    service_name: service.name,
                    selected_service_ids: selectedProcedures.map((item) => item.id),
                    selected_service_names: selectedProcedures.map((item) => item.name),
                    status,
                    start_at_ms: startAtMs,
                    end_at_ms: endAtMs,
                    currency: "BRL",
                },
                trackingContext: trackingContextResolved,
                bookingId: id,
            },
            {
                logDelivery: async (entry) => {
                    await insertMetaCapiDeliveryLog(db, {
                        id: uuid(),
                        ...entry,
                        createdAtMs: nowMs(),
                    });
                },
            },
        );
    }

    // Optional: notify external automation via webhook (WhatsApp integration etc.)
    await tryPostWebhook({
        event: "booking.created",
        booking: {
            id,
            status,
            unitSlug,
            doctorSlug: effectiveDoctorSlug,
            doctorName: safeDoctorName,
            durationMinutes,
            includes: body.includes ?? null,
            service: { id: service.id, name: service.name },
            selectedServices: selectedProcedures.map((item) => ({ id: item.id, name: item.name })),
            startAtMs,
            endAtMs,
            confirmByMs,
            patientName,
            patientGender,
            email,
            whatsapp,
            cpf,
            address,
            customerId,
            notes,
            metaEventId,
            trackingContext: trackingContextResolved,
        },
        decisionLinks,
    });

    return json(
        {
            ok: true,
            id,
            status,
            confirmByMs,
            unitSlug,
            doctorSlug: effectiveDoctorSlug,
            doctorName: safeDoctorName,
            durationMinutes,
            service: { id: service.id, name: service.name },
            startAtMs,
            endAtMs,
            decisionLinks,
            statusToken,
            statusTokenExpMs,
            notifications,
            metaEventId,
        },
        { status: 200 },
    );
}
