"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { units } from "@/data/units";
import { services, type Service } from "@/data/services";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import { useTeamDirectory } from "@/hooks/useTeamDirectory";
import { clearBookingDraft, persistBookingDraft, readBookingDraft, type BookingDraftState } from "@/lib/bookingDraft";
import { doctorSlugFromTeamMember, normalizeDoctorSlug } from "@/lib/doctorSlug";
import { trackBookingFunnelStep, trackBookingRequestSubmitted, trackDoctorInstagramClick } from "@/lib/leadTracking";
import { setStoredUnitSlug } from "@/lib/unitSelection";
import DoctorInstagramModal, { InstagramIcon, type DoctorInstagramProfile } from "@/components/DoctorInstagramModal";
import TurnstileWidget from "@/components/TurnstileWidget";
import UnitChooser from "@/components/UnitChooser";

type SlotsPayload = {
    ok: true;
    unitSlug: string;
    doctorSlug: string;
    serviceId: string;
    durationMinutes: number;
    date: string;
    slots: Array<{ time: string; startAtMs: number; endAtMs: number; available: boolean; reason: string | null }>;
};

type NotificationResult = { ok: boolean; status: string; provider?: string; error?: string };

type RequestResponse =
    | { ok: true; id: string; status: string; confirmByMs: number; startAtMs: number; endAtMs: number; unitSlug: string; doctorSlug: string; doctorName: string; service: { id: string; name: string }; notifications?: { email: NotificationResult; whatsapp: NotificationResult } }
    | { ok: false; error: string; message?: string };

type BookingStatus = {
    id: string;
    status: string;
    unit_slug: string;
    doctor_slug: string;
    service_id: string;
    start_at_ms: number;
    end_at_ms: number;
    confirm_by_ms: number;
    patient_name: string;
    whatsapp: string;
    notes: string | null;
    durationMinutes?: number;
    service?: { id: string; name: string } | null;
};

type StatusResponse = { ok: true; booking: BookingStatus } | { ok: false; error: string };
type DetailsStage = "contact" | "identity";
type DoctorSelection = { slug: string; name: string; handle: string | null };

const ANY_DOCTOR: DoctorSelection = { slug: "any", name: "Sem Preferência", handle: null };
const OTHER_SERVICE: Service = { id: "any", name: "Outro", subtitle: "Outro procedimento ou combinação" };

function isOkResponse(value: unknown): value is { ok: true } {
    return !!value && typeof value === "object" && (value as { ok?: unknown }).ok === true;
}

function unitLabelFromSlug(slug: string | null | undefined): string | null {
    if (!slug) return null;
    if (slug === "barrashoppingsul") return "BarraShoppingSul";
    if (slug === "novo-hamburgo" || slug === "novohamburgo") return "Novo Hamburgo";
    return null;
}

function normalizeSlug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findUnit(slug: string | null | undefined) {
    if (!slug) return null;
    return (
        units.find((u) => u.slug === slug) ??
        units.find((u) => normalizeSlug(u.slug) === normalizeSlug(slug)) ??
        null
    );
}

function avatarUrl(handle: string, name: string) {
    const h = encodeURIComponent(handle);
    const n = encodeURIComponent(name);
    return `/api/instagram-avatar?handle=${h}&name=${n}`;
}

function extractInstagramHandle(url: string | null): string | null {
    if (!url) return null;
    try {
        const { pathname } = new URL(url);
        const handle = pathname.split("/").filter(Boolean)[0];
        return handle ? handle.replace(/^@/, "") : null;
    } catch {
        return null;
    }
}

function initialsFromName(name: string) {
    const letters = name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("");
    return letters || "EF";
}

function pad2(n: number) {
    return String(n).padStart(2, "0");
}

function formatLocalDateKey(d: Date): string {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDatePtBr(dateKey: string): string {
    const [y, m, d] = dateKey.split("-").map((x) => Number(x));
    if (!y || !m || !d) return dateKey;
    return `${pad2(d)}/${pad2(m)}/${y}`;
}

function parseLocalDateKey(dateKey: string): Date | null {
    const [y, m, d] = dateKey.split("-").map((x) => Number(x));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
}

function weekdayPtBrShort(dateKey: string): string {
    const dt = parseLocalDateKey(dateKey);
    if (!dt) return "";
    return ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][dt.getDay()] ?? "";
}

function formatTimeFromMs(ms: number): string {
    const dt = new Date(ms);
    return `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

function formatDeadline(ms: number): string {
    const dt = new Date(ms);
    return `${formatTimeFromMs(ms)} (${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)})`;
}

function formatBrPhone(input: string): string {
    const digits = (input ?? "").replace(/\D/g, "");
    const d = digits.slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : "";
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function formatCpf(input: string): string {
    const digits = (input ?? "").replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
    if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function startOfCurrentWeek(date: Date): Date {
    const start = new Date(date);
    const mondayIndex = (date.getDay() + 6) % 7;
    start.setDate(date.getDate() - mondayIndex);
    start.setHours(0, 0, 0, 0);
    return start;
}

function isDateKeyBeforeToday(dateKey: string): boolean {
    const candidate = parseLocalDateKey(dateKey);
    if (!candidate) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return candidate.getTime() < today.getTime();
}

function HoverScrollPicker(props: { ariaLabel: string; children: ReactNode; className?: string; scrollWindowClassName?: string }) {
    const ref = useRef<HTMLDivElement | null>(null);
    const hoverTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [canLeft, setCanLeft] = useState(false);
    const [canRight, setCanRight] = useState(false);

    const update = () => {
        const el = ref.current;
        if (!el) return;
        const left = el.scrollLeft;
        const maxLeft = el.scrollWidth - el.clientWidth;
        setCanLeft(left > 1);
        setCanRight(left < maxLeft - 1);
    };

    useEffect(() => {
        update();
        const onResize = () => update();
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    const stopHoverScroll = () => {
        if (!hoverTimerRef.current) return;
        clearInterval(hoverTimerRef.current);
        hoverTimerRef.current = null;
    };

    const startHoverScroll = (dir: -1 | 1) => {
        stopHoverScroll();
        hoverTimerRef.current = setInterval(() => {
            const el = ref.current;
            if (!el) return;
            el.scrollLeft += dir * 4;
            update();
        }, 26);
    };

    useEffect(() => {
        return () => {
            if (hoverTimerRef.current) clearInterval(hoverTimerRef.current);
        };
    }, []);

    const scrollByDir = (dir: -1 | 1) => {
        const el = ref.current;
        if (!el) return;
        el.scrollBy({ left: dir * 120, behavior: "smooth" });
    };

    return (
        <div className={["bookingFlow__picker", props.className].filter(Boolean).join(" ")}>
            <button
                type="button"
                className="bookingFlow__hoverZone bookingFlow__hoverZone--left"
                aria-label="Mover lista para a esquerda"
                disabled={!canLeft}
                onMouseEnter={() => startHoverScroll(-1)}
                onMouseLeave={stopHoverScroll}
                onFocus={() => startHoverScroll(-1)}
                onBlur={stopHoverScroll}
                onClick={() => scrollByDir(-1)}
            >
                <span className="bookingFlow__scrollArrow bookingFlow__scrollArrow--left" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18">
                        <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </span>
            </button>

            <div
                ref={ref}
                className={["bookingFlow__scrollWindow", props.scrollWindowClassName].filter(Boolean).join(" ")}
                role="list"
                aria-label={props.ariaLabel}
                onScroll={update}
            >
                {props.children}
            </div>

            <button
                type="button"
                className="bookingFlow__hoverZone bookingFlow__hoverZone--right"
                aria-label="Mover lista para a direita"
                disabled={!canRight}
                onMouseEnter={() => startHoverScroll(1)}
                onMouseLeave={stopHoverScroll}
                onFocus={() => startHoverScroll(1)}
                onBlur={stopHoverScroll}
                onClick={() => scrollByDir(1)}
            >
                <span className="bookingFlow__scrollArrow bookingFlow__scrollArrow--right" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18">
                        <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </span>
            </button>
        </div>
    );
}

export default function BookingFlow() {
    const currentUnit = useCurrentUnit();
    const searchParams = useSearchParams();
    const turnstileSiteKey = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "").trim();
    const { members, error: membersError, loading: membersLoading } = useTeamDirectory();

    const [step, setStep] = useState<"pick" | "details" | "submitted">("pick");
    const [detailsStage, setDetailsStage] = useState<DetailsStage>("contact");

    const [doctor, setDoctor] = useState<DoctorSelection | null>(null);
    const [selectedServices, setSelectedServices] = useState<Service[]>([]);

    const [dateKey, setDateKey] = useState<string | null>(null);
    const [timeKey, setTimeKey] = useState<string | null>(null);
    const [dateTouched, setDateTouched] = useState(false);

    const [slots, setSlots] = useState<SlotsPayload | null>(null);
    const [slotsLoading, setSlotsLoading] = useState(false);
    const [slotsError, setSlotsError] = useState<string | null>(null);

    const [patientName, setPatientName] = useState("");
    const [email, setEmail] = useState("");
    const [whatsapp, setWhatsapp] = useState("");
    const [cpf, setCpf] = useState("");
    const [address, setAddress] = useState("");
    const [notes, setNotes] = useState("");

    const [detailsStartedAtMs, setDetailsStartedAtMs] = useState<number | null>(null);
    const [honeypot, setHoneypot] = useState("");
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
    const [turnstileHadError, setTurnstileHadError] = useState(false);

    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [activeInstagram, setActiveInstagram] = useState<DoctorInstagramProfile | null>(null);
    const [dateAvailability, setDateAvailability] = useState<Record<string, boolean>>({});

    const [submitted, setSubmitted] = useState<{ id: string; status: string; confirmByMs: number; notifications?: { email: NotificationResult; whatsapp: NotificationResult } } | null>(null);
    const [status, setStatus] = useState<BookingStatus | null>(null);
    const draftToRestoreRef = useRef<BookingDraftState | null>(null);
    const draftAppliedRef = useRef(false);
    const draftReadyRef = useRef(false);

    const allowedUnitSlugs = useMemo(() => new Set(["barrashoppingsul", "novo-hamburgo"]), []);

    useEffect(() => {
        const draft = readBookingDraft();
        if (!draft) {
            draftReadyRef.current = true;
            return;
        }
        if (draft.unitSlug && !allowedUnitSlugs.has(draft.unitSlug)) {
            clearBookingDraft();
            draftReadyRef.current = true;
            return;
        }
        draftToRestoreRef.current = draft;
        if (draft.unitSlug && allowedUnitSlugs.has(draft.unitSlug)) {
            setStoredUnitSlug(draft.unitSlug);
        }
    }, [allowedUnitSlugs]);

    // Allow deep-linking to a unit via `?unit=` by syncing it into storage (and therefore header selection).
    useEffect(() => {
        const fromQuery = (searchParams?.get("unit") ?? "").trim();
        if (!fromQuery) return;
        const resolved = findUnit(fromQuery);
        if (resolved?.slug && allowedUnitSlugs.has(resolved.slug)) setStoredUnitSlug(resolved.slug);
    }, [allowedUnitSlugs, searchParams]);

    const unitSlug = useMemo(() => {
        const slug = currentUnit?.slug ?? null;
        if (!slug) return null;
        return allowedUnitSlugs.has(slug) ? slug : null;
    }, [allowedUnitSlugs, currentUnit?.slug]);

    const primaryService = selectedServices[0] ?? null;
    const effectivePrimaryService = primaryService ?? OTHER_SERVICE;
    const effectiveServiceId = effectivePrimaryService.id;
    const selectedServiceIds = useMemo(() => selectedServices.map((item) => item.id), [selectedServices]);
    const selectedServiceNames = useMemo(() => selectedServices.map((item) => item.name), [selectedServices]);
    const selectedServicesLabel = useMemo(() => selectedServiceNames.join(", "), [selectedServiceNames]);
    const durationMinutes = 30;
    const effectiveDoctor = doctor ?? ANY_DOCTOR;
    const effectiveDoctorSlug = effectiveDoctor.slug;

    const lastUnitSlugRef = useRef<string | null>(null);
    const appliedDoctorQueryRef = useRef<string | null>(null);
    const appliedServiceQueryRef = useRef<string | null>(null);
    useEffect(() => {
        const prev = lastUnitSlugRef.current;
        if (prev === unitSlug) return;
        lastUnitSlugRef.current = unitSlug;
        appliedDoctorQueryRef.current = null;
        appliedServiceQueryRef.current = null;

        setDoctor(null);
        setSelectedServices([]);
        setDateKey(null);
        setDateTouched(false);
        setTimeKey(null);
        setStep("pick");
        setDetailsStage("contact");
        setDetailsStartedAtMs(null);
        setHoneypot("");
        setTurnstileToken(null);
        setTurnstileHadError(false);
        setSlots(null);
        setSlotsError(null);
        setDateAvailability({});
        setActiveInstagram(null);
        setPatientName("");
        setEmail("");
        setWhatsapp("");
        setCpf("");
        setAddress("");
        setNotes("");
    }, [unitSlug]);

    const unit = useMemo(() => findUnit(unitSlug), [unitSlug]);

    useEffect(() => {
        if (draftAppliedRef.current) return;
        const draft = draftToRestoreRef.current;
        if (!draft) return;
        if (draft.unitSlug && draft.unitSlug !== unitSlug) return;

        if (draft.doctorSlug && draft.doctorName) {
            setDoctor({ slug: draft.doctorSlug, name: draft.doctorName, handle: draft.doctorHandle });
        }

        const restoredServiceIds = draft.serviceIds?.length ? draft.serviceIds : draft.serviceId ? [draft.serviceId] : [];
        if (restoredServiceIds.length) {
            setSelectedServices(
                restoredServiceIds
                    .map((id) => (id === "any" ? OTHER_SERVICE : services.find((item) => item.id === id) ?? null))
                    .filter((item): item is Service => !!item),
            );
        }

        setDateKey(draft.dateKey);
        setDateTouched(Boolean(draft.dateKey));
        setTimeKey(draft.timeKey);
        setPatientName(draft.patientName);
        setEmail(draft.email);
        setWhatsapp(draft.whatsapp);
        setCpf(draft.cpf);
        setAddress(draft.address);
        setNotes(draft.notes);
        const canRestoreDetails = draft.step === "details" && restoredServiceIds.length > 0 && !!draft.dateKey && !!draft.timeKey;
        setStep(canRestoreDetails ? "details" : "pick");
        setDetailsStage(canRestoreDetails ? draft.detailsStage : "contact");
        if (canRestoreDetails) setDetailsStartedAtMs(Date.now());

        trackBookingFunnelStep({
            step: "draft_restored",
            restored: true,
            unitSlug: draft.unitSlug,
            doctorSlug: draft.doctorSlug,
            serviceId: draft.serviceId,
            date: draft.dateKey,
            time: draft.timeKey,
            detailsStage: draft.detailsStage,
        });

        draftAppliedRef.current = true;
        draftReadyRef.current = true;
    }, [unitSlug]);
    const unitLabel = useMemo(() => unitLabelFromSlug(unitSlug), [unitSlug]);
    const doctorsForUnit = useMemo(() => {
        if (!members) return null;
        if (!unitLabel) return [];

        return members
            .filter((m) => m.units.map((u) => u.toLowerCase()).includes(unitLabel.toLowerCase()))
            .map((m) => ({
                name: m.name,
                slug: doctorSlugFromTeamMember(m),
                handle: m.instagramHandle ?? extractInstagramHandle(m.instagramUrl),
                nickname: m.nickname,
                instagramUrl: m.instagramUrl,
            }));
    }, [members, unitLabel]);

    const doctorQuery = useMemo(() => normalizeDoctorSlug(searchParams?.get("doctor") ?? ""), [searchParams]);
    const serviceQuery = useMemo(() => normalizeDoctorSlug(searchParams?.get("service") ?? ""), [searchParams]);

    useEffect(() => {
        if (!unitSlug || !doctorsForUnit || doctorsForUnit.length === 0) return;
        if (!doctorQuery) return;
        if (appliedDoctorQueryRef.current === doctorQuery) return;

        if (doctorQuery === "any") {
            setDoctor(ANY_DOCTOR);
            appliedDoctorQueryRef.current = doctorQuery;
            return;
        }

        const match = doctorsForUnit.find((d) => {
            if (normalizeDoctorSlug(d.slug) === doctorQuery) return true;
            if (normalizeDoctorSlug(d.handle ?? "") === doctorQuery) return true;
            return normalizeDoctorSlug(d.name) === doctorQuery;
        });

        if (!match) return;
        setDoctor({ slug: match.slug, name: match.name, handle: match.handle });
        appliedDoctorQueryRef.current = doctorQuery;
    }, [doctorQuery, doctorsForUnit, unitSlug]);

    useEffect(() => {
        if (!unitSlug || !serviceQuery) return;
        if (appliedServiceQueryRef.current === serviceQuery) return;

        if (serviceQuery === "any") {
            setSelectedServices([OTHER_SERVICE]);
            appliedServiceQueryRef.current = serviceQuery;
            return;
        }

        const match = services.find((item) => {
            return normalizeDoctorSlug(item.id) === serviceQuery || normalizeDoctorSlug(item.name) === serviceQuery;
        });

        if (!match) return;
        setSelectedServices([match]);
        appliedServiceQueryRef.current = serviceQuery;
    }, [serviceQuery, unitSlug]);

    const upcomingWeeks = useMemo(() => {
        const out: string[][] = [];
        const base = startOfCurrentWeek(new Date());
        for (let weekIndex = 0; weekIndex < 8; weekIndex += 1) {
            const week: string[] = [];
            for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
                const d = new Date(base);
                d.setDate(base.getDate() + weekIndex * 7 + dayIndex);
                week.push(formatLocalDateKey(d));
            }
            out.push(week);
        }
        return out;
    }, []);
    const upcomingDays = useMemo(() => upcomingWeeks.flat(), [upcomingWeeks]);

    useEffect(() => {
        let cancelled = false;

        async function loadDateAvailability() {
            setDateAvailability({});
            const serviceId = effectiveServiceId;

            if (!unitSlug || durationMinutes <= 0 || !serviceId) return;

            const entries = await Promise.all(
                upcomingDays.map(async (day) => {
                    try {
                        if (isDateKeyBeforeToday(day)) return [day, false] as const;
                        const url = new URL("/api/booking/slots", window.location.origin);
                        url.searchParams.set("unit", unitSlug);
                        url.searchParams.set("doctor", effectiveDoctorSlug);
                        url.searchParams.set("service", serviceId);
                        url.searchParams.set("durationMinutes", String(durationMinutes));
                        url.searchParams.set("date", day);

                        const res = await fetch(url.toString(), { cache: "no-store" });
                        const json = (await res.json().catch(() => null)) as SlotsPayload | { ok: false; error: string } | null;

                        if (!res.ok || !json || !isOkResponse(json)) return [day, false] as const;
                        const payload = json as SlotsPayload;
                        return [day, payload.slots.some((slot) => slot.available)] as const;
                    } catch {
                        return [day, false] as const;
                    }
                }),
            );

            if (cancelled) return;
            const nextAvailability = Object.fromEntries(entries);
            setDateAvailability(nextAvailability);

        }

        void loadDateAvailability();
        return () => {
            cancelled = true;
        };
    }, [durationMinutes, effectiveDoctorSlug, effectiveServiceId, unitSlug, upcomingDays]);

    useEffect(() => {
        async function loadSlots() {
            setSlots(null);
            setSlotsError(null);
            setSlotsLoading(false);
            const serviceId = effectiveServiceId;

            if (!unitSlug || !dateKey || durationMinutes <= 0 || !serviceId) return;

            setSlotsLoading(true);
            try {
                const url = new URL("/api/booking/slots", window.location.origin);
                url.searchParams.set("unit", unitSlug);
                url.searchParams.set("doctor", effectiveDoctorSlug);
                url.searchParams.set("service", serviceId);
                url.searchParams.set("durationMinutes", String(durationMinutes));
                url.searchParams.set("date", dateKey);

                const res = await fetch(url.toString(), { cache: "no-store" });
                const json = (await res.json().catch(() => null)) as SlotsPayload | { ok: false; error: string } | null;

                if (!res.ok || !json || !isOkResponse(json)) {
                    const err = (json && !isOkResponse(json) && "error" in json && typeof json.error === "string" && json.error) || "Não foi possível carregar horários.";
                    if (err === "doctors_unavailable") {
                        setSlotsError("Equipe indisponível no momento. Tente novamente mais tarde.");
                    } else {
                        setSlotsError(err);
                    }
                    return;
                }

                setSlots(json as SlotsPayload);
            } catch {
                setSlotsError("Falha de rede ao carregar horários.");
            } finally {
                setSlotsLoading(false);
            }
        }

        loadSlots();
    }, [dateKey, durationMinutes, effectiveDoctorSlug, effectiveServiceId, unitSlug]);

    async function submit() {
        setSubmitError(null);

        if (!unitSlug) {
            setSubmitError("Selecione a unidade no topo para agendar.");
            return;
        }
        if (!primaryService || !dateKey || !timeKey) {
            setSubmitError("Selecione procedimento, data e horário.");
            return;
        }
        if (durationMinutes <= 0) {
            setSubmitError("Selecione ao menos um tipo de atendimento (tempo).");
            return;
        }
        if (!patientName.trim()) {
            setSubmitError("Informe seu nome.");
            return;
        }
        if (!emailValue || !emailSeemsValid) {
            setSubmitError("Informe um e-mail válido.");
            return;
        }
        if (!whatsapp.trim()) {
            setSubmitError("Informe seu WhatsApp.");
            return;
        }
        if (!cpfDigits || !cpfSeemsValid) {
            setSubmitError("Informe um CPF válido.");
            return;
        }
        if (!address.trim()) {
            setSubmitError("Informe seu endereço completo.");
            return;
        }
        if (turnstileSiteKey && !turnstileToken) {
            setSubmitError("Confirme que você não é um robô.");
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch("/api/booking/request", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    unitSlug,
                    doctorSlug: effectiveDoctor.slug,
                    doctorName: effectiveDoctor.name,
                    serviceId: primaryService.id,
                    selectedServiceIds,
                    durationMinutes,
                    includes: {
                        avaliacao: true,
                        procedimento: false,
                        revisao: false,
                    },
                    date: dateKey,
                    time: timeKey,
                    patientName,
                    email: emailValue,
                    whatsapp,
                    cpf: cpfDigits,
                    address: address.trim(),
                    notes,
                    hp: honeypot,
                    formStartedAtMs: detailsStartedAtMs,
                    turnstileToken,
                }),
            });

            const json = (await res.json().catch(() => null)) as RequestResponse | null;

            if (!json || json.ok !== true) {
                const err = (json && "error" in json && json.error) || "Não foi possível enviar seu pedido.";
                if (err === "slot_in_review") {
                    setSubmitError("Esse horário acabou de entrar em análise. Escolha outro horário.");
                    return;
                }
                if (err === "no_availability") {
                    setSubmitError("Esse horário não está mais disponível. Escolha outro horário.");
                    return;
                }
                if (err === "no_doctors_for_unit") {
                    setSubmitError("Não foi possível selecionar um profissional para esta unidade. Tente escolher um profissional específico.");
                    return;
                }
                if (err === "doctors_unavailable") {
                    setSubmitError("Equipe indisponível no momento. Tente novamente mais tarde.");
                    return;
                }
                if (err === "rate_limited") {
                    setSubmitError("Muitas tentativas em sequência. Aguarde alguns segundos e tente novamente.");
                    return;
                }
                if (err === "too_fast") {
                    setSubmitError("Muito rápido. Aguarde um instante e tente novamente.");
                    return;
                }
                if (err === "spam_detected") {
                    setSubmitError("Não foi possível enviar. Recarregue a página e tente novamente.");
                    return;
                }
                if (err === "invalid_email") {
                    setSubmitError("Informe um e-mail válido.");
                    return;
                }
                if (err === "invalid_cpf") {
                    setSubmitError("Informe um CPF válido.");
                    return;
                }
                if (err === "missing_address") {
                    setSubmitError("Informe seu endereço completo.");
                    return;
                }
                if (err === "turnstile_failed") {
                    setSubmitError("Falha na verificação anti-robô. Recarregue a página e tente novamente.");
                    return;
                }
                setSubmitError("Não foi possível enviar seu pedido. Tente novamente.");
                return;
            }

            setSubmitted({ id: json.id, status: json.status, confirmByMs: json.confirmByMs, notifications: json.notifications });
            trackBookingRequestSubmitted({
                bookingId: json.id,
                unitSlug,
                doctorSlug: effectiveDoctor.slug,
                serviceId: primaryService.id,
                durationMinutes,
                date: dateKey,
                time: timeKey,
            });
            clearBookingDraft();
            setStep("submitted");
        } catch {
            setSubmitError("Falha de rede ao enviar.");
        } finally {
            setSubmitting(false);
        }
    }

    // Poll status after submit
    useEffect(() => {
        if (!submitted) return;
        const bookingId = submitted.id;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        async function tick() {
            try {
                const res = await fetch(`/api/booking/status?id=${encodeURIComponent(bookingId)}`, { cache: "no-store" });
                const json = (await res.json().catch(() => null)) as StatusResponse | null;
                if (cancelled) return;
                if (res.ok && json && isOkResponse(json)) {
                    setStatus((json as { ok: true; booking: BookingStatus }).booking);
                }
            } catch {
                // ignore
            } finally {
                if (!cancelled) timer = setTimeout(tick, 25_000);
            }
        }

        tick();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [submitted]);

    const canPickProcedure = !!unitSlug;
    const canPick = !!unitSlug;
    const hasResolvedDateAvailability = upcomingDays.every((day) => typeof dateAvailability[day] === "boolean");
    const visibleUpcomingWeeks = useMemo(() => {
        if (!canPick || !hasResolvedDateAvailability) return upcomingWeeks.slice(0, 4);
        const weeksWithAvailability = upcomingWeeks.filter((week) => week.some((day) => dateAvailability[day]));
        return (weeksWithAvailability.length > 0 ? weeksWithAvailability : upcomingWeeks).slice(0, 4);
    }, [canPick, dateAvailability, hasResolvedDateAvailability, upcomingWeeks]);
    const visibleUpcomingDays = useMemo(() => visibleUpcomingWeeks.flat(), [visibleUpcomingWeeks]);

    useEffect(() => {
        if (!dateKey) return;
        if (!hasResolvedDateAvailability) return;
        if (dateAvailability[dateKey] !== false) return;
        setDateKey(null);
        setTimeKey(null);
        setStep("pick");
    }, [dateAvailability, dateKey, hasResolvedDateAvailability]);

    // Auto-select the first available date once the required selections are ready.
    useEffect(() => {
        if (!canPick) return;
        if (dateKey) return;
        if (dateTouched) return;
        if (!visibleUpcomingDays.length) return;
        if (!hasResolvedDateAvailability) return;
        const firstAvailableDate = visibleUpcomingDays.find((day) => dateAvailability[day]);
        setDateKey(firstAvailableDate ?? null);
    }, [canPick, dateAvailability, dateKey, dateTouched, hasResolvedDateAvailability, visibleUpcomingDays]);

    const selectedSlot = useMemo(() => {
        if (!slots?.slots || !timeKey) return null;
        return slots.slots.find((s) => s.time === timeKey) ?? null;
    }, [slots?.slots, timeKey]);

    function ensureDefaultSelections() {
        if (!doctor) setDoctor(ANY_DOCTOR);
        if (selectedServices.length === 0) setSelectedServices([OTHER_SERVICE]);
    }

    function openDetailsModal(nextTime: string) {
        ensureDefaultSelections();
        setTimeKey(nextTime);
        setStep("details");
        setDetailsStage("contact");
        setDetailsStartedAtMs(Date.now());
        setTurnstileToken(null);
        setTurnstileHadError(false);
        setSubmitError(null);
        trackBookingFunnelStep({
            step: "details_opened",
            unitSlug,
            doctorSlug: effectiveDoctorSlug,
            serviceId: effectiveServiceId,
            date: dateKey,
            time: nextTime,
            detailsStage: "contact",
        });
    }

    const showSensitiveHint = true;
    const emailValue = email.trim().toLowerCase();
    const emailSeemsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue);
    const whatsappDigits = whatsapp.replace(/\D/g, "");
    const whatsappSeemsValid = whatsappDigits.length >= 10;
    const cpfDigits = cpf.replace(/\D/g, "");
    const cpfSeemsValid = cpfDigits.length === 11;
    const addressSeemsValid = address.trim().length >= 6;
    const turnstileRequired = !!turnstileSiteKey;
    const canAdvanceIdentity =
        !!selectedSlot &&
        !!patientName.trim() &&
        emailSeemsValid &&
        whatsappSeemsValid;
    const canSubmit =
        !!selectedSlot &&
        !!patientName.trim() &&
        emailSeemsValid &&
        whatsappSeemsValid &&
        cpfSeemsValid &&
        addressSeemsValid &&
        (!turnstileRequired || !!turnstileToken);

    const showDetailsModal = step === "details" && !!unitSlug && !!primaryService && !!dateKey && !!timeKey;

    useEffect(() => {
        if (!showDetailsModal) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = previous;
        };
    }, [showDetailsModal]);

    useEffect(() => {
        if (!showDetailsModal) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setStep("pick");
                setDetailsStage("contact");
                setSubmitError(null);
                setTurnstileToken(null);
                setTurnstileHadError(false);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [showDetailsModal]);

    function selectDoctor(nextDoctor: DoctorSelection | null) {
        const nextSelection = doctor?.slug === nextDoctor?.slug ? null : nextDoctor;
        if (!doctor && !nextSelection) return;
        setDoctor(nextSelection);
        setDateKey(null);
        setDateTouched(false);
        setTimeKey(null);
        setStep("pick");
    }

    function toggleProcedure(nextService: Service) {
        setSelectedServices((current) => {
            const exists = current.some((item) => item.id === nextService.id);
            if (nextService.id === OTHER_SERVICE.id) {
                return exists ? [] : [OTHER_SERVICE];
            }

            const withoutOther = current.filter((item) => item.id !== OTHER_SERVICE.id);
            if (exists) return withoutOther.filter((item) => item.id !== nextService.id);
            return [...withoutOther, nextService];
        });
        setDateKey(null);
        setDateTouched(false);
        setTimeKey(null);
        setStep("pick");
    }

    function openDoctorInstagram(params: { name: string; handle: string | null; instagramUrl: string | null }) {
        const handle = params.handle?.replace(/^@/, "") ?? null;
        if (!handle) return;
        setActiveInstagram({ name: params.name, handle });
        trackDoctorInstagramClick({
            unitSlug,
            doctorName: params.name,
            instagramUrl: params.instagramUrl ?? `https://www.instagram.com/${handle}/`,
        });
    }

    useEffect(() => {
        if (!draftReadyRef.current) return;
        if (step === "submitted") {
            clearBookingDraft();
            return;
        }

        const hasData = Boolean(
            unitSlug ||
                doctor?.slug ||
                selectedServiceIds.length > 0 ||
                dateKey ||
                timeKey ||
                patientName.trim() ||
                email.trim() ||
                whatsapp.trim() ||
                cpf.trim() ||
                address.trim() ||
                notes.trim(),
        );

        if (!hasData) {
            clearBookingDraft();
            return;
        }

        persistBookingDraft({
            unitSlug,
            doctorSlug: doctor?.slug ?? null,
            doctorName: doctor?.name ?? null,
            doctorHandle: doctor?.handle ?? null,
            serviceId: primaryService?.id ?? null,
            serviceIds: selectedServiceIds,
            includeAvaliacao: true,
            includeProcedimento: false,
            includeRevisao: false,
            dateKey,
            timeKey,
            step: step === "details" ? "details" : "pick",
            detailsStage,
            patientName,
            email,
            whatsapp,
            cpf,
            address,
            notes,
        });
    }, [
        address,
        cpf,
        dateKey,
        detailsStage,
        doctor?.handle,
        doctor?.name,
        doctor?.slug,
        email,
        notes,
        patientName,
        primaryService?.id,
        selectedServiceIds,
        step,
        timeKey,
        unitSlug,
        whatsapp,
    ]);

    return (
        <div className="bookingFlow">
            {step !== "submitted" ? (
                <div className="bookingFlow__grid">
                    {!unitSlug ? (
                        <div className="card bookingFlow__cardEntryUnit" style={{ padding: 16 }}>
                            <div className="bookingFlow__entryTitle">Escolha a unidade</div>
                            <div className="bookingFlow__cardSub">A unidade libera a equipe, o procedimento e os horários reais.</div>
                            <div className="bookingFlow__embeddedUnitChooser">
                                <UnitChooser />
                            </div>
                        </div>
                    ) : null}

                    <div
                        className={`card bookingFlow__cardDoctor ${unitSlug ? "bookingFlow__cardDoctor--half" : "bookingFlow__cardDoctor--withUnit"}`.trim()}
                        style={{ padding: 14 }}
                    >
                        <div className="bookingFlow__entryTitle">Escolha o seu doutor</div>
                        {unit ? (
                            <div className="small bookingFlow__unitStatus">
                                Unidade: <span className="bookingFlow__unitName">{unit.name}</span>
                            </div>
                        ) : null}
                        <div className="bookingFlow__cardSub">Clique e selecione um de nossos doutores para o seu atendimento.</div>
                        <div style={{ marginTop: 6 }}>
                            {!unitLabel ? (
                                <div className="small bookingFlow__unitStatus bookingFlow__unitStatus--error" role="status">
                                    Selecione a unidade para liberar os doutores.
                                </div>
                            ) : doctorsForUnit === null || membersLoading ? (
                                <div className="bookingFlow__doctorLoading" aria-hidden="true">
                                    <span className="bookingFlow__doctorLoadingAvatar" />
                                    <span className="bookingFlow__doctorLoadingLine bookingFlow__doctorLoadingLine--title" />
                                    <span className="bookingFlow__doctorLoadingLine" />
                                </div>
                            ) : doctorsForUnit.length === 0 ? (
                                <div className="small">
                                    {membersError ? "Equipe indisponível no momento. Tente novamente mais tarde." : "Nenhum doutor encontrado para esta unidade."}
                                </div>
                            ) : (
                                <HoverScrollPicker
                                    ariaLabel="Lista de profissionais"
                                    className="bookingFlow__picker--bleed bookingFlow__picker--rail bookingFlow__picker--doctor"
                                    scrollWindowClassName="bookingFlow__scrollWindow--doctor"
                                >
                                    <div className="bookingFlow__doctorBadgeGrid">
                                        {doctorsForUnit.map((d) => {
                                            const active = doctor?.slug === d.slug;
                                            const instagramHref = d.instagramUrl ?? (d.handle ? `https://instagram.com/${d.handle.replace(/^@/, "")}` : null);
                                            return (
                                                <div key={d.slug} className="bookingFlow__doctorBadgeWrap" data-active={active ? "true" : "false"} role="listitem">
                                                    <button
                                                        type="button"
                                                        className="bookingFlow__doctorBadge"
                                                        data-active={active ? "true" : "false"}
                                                        onClick={() => selectDoctor({ slug: d.slug, name: d.name, handle: d.handle })}
                                                        aria-label={active ? `Remover seleção de ${d.name}` : `Selecionar ${d.name}`}
                                                        aria-pressed={active}
                                                    >
                                                        <span className="bookingFlow__doctorBadgeAvatar">
                                                            {d.handle ? (
                                                                <Image
                                                                    src={avatarUrl(d.handle, d.nickname ?? d.name)}
                                                                    alt={d.nickname ?? d.name}
                                                                    fill
                                                                    sizes="76px"
                                                                    style={{ objectFit: "cover" }}
                                                                    unoptimized
                                                                />
                                                            ) : (
                                                                <span className="bookingFlow__doctorBadgeFallback">{initialsFromName(d.nickname ?? d.name)}</span>
                                                            )}
                                                        </span>
                                                    </button>
                                                    <div className="bookingFlow__doctorTooltip" role="tooltip">
                                                        <div className="bookingFlow__doctorTooltipHeader">
                                                            <div className="bookingFlow__doctorTooltipName">{d.name}</div>
                                                            {instagramHref ? (
                                                                <button
                                                                    type="button"
                                                                    className="bookingFlow__doctorTooltipLink"
                                                                    aria-label={`Abrir Instagram de ${d.name}`}
                                                                    title="Abrir Instagram"
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        openDoctorInstagram({
                                                                            name: d.name,
                                                                            handle: d.handle,
                                                                            instagramUrl: instagramHref,
                                                                        });
                                                                    }}
                                                                >
                                                                    <InstagramIcon size={14} />
                                                                </button>
                                                            ) : null}
                                                        </div>
                                                        <div className="bookingFlow__doctorTooltipSub">{d.nickname || unitLabel}</div>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        <div className="bookingFlow__doctorBadgeWrap" data-active={doctor?.slug === ANY_DOCTOR.slug ? "true" : "false"} role="listitem">
                                            <button
                                                type="button"
                                                className="bookingFlow__doctorBadge bookingFlow__doctorBadge--all"
                                                data-active={doctor?.slug === ANY_DOCTOR.slug ? "true" : "false"}
                                                onClick={() => selectDoctor(ANY_DOCTOR)}
                                                aria-label={doctor?.slug === ANY_DOCTOR.slug ? "Remover seleção de sem preferência" : "Selecionar sem preferência de doutor"}
                                                aria-pressed={doctor?.slug === ANY_DOCTOR.slug}
                                            >
                                                <span className="bookingFlow__doctorBadgeAvatar bookingFlow__doctorBadgeAvatar--all">
                                                    <span className="bookingFlow__doctorBadgeFallback bookingFlow__doctorBadgeFallback--all">
                                                        <span>Sem</span>
                                                        <span>Preferência</span>
                                                    </span>
                                                </span>
                                            </button>
                                            <div className="bookingFlow__doctorTooltip" role="tooltip">
                                                <div className="bookingFlow__doctorTooltipName">Sem Preferência</div>
                                                <div className="bookingFlow__doctorTooltipSub">Mostra a agenda mais ampla da unidade.</div>
                                            </div>
                                        </div>
                                    </div>
                                </HoverScrollPicker>
                            )}
                        </div>
                    </div>

                    <div className={`card bookingFlow__cardProcedure ${unitSlug ? "bookingFlow__cardProcedure--half" : "bookingFlow__cardProcedure--full"} ${canPickProcedure ? "" : "bookingFlow__card--locked"}`.trim()} style={{ padding: 14 }}>
                        <div className="bookingFlow__entryTitle">Escolha os procedimentos</div>
                        <div className="bookingFlow__cardSub">Selecione um ou mais procedimentos para o seu atendimento.</div>
                        {!canPickProcedure ? (
                            <div className="bookingFlow__lockOverlay" aria-hidden="true">
                                <div className="bookingFlow__lockText">Selecione a unidade no topo para continuar.</div>
                            </div>
                        ) : null}
                        <HoverScrollPicker ariaLabel="Lista de procedimentos" className="bookingFlow__picker--bleed bookingFlow__picker--rail">
                            <div className="bookingFlow__procedureBadgeGrid">
                                {services.map((s) => {
                                    const active = selectedServices.some((item) => item.id === s.id);
                                    return (
                                        <button
                                            key={s.id}
                                            type="button"
                                            role="listitem"
                                            disabled={!canPickProcedure}
                                            className={`bookingFlow__procedureBadge${s.subtitle ? " bookingFlow__tooltipTrigger bookingFlow__procedureBadge--hasTooltip" : ""}`}
                                            data-active={active ? "true" : "false"}
                                            data-tooltip={s.subtitle ?? undefined}
                                            onClick={() => toggleProcedure(s)}
                                        >
                                            <span className="bookingFlow__procedureBadgeAvatar">
                                                {s.highlightImage ? (
                                                    <Image
                                                        src={s.highlightImage}
                                                        alt=""
                                                        fill
                                                        sizes="76px"
                                                        style={{ objectFit: "cover" }}
                                                        unoptimized
                                                        aria-hidden="true"
                                                    />
                                                ) : (
                                                    <span className="bookingFlow__procedureBadgeFallback">EF</span>
                                                )}
                                            </span>
                                            <span className="bookingFlow__procedureBadgeLabel">{s.name}</span>
                                        </button>
                                    );
                                })}

                                <button
                                    type="button"
                                    role="listitem"
                                    disabled={!canPickProcedure}
                                    className="bookingFlow__procedureBadge bookingFlow__tooltipTrigger bookingFlow__procedureBadge--hasTooltip"
                                    data-active={selectedServices.some((item) => item.id === OTHER_SERVICE.id) ? "true" : "false"}
                                    data-tooltip="Outro procedimento ou combinação"
                                    onClick={() => toggleProcedure(OTHER_SERVICE)}
                                >
                                    <span className="bookingFlow__procedureBadgeAvatar bookingFlow__procedureBadgeAvatar--all">
                                        <span className="bookingFlow__procedureBadgeFallback bookingFlow__procedureBadgeFallback--all">Outro</span>
                                    </span>
                                    <span className="bookingFlow__procedureBadgeLabel">Outro</span>
                                </button>
                            </div>
                        </HoverScrollPicker>
                    </div>

                    <div className={`card bookingFlow__cardFull bookingFlow__cardDateTime ${canPick ? "" : "bookingFlow__card--locked"}`.trim()} style={{ padding: 14 }}>
                        <div className="bookingFlow__cardHeader">
                            <div>
                                <div className="bookingFlow__entryTitle">Data e horário</div>
                                <div className="bookingFlow__cardSub">Selecione uma data e verifique os horários disponíveis.</div>
                            </div>
                            <div className="bookingFlow__legend" aria-hidden="true">
                                <div className="bookingFlow__legendItem">
                                    <span className="bookingFlow__legendSwatch bookingFlow__legendSwatch--past" />
                                    Passou
                                </div>
                                <div className="bookingFlow__legendItem">
                                    <span className="bookingFlow__legendSwatch bookingFlow__legendSwatch--occupied" />
                                    Ocupado
                                </div>
                            </div>
                        </div>
                        {!canPick ? (
                            <div className="bookingFlow__lockOverlay" aria-hidden="true">
                                <div className="bookingFlow__lockText">
                                    Selecione a unidade no topo para ver horários.
                                </div>
                            </div>
                        ) : null}

                        <div className="bookingFlow__datetimeGrid" style={{ marginTop: 12 }}>
                            <div>
                                <div className="small" style={{ fontWeight: 800, marginBottom: 8 }}>
                                    Datas
                                </div>
                                <div className="bookingFlow__dateWeeks">
                                    {visibleUpcomingWeeks.map((week) => (
                                        <div key={week[0]} className="bookingFlow__dateWeekRow">
                                            {week.map((d) => {
                                                const active = dateKey === d;
                                                const unavailable = canPick && hasResolvedDateAvailability && dateAvailability[d] === false;
                                                return (
                                                    <button
                                                        key={d}
                                                        type="button"
                                                        disabled={!canPick || unavailable}
                                                        className="bookingFlow__selectItem bookingFlow__dateBtn"
                                                        data-active={active ? "true" : "false"}
                                                        data-unavailable={unavailable ? "true" : "false"}
                                                        onClick={() => {
                                                            ensureDefaultSelections();
                                                            setDateTouched(true);
                                                            if (active) {
                                                                setDateKey(null);
                                                                setTimeKey(null);
                                                                setStep("pick");
                                                                return;
                                                            }

                                                            setDateKey(d);
                                                            setTimeKey(null);
                                                            setStep("pick");
                                                        }}
                                                        style={{
                                                            opacity: canPick ? 1 : 0.5,
                                                            fontWeight: 900,
                                                            borderRadius: 12,
                                                            padding: "10px 8px",
                                                            textAlign: "center",
                                                            display: "grid",
                                                            gap: 2,
                                                        }}
                                                    >
                                                        <div style={{ fontSize: 11, fontWeight: 800, opacity: active ? 0.9 : 0.75 }}>
                                                            {weekdayPtBrShort(d)}
                                                        </div>
                                                        <div style={{ fontSize: 14, fontWeight: 950, letterSpacing: "-0.2px" }}>
                                                            {parseLocalDateKey(d)?.getDate()}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                                {!canPick ? (
                                    <div className="small" style={{ marginTop: 10 }}>
                                        Selecione a unidade no topo para liberar as datas.
                                    </div>
                                ) : null}
                            </div>

                            <div>
                                <div className="small" style={{ fontWeight: 800, marginBottom: 8 }}>
                                    Horários
                                </div>
                                <div style={{ minHeight: 44 }}>
                                    {!dateKey ? (
                                        <div className="small">Escolha uma data para ver horários.</div>
                                    ) : slotsLoading ? (
                                        <div className="small">Carregando horários…</div>
                                    ) : slotsError ? (
                                        <div className="small">{slotsError}</div>
                                    ) : slots ? (
                                        <div className="bookingFlow__timeGrid">
                                            {slots.slots.map((s) => {
                                                const active = timeKey === s.time;
                                                const isPast = s.reason === "past";
                                                const isAgenda = s.reason === "agenda";
                                                const hasTooltip = isPast || isAgenda;
                                                const tooltip = isPast ? "horário já passou" : isAgenda ? "horário ocupado" : "";
                                                const ariaDisabled = !s.available;
                                                const nativeDisabled = !s.available && !hasTooltip;
                                                const label =
                                                    isPast || isAgenda
                                                        ? ""
                                                        : s.reason === "booked"
                                                            ? "Indisponível"
                                                            : s.reason === "in_review"
                                                                ? "Em análise"
                                                                : "";

                                                return (
                                                    <button
                                                        key={s.time}
                                                        type="button"
                                                        disabled={nativeDisabled}
                                                        aria-disabled={ariaDisabled ? "true" : "false"}
                                                        data-reason={s.reason ?? ""}
                                                        data-locked={hasTooltip ? "true" : "false"}
                                                        data-tooltip={hasTooltip ? tooltip : undefined}
                                                        className="bookingFlow__selectItem bookingFlow__timeBtn"
                                                        data-active={active ? "true" : "false"}
                                                        onClick={() => {
                                                            if (ariaDisabled) return;
                                                            if (active) {
                                                                if (step !== "details") {
                                                                    openDetailsModal(s.time);
                                                                    return;
                                                                }
                                                                setTimeKey(null);
                                                                setStep("pick");
                                                                setDetailsStage("contact");
                                                                setDetailsStartedAtMs(null);
                                                                setTurnstileToken(null);
                                                                setTurnstileHadError(false);
                                                                setSubmitError(null);
                                                                return;
                                                            }
                                                            openDetailsModal(s.time);
                                                        }}
                                                        tabIndex={ariaDisabled ? -1 : 0}
                                                        style={{
                                                            padding: "10px 8px",
                                                            borderRadius: 12,
                                                            fontWeight: 900,
                                                            textAlign: "center",
                                                        }}
                                                    >
                                                        <div className="bookingFlow__timeBtnText">{s.time}</div>
                                                        {label ? <div className="bookingFlow__timeBtnSub">{label}</div> : null}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="small">Selecione uma data para ver os horários disponíveis.</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            ) : (
                <div className="bookingFlow__grid">
                    <div className="card bookingFlow__cardFull" style={{ padding: 18 }}>
                        <div style={{ fontWeight: 900, fontSize: 18 }}>
                            {submitted?.status === "confirmed" ? "Reserva confirmada" : "Pedido enviado"}
                        </div>
                        {submitted ? (
                            <>
                                <div className="small" style={{ marginTop: 8 }}>
                                    Protocolo: <span style={{ fontWeight: 900 }}>{submitted.id}</span>
                                </div>
                                <div style={{ marginTop: 10 }}>
                                    {submitted.status === "confirmed"
                                        ? "Enviamos a confirmação para seu e-mail e WhatsApp."
                                        : `Seu pedido entrou na fila. Prazo: ${formatDeadline(submitted.confirmByMs)}.`}
                                </div>
                                {submitted.notifications && submitted.status === "confirmed" ? (
                                    <div className="small" style={{ marginTop: 6 }}>
                                        E-mail: {submitted.notifications.email.status} · WhatsApp: {submitted.notifications.whatsapp.status}
                                    </div>
                                ) : null}
                            </>
                        ) : null}

                        {status ? (
                            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                                <div style={{ fontWeight: 900 }}>Status</div>
                                <div style={{ marginTop: 6 }}>
                                    {status.status === "confirmed" ? (
                                        <span style={{ fontWeight: 900, color: "#16a34a" }}>Confirmado</span>
                                    ) : status.status === "declined" ? (
                                        <span style={{ fontWeight: 900, color: "#b91c1c" }}>Não confirmado</span>
                                    ) : status.status === "expired" ? (
                                        <span style={{ fontWeight: 900, color: "#b45309" }}>Expirado</span>
                                    ) : status.status === "needs_approval" ? (
                                        <span style={{ fontWeight: 900, color: "#b45309" }}>Em análise</span>
                                    ) : (
                                        <span style={{ fontWeight: 900 }}>Pendente</span>
                                    )}
                                </div>
                                <div className="small" style={{ marginTop: 6 }}>
                                    Atualiza automaticamente.
                                </div>
                            </div>
                        ) : null}

                        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <button
                                type="button"
                                className="pill"
                                onClick={() => {
                                    // restart
                                    setStep("pick");
                                    setDoctor(null);
                                    setSelectedServices([]);
                                    setDateKey(null);
                                    setDateTouched(false);
                                    setTimeKey(null);
                                    setPatientName("");
                                    setEmail("");
                                    setWhatsapp("");
                                    setCpf("");
                                    setAddress("");
                                    setNotes("");
                                    setSlots(null);
                                    setSubmitted(null);
                                    setStatus(null);
                                    setSubmitError(null);
                                    setDetailsStage("contact");
                                    clearBookingDraft();
                                }}
                                style={{ cursor: "pointer" }}
                            >
                                Fazer outro pedido
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <DoctorInstagramModal profile={activeInstagram} onClose={() => setActiveInstagram(null)} />

            {showDetailsModal && unitSlug && primaryService && dateKey && timeKey ? (
                <div
                    className="bookingFlow__modalBackdrop"
                    role="dialog"
                    aria-modal="true"
                    onClick={(event) => {
                        if (event.target !== event.currentTarget) return;
                        setStep("pick");
                        setDetailsStage("contact");
                        setSubmitError(null);
                        setTurnstileToken(null);
                        setTurnstileHadError(false);
                    }}
                >
                    <div className="bookingFlow__modalCard">
                        <div className="bookingFlow__modalHeader">
                            <div>
                                <div style={{ fontWeight: 900 }}>Finalizar agendamento</div>
                                <div className="small" style={{ marginTop: 4 }}>
                                    {selectedServicesLabel} ({durationMinutes} min) · {formatDatePtBr(dateKey)} às {timeKey}
                                </div>
                            </div>
                            <button
                                type="button"
                                className="bookingFlow__modalClose"
                                aria-label="Fechar"
                                onClick={() => {
                                    setStep("pick");
                                    setDetailsStage("contact");
                                    setSubmitError(null);
                                    setTurnstileToken(null);
                                    setTurnstileHadError(false);
                                }}
                            >
                                ×
                            </button>
                        </div>

                        <div className="bookingFlow__modalBody">
                            <div
                                aria-hidden="true"
                                style={{
                                    position: "absolute",
                                    left: "-10000px",
                                    top: "auto",
                                    width: 1,
                                    height: 1,
                                    overflow: "hidden",
                                }}
                            >
                                <label>
                                    Empresa
                                    <input
                                        value={honeypot}
                                        onChange={(e) => setHoneypot(e.target.value)}
                                        tabIndex={-1}
                                        autoComplete="off"
                                        inputMode="text"
                                    />
                                </label>
                            </div>

                            <div className="bookingFlow__modalHint">
                                Etapa {detailsStage === "contact" ? "1 de 2" : "2 de 2"} · o fluxo salva automaticamente para continuar depois.
                            </div>

                            <div className="bookingFlow__stageRow" role="list" aria-label="Etapas de confirmação">
                                <div className="bookingFlow__stagePill" role="listitem" data-state={detailsStage === "contact" ? "active" : "done"}>
                                    1. Contato
                                </div>
                                <div className="bookingFlow__stagePill" role="listitem" data-state={detailsStage === "identity" ? "active" : "pending"}>
                                    2. Dados de confirmação
                                </div>
                            </div>

                            {detailsStage === "contact" ? (
                                <>
                                    <div className="bookingFlow__formGrid">
                                        <label className="bookingFlow__field">
                                            <span>Nome</span>
                                            <input
                                                value={patientName}
                                                onChange={(e) => setPatientName(e.target.value)}
                                                placeholder="Seu nome"
                                                autoComplete="name"
                                                className="bookingFlow__input"
                                            />
                                        </label>

                                        <label className="bookingFlow__field">
                                            <span>E-mail</span>
                                            <input
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                placeholder="voce@email.com"
                                                autoComplete="email"
                                                inputMode="email"
                                                className="bookingFlow__input"
                                                aria-invalid={email.length > 0 && !emailSeemsValid}
                                            />
                                        </label>
                                    </div>
                                    {email.length > 0 && !emailSeemsValid ? (
                                        <div className="bookingFlow__fieldError">Informe um e-mail válido.</div>
                                    ) : null}

                                    <label className="bookingFlow__field">
                                        <span>WhatsApp</span>
                                        <input
                                            value={whatsapp}
                                            onChange={(e) => setWhatsapp(formatBrPhone(e.target.value))}
                                            placeholder="(DDD) 9xxxx-xxxx"
                                            inputMode="tel"
                                            autoComplete="tel"
                                            aria-invalid={whatsapp.length > 0 && !whatsappSeemsValid}
                                            className="bookingFlow__input"
                                        />
                                    </label>
                                    {!whatsappSeemsValid && whatsapp.length > 0 ? (
                                        <div className="bookingFlow__fieldError">Informe DDD + número (ex.: (51) 99999-9999).</div>
                                    ) : null}

                                    <div className="bookingFlow__modalActions">
                                        <button
                                            type="button"
                                            className="bookingFlow__primaryBtn"
                                            disabled={!canAdvanceIdentity}
                                            onClick={() => {
                                                setDetailsStage("identity");
                                                setSubmitError(null);
                                                trackBookingFunnelStep({
                                                    step: "identity_opened",
                                                    unitSlug,
                                                    doctorSlug: effectiveDoctorSlug,
                                                    serviceId: primaryService.id,
                                                    date: dateKey,
                                                    time: timeKey,
                                                    detailsStage: "identity",
                                                });
                                            }}
                                        >
                                            Continuar para confirmação
                                        </button>
                                        <button
                                            type="button"
                                            className="bookingFlow__ghostBtn"
                                            onClick={() => {
                                                setStep("pick");
                                                setDetailsStage("contact");
                                                setSubmitError(null);
                                                setTurnstileToken(null);
                                                setTurnstileHadError(false);
                                            }}
                                        >
                                            Voltar para agenda
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="bookingFlow__formGrid">
                                        <label className="bookingFlow__field">
                                            <span>CPF</span>
                                            <input
                                                value={cpf}
                                                onChange={(e) => setCpf(formatCpf(e.target.value))}
                                                placeholder="000.000.000-00"
                                                inputMode="numeric"
                                                autoComplete="off"
                                                aria-invalid={cpf.length > 0 && !cpfSeemsValid}
                                                className="bookingFlow__input"
                                            />
                                        </label>

                                        <label className="bookingFlow__field">
                                            <span>Endereço completo</span>
                                            <textarea
                                                value={address}
                                                onChange={(e) => setAddress(e.target.value)}
                                                placeholder="Rua, número, bairro, cidade e CEP"
                                                rows={2}
                                                className="bookingFlow__textarea"
                                            />
                                        </label>
                                    </div>
                                    {!cpfSeemsValid && cpf.length > 0 ? (
                                        <div className="bookingFlow__fieldError">Informe um CPF válido.</div>
                                    ) : null}
                                    {!addressSeemsValid && address.length > 0 ? (
                                        <div className="bookingFlow__fieldError">Informe o endereço completo.</div>
                                    ) : null}

                                    {turnstileRequired ? (
                                        <div style={{ display: "grid", gap: 8 }}>
                                            <TurnstileWidget
                                                siteKey={turnstileSiteKey}
                                                onToken={setTurnstileToken}
                                                onError={() => setTurnstileHadError(true)}
                                            />
                                            {!turnstileToken ? (
                                                <div className="small" style={{ color: turnstileHadError ? "#b91c1c" : "var(--muted)" }}>
                                                    {turnstileHadError ? "Não foi possível carregar a verificação anti-robô." : "Confirme que você não é um robô para enviar."}
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : null}

                                    <label className="bookingFlow__field">
                                        <span>Observações (opcional)</span>
                                        <textarea
                                            value={notes}
                                            onChange={(e) => setNotes(e.target.value)}
                                            placeholder={showSensitiveHint ? "Opcional. Evite informações sensíveis; use apenas preferências (ex.: melhor horário)." : "Opcional"}
                                            rows={3}
                                            className="bookingFlow__textarea"
                                        />
                                    </label>

                                    <div className="bookingFlow__modalActions">
                                        <button
                                            type="button"
                                            onClick={submit}
                                            disabled={submitting || !canSubmit}
                                            className="bookingFlow__primaryBtn"
                                        >
                                            {submitting ? "Confirmando…" : "Confirmar reserva"}
                                        </button>
                                        <button
                                            type="button"
                                            className="bookingFlow__ghostBtn"
                                            onClick={() => {
                                                setDetailsStage("contact");
                                                setSubmitError(null);
                                                setTurnstileToken(null);
                                                setTurnstileHadError(false);
                                                trackBookingFunnelStep({
                                                    step: "contact_reopened",
                                                    unitSlug,
                                                    doctorSlug: effectiveDoctorSlug,
                                                    serviceId: primaryService.id,
                                                    date: dateKey,
                                                    time: timeKey,
                                                    detailsStage: "contact",
                                                });
                                            }}
                                        >
                                            Voltar para contato
                                        </button>
                                    </div>
                                </>
                            )}

                            {submitError ? (
                                <div role="status" className="bookingFlow__fieldError">
                                    {submitError}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
