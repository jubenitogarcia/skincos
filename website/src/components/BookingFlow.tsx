"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { getDigitalJourneyUnits, units } from "@/data/units";
import { services, type Service } from "@/data/services";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import { useTeamDirectory } from "@/hooks/useTeamDirectory";
import { clearBookingDraft, persistBookingDraft, readBookingDraft, type BookingDraftState } from "@/lib/bookingDraft";
import { doctorSlugFromTeamMember, doctorSlugMatchesQuery, normalizeDoctorSlug } from "@/lib/doctorSlug";
import { trackBookingFunnelStep, trackBookingRequestSubmitted } from "@/lib/leadTracking";
import { setStoredUnitSlug } from "@/lib/unitSelection";
import TurnstileWidget from "@/components/TurnstileWidget";
import SmoothAnchorLink from "@/components/SmoothAnchorLink";
import UnitChooser from "@/components/UnitChooser";
import UnitDoctorsGrid, { type BookingSelectDoctor } from "@/components/UnitDoctorsGrid";
import BookingConfirmationCard from "@/components/BookingConfirmationCard";
import useHorizontalRail from "@/hooks/useHorizontalRail";
import type { BookingConfirmationPayload } from "@/lib/bookingConfirmationView";

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
    | { ok: true; id: string; status: string; confirmByMs: number; startAtMs: number; endAtMs: number; unitSlug: string; doctorSlug: string; doctorName: string; service: { id: string; name: string }; statusToken?: string | null; statusTokenExpMs?: number; notifications?: { email: NotificationResult; whatsapp: NotificationResult; unitEmail?: NotificationResult } }
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
    customer_email: string | null;
    notes: string | null;
    durationMinutes?: number;
    service?: { id: string; name: string } | null;
};

type StatusResponse = { ok: true; booking: BookingStatus } | { ok: false; error: string };
type DoctorSelection = { slug: string; name: string; handle: string | null };
type SubmittedReservation = {
    id: string;
    status: string;
    confirmByMs: number;
    statusToken?: string | null;
    notifications?: { email: NotificationResult; whatsapp: NotificationResult; unitEmail?: NotificationResult };
    reservation: BookingConfirmationPayload;
};

const ANY_DOCTOR: DoctorSelection = { slug: "any", name: "Sem Preferência", handle: null };
const OTHER_SERVICE: Service = { id: "any", name: "Outros", subtitle: "Outros procedimentos ou combinação" };
const BOOKING_WINDOW_WEEKS = 4;
const BOOKING_STATUS_SESSION_PREFIX = "booking-status-token:";

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

function formatTimeFromMs(value: number): string {
    const date = new Date(value);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
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

function formatBrPhone(input: string): string {
    const digits = (input ?? "").replace(/\D/g, "");
    const d = digits.slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : "";
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function normalizePatientGender(input: string): "female" | "male" | "unspecified" | "" {
    const value = (input ?? "").trim().toLowerCase();
    if (value === "female" || value === "feminino" || value === "f") return "female";
    if (value === "male" || value === "masculino" || value === "m") return "male";
    if (value === "unspecified" || value === "prefer_not_to_say" || value === "nao informar" || value === "não informar") return "unspecified";
    return "";
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

function PortalTooltip(props: { content: ReactNode; children: ReactNode; className: string; disabled?: boolean }) {
    const anchorRef = useRef<HTMLDivElement | null>(null);
    const tooltipRef = useRef<HTMLDivElement | null>(null);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [mounted, setMounted] = useState(false);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

    const clearTimers = useCallback(() => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
        if (exitTimerRef.current) {
            clearTimeout(exitTimerRef.current);
            exitTimerRef.current = null;
        }
    }, []);

    const openTooltip = useCallback(() => {
        if (props.disabled) return;
        clearTimers();
        if (!mounted) {
            setMounted(true);
            requestAnimationFrame(() => setOpen(true));
            return;
        }
        setOpen(true);
    }, [clearTimers, mounted, props.disabled]);

    const scheduleClose = useCallback(() => {
        clearTimers();
        closeTimerRef.current = setTimeout(() => {
            setOpen(false);
            exitTimerRef.current = setTimeout(() => {
                setMounted(false);
            }, 220);
        }, 90);
    }, [clearTimers]);

    const updatePosition = useCallback(() => {
        const anchor = anchorRef.current;
        const tooltip = tooltipRef.current;
        if (!anchor || !tooltip) return;
        const anchorRect = anchor.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const viewportPadding = 8;
        let left = anchorRect.left + anchorRect.width / 2;
        const minLeft = viewportPadding + tooltipRect.width / 2;
        const maxLeft = window.innerWidth - viewportPadding - tooltipRect.width / 2;
        left = Math.max(minLeft, Math.min(maxLeft, left));
        const top = anchorRect.bottom + 4;
        setPosition({ left, top });
    }, []);

    useLayoutEffect(() => {
        if (!mounted) return;
        updatePosition();
    }, [mounted, open, updatePosition, props.content]);

    useEffect(() => {
        if (!mounted) return;
        const onWindowChange = () => updatePosition();
        window.addEventListener("resize", onWindowChange);
        window.addEventListener("scroll", onWindowChange, true);
        return () => {
            window.removeEventListener("resize", onWindowChange);
            window.removeEventListener("scroll", onWindowChange, true);
        };
    }, [mounted, updatePosition]);

    useEffect(() => {
        return () => clearTimers();
    }, [clearTimers]);

    return (
        <div
            ref={anchorRef}
            className="bookingFlow__tooltipAnchor"
            onMouseEnter={openTooltip}
            onMouseLeave={scheduleClose}
            onFocusCapture={openTooltip}
            onBlurCapture={scheduleClose}
        >
            {props.children}
            {mounted && typeof document !== "undefined"
                ? createPortal(
                    <div
                        ref={tooltipRef}
                        className={props.className}
                        data-state={open ? "open" : "closed"}
                        role="tooltip"
                        style={{
                            position: "fixed",
                            left: position.left,
                            top: position.top,
                            display: "block",
                            zIndex: 5000,
                        }}
                        onMouseEnter={openTooltip}
                        onMouseLeave={scheduleClose}
                    >
                        {props.content}
                    </div>,
                    document.body,
                )
                : null}
        </div>
    );
}

function HoverScrollPicker(props: {
    ariaLabel: string;
    children: ReactNode;
    className?: string;
    scrollWindowClassName?: string;
    scrollWindowRef?: { current: HTMLDivElement | null };
}) {
    const ref = useRef<HTMLDivElement | null>(null);
    const setScrollWindowRef = useCallback(
        (node: HTMLDivElement | null) => {
            ref.current = node;
            if (props.scrollWindowRef) props.scrollWindowRef.current = node;
        },
        [props.scrollWindowRef],
    );
    const { canScrollLeft: canLeft, canScrollRight: canRight, hoverEdge, handleContainerMouseMove, clearHoverScroll, scrollByDirection } =
        useHorizontalRail({
            railRef: ref,
            itemSelector: "[role='listitem']",
            lockMs: 720,
            baseVelocity: 0.02,
            maxVelocity: 0.18,
        });

    return (
        <div
            className={["bookingFlow__picker", props.className].filter(Boolean).join(" ")}
            onMouseMove={handleContainerMouseMove}
            onMouseLeave={() => {
                clearHoverScroll();
            }}
        >
            <button
                type="button"
                className="bookingFlow__pickerArrow bookingFlow__pickerArrow--left carouselNavChrome"
                aria-label="Mover lista para a esquerda"
                disabled={!canLeft}
                onClick={() => scrollByDirection("left")}
                data-visible={canLeft ? "true" : "false"}
                data-hovered={hoverEdge === "left" ? "true" : "false"}
            >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M14.5 6.5 9 12l5.5 5.5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            <div
                ref={setScrollWindowRef}
                className={["bookingFlow__scrollWindow", props.scrollWindowClassName].filter(Boolean).join(" ")}
                role="list"
                aria-label={props.ariaLabel}
            >
                {props.children}
            </div>

            <button
                type="button"
                className="bookingFlow__pickerArrow bookingFlow__pickerArrow--right carouselNavChrome"
                aria-label="Mover lista para a direita"
                disabled={!canRight}
                onClick={() => scrollByDirection("right")}
                data-visible={canRight ? "true" : "false"}
                data-hovered={hoverEdge === "right" ? "true" : "false"}
            >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M9.5 6.5 15 12l-5.5 5.5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
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

    const [doctor, setDoctor] = useState<DoctorSelection | null>(null);
    const [selectedServices, setSelectedServices] = useState<Service[]>([]);

    const [dateKey, setDateKey] = useState<string | null>(null);
    const [timeKey, setTimeKey] = useState<string | null>(null);
    const [dateTouched, setDateTouched] = useState(false);

    const [slots, setSlots] = useState<SlotsPayload | null>(null);
    const [slotsLoading, setSlotsLoading] = useState(false);
    const [slotsError, setSlotsError] = useState<string | null>(null);

    const [patientName, setPatientName] = useState("");
    const [patientGender, setPatientGender] = useState<"female" | "male" | "unspecified" | "">("");
    const [email, setEmail] = useState("");
    const [whatsapp, setWhatsapp] = useState("");
    const [notes, setNotes] = useState("");

    const [detailsStartedAtMs, setDetailsStartedAtMs] = useState<number | null>(null);
    const [honeypot, setHoneypot] = useState("");
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
    const [turnstileHadError, setTurnstileHadError] = useState(false);

    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [dateAvailability, setDateAvailability] = useState<Record<string, boolean>>({});

    const [submitted, setSubmitted] = useState<SubmittedReservation | null>(null);
    const procedureScrollWindowRef = useRef<HTMLDivElement | null>(null);
    const autoPickMotionDoneRef = useRef(false);
    const patientNameInputRef = useRef<HTMLInputElement | null>(null);
    const draftToRestoreRef = useRef<BookingDraftState | null>(null);
    const draftAppliedRef = useRef(false);
    const draftReadyRef = useRef(false);
    const forceDoctorClear = useMemo(() => {
        const value = normalizeDoctorSlug(searchParams?.get("doctor") ?? "");
        return value === "none" || value === "clear";
    }, [searchParams]);
    const bookingIdQuery = useMemo(() => (searchParams?.get("booking") ?? "").trim(), [searchParams]);
    const bookingTokenQuery = useMemo(() => (searchParams?.get("statusToken") ?? "").trim(), [searchParams]);
    const isReservationDetailsView = step === "submitted" && !!submitted && bookingIdQuery.length > 0;

    const allowedUnitSlugs = useMemo(() => new Set(getDigitalJourneyUnits().map((unit) => unit.slug)), []);

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

    useEffect(() => {
        if (!bookingIdQuery) return;
        const storageKey = `${BOOKING_STATUS_SESSION_PREFIX}${bookingIdQuery}`;
        const tokenFromStorage = typeof window === "undefined" ? "" : sessionStorage.getItem(storageKey) ?? "";
        const token = bookingTokenQuery || tokenFromStorage;
        if (!token) return;

        if (bookingTokenQuery && typeof window !== "undefined") {
            sessionStorage.setItem(storageKey, bookingTokenQuery);
        }

        let cancelled = false;

        async function restoreSubmittedBooking() {
            try {
                const res = await fetch(`/api/booking/status?id=${encodeURIComponent(bookingIdQuery)}`, {
                    cache: "no-store",
                    headers: { "x-booking-status-token": token },
                });
                const json = (await res.json().catch(() => null)) as StatusResponse | null;
                if (cancelled || !res.ok || !json || !isOkResponse(json)) return;

                const booking = (json as { ok: true; booking: BookingStatus }).booking;
                const memberDoctor = (members ?? []).find((member) => doctorSlugFromTeamMember(member) === booking.doctor_slug);
                const startDate = new Date(Number(booking.start_at_ms));
                const reservation: BookingConfirmationPayload = {
                    id: booking.id,
                    unitSlug: booking.unit_slug,
                    procedureName: booking.service?.name ?? "Reserva",
                    date: formatLocalDateKey(startDate),
                    time: formatTimeFromMs(Number(booking.start_at_ms)),
                    patientName: booking.patient_name,
                    patientGender: "unspecified",
                    email: booking.customer_email ?? "",
                    whatsapp: booking.whatsapp,
                    doctorName: memberDoctor?.name ?? undefined,
                };

                setStoredUnitSlug(booking.unit_slug);
                setSubmitted({
                    id: booking.id,
                    status: booking.status,
                    confirmByMs: booking.confirm_by_ms,
                    statusToken: token,
                    reservation,
                });
                setStep("submitted");

                if (bookingTokenQuery && typeof window !== "undefined") {
                    const url = new URL(window.location.href);
                    url.searchParams.delete("statusToken");
                    if (!url.hash) url.hash = "booking-flow";
                    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
                }
            } catch {
                // ignore failed deep-link restoration and keep the default booking flow
            }
        }

        restoreSubmittedBooking();
        return () => {
            cancelled = true;
        };
    }, [bookingIdQuery, bookingTokenQuery, members]);

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
        if (unitSlug) {
            trackBookingFunnelStep({
                step: "unit_selected",
                unitSlug,
            });
        }
        lastUnitSlugRef.current = unitSlug;
        appliedDoctorQueryRef.current = null;
        appliedServiceQueryRef.current = null;

        setDoctor(null);
        setSelectedServices([]);
        setDateKey(null);
        setDateTouched(false);
        setTimeKey(null);
        setStep("pick");
        setDetailsStartedAtMs(null);
        setHoneypot("");
        setTurnstileToken(null);
        setTurnstileHadError(false);
        setSlots(null);
        setSlotsError(null);
        setDateAvailability({});
        setPatientName("");
        setPatientGender("");
        setEmail("");
        setWhatsapp("");
        setNotes("");
    }, [unitSlug]);

    useEffect(() => {
        if (draftAppliedRef.current) return;
        const draft = draftToRestoreRef.current;
        if (!draft) return;
        if (draft.unitSlug && draft.unitSlug !== unitSlug) return;

        if (!forceDoctorClear && draft.doctorSlug && draft.doctorName) {
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
        setPatientGender(normalizePatientGender(draft.patientGender));
        setEmail(draft.email);
        setWhatsapp(draft.whatsapp);
        setNotes(draft.notes);
        const canRestoreDetails = draft.step === "details" && restoredServiceIds.length > 0 && !!draft.dateKey && !!draft.timeKey;
        setStep(canRestoreDetails ? "details" : "pick");
        if (canRestoreDetails) setDetailsStartedAtMs(Date.now());

        trackBookingFunnelStep({
            step: "draft_restored",
            restored: true,
            unitSlug: draft.unitSlug,
            doctorSlug: draft.doctorSlug,
            serviceId: draft.serviceId,
            date: draft.dateKey,
            time: draft.timeKey,
            detailsStage: "contact",
        });

        draftAppliedRef.current = true;
        draftReadyRef.current = true;
    }, [forceDoctorClear, unitSlug]);
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
    const autoPickQuery = useMemo(() => normalizeDoctorSlug(searchParams?.get("autopick") ?? ""), [searchParams]);
    const autoPickNonceQuery = useMemo(() => (searchParams?.get("autopick_nonce") ?? "").trim(), [searchParams]);

    useEffect(() => {
        if (!unitSlug || !doctorsForUnit || doctorsForUnit.length === 0) return;
        if (!doctorQuery) return;
        if (appliedDoctorQueryRef.current === doctorQuery) return;

        if (doctorQuery === "any") {
            setDoctor(ANY_DOCTOR);
            appliedDoctorQueryRef.current = doctorQuery;
            return;
        }

        if (doctorQuery === "none" || doctorQuery === "clear") {
            setDoctor(null);
            appliedDoctorQueryRef.current = doctorQuery;
            return;
        }

        const match = doctorsForUnit.find((d) => {
            return doctorSlugMatchesQuery(doctorQuery, {
                name: d.name,
                instagramHandle: d.handle ?? null,
            });
        });

        if (!match) return;
        setDoctor({ slug: match.slug, name: match.name, handle: match.handle });
        appliedDoctorQueryRef.current = doctorQuery;
    }, [autoPickNonceQuery, doctorQuery, doctorsForUnit, unitSlug]);

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
    }, [autoPickNonceQuery, serviceQuery, unitSlug]);

    useEffect(() => {
        autoPickMotionDoneRef.current = false;
        if (autoPickQuery !== "first" || !unitSlug) return;

        appliedDoctorQueryRef.current = null;
        appliedServiceQueryRef.current = null;
        setDoctor(ANY_DOCTOR);
        setSelectedServices([OTHER_SERVICE]);
        setDateKey(null);
        setDateTouched(false);
        setTimeKey(null);
        setStep("pick");
        setDetailsStartedAtMs(null);
        setTurnstileToken(null);
        setTurnstileHadError(false);
        setSubmitError(null);
    }, [autoPickNonceQuery, autoPickQuery, unitSlug]);

    useEffect(() => {
        if (autoPickQuery !== "first") return;
        if (!unitSlug) return;

        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";

        if (!autoPickMotionDoneRef.current) {
            document.getElementById("booking-flow")?.scrollIntoView({ behavior, block: "start" });
            autoPickMotionDoneRef.current = true;
        }

        const procedureRail = procedureScrollWindowRef.current;
        if (!procedureRail) return;

        const activeProcedure = procedureRail.querySelector(".bookingFlow__procedureBadgeWrap[data-active='true']") as HTMLElement | null;
        if (!activeProcedure) return;

        const railRect = procedureRail.getBoundingClientRect();
        const activeRect = activeProcedure.getBoundingClientRect();
        const isOutOfView = activeRect.left < railRect.left + 10 || activeRect.right > railRect.right - 10;
        if (!isOutOfView) return;

        activeProcedure.scrollIntoView({
            behavior,
            block: "nearest",
            inline: "center",
        });
    }, [autoPickNonceQuery, autoPickQuery, selectedServiceIds, unitSlug]);

    const upcomingWeeks = useMemo(() => {
        const out: string[][] = [];
        const base = startOfCurrentWeek(new Date());
        for (let weekIndex = 0; weekIndex < BOOKING_WINDOW_WEEKS; weekIndex += 1) {
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
                        setSlotsError("A agenda desta unidade está sendo atualizada. Tente novamente em instantes.");
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
            trackBookingFunnelStep({ step: "submit_error", errorReason: "missing_unit", unitSlug: null });
            return;
        }
        if (!primaryService || !dateKey || !timeKey) {
            setSubmitError("Selecione procedimento, data e horário.");
            trackBookingFunnelStep({
                step: "submit_error",
                errorReason: "missing_selection",
                unitSlug,
                doctorSlug: effectiveDoctor.slug,
                serviceId: primaryService?.id ?? null,
                date: dateKey,
                time: timeKey,
                detailsStage: "contact",
            });
            return;
        }
        if (durationMinutes <= 0) {
            setSubmitError("Selecione ao menos um tipo de atendimento (tempo).");
            trackBookingFunnelStep({ step: "submit_error", errorReason: "missing_duration", unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
            return;
        }
        if (!patientName.trim()) {
            setSubmitError("Informe seu nome.");
            trackBookingFunnelStep({ step: "submit_error", errorReason: "missing_name", unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
            return;
        }
        if (!patientGender) {
            setSubmitError("Selecione o gênero.");
            trackBookingFunnelStep({ step: "submit_error", errorReason: "missing_gender", unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
            return;
        }
        if (!emailValue || !emailSeemsValid) {
            setSubmitError("Informe um e-mail válido.");
            trackBookingFunnelStep({ step: "submit_error", errorReason: "invalid_email", unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
            return;
        }
        if (!whatsapp.trim()) {
            setSubmitError("Informe seu WhatsApp.");
            trackBookingFunnelStep({ step: "submit_error", errorReason: "missing_whatsapp", unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
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
                    patientGender,
                    email: emailValue,
                    whatsapp,
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
                    trackBookingFunnelStep({ step: "submit_error", errorReason: err, unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
                    return;
                }
                if (err === "no_availability") {
                    setSubmitError("Esse horário não está mais disponível. Escolha outro horário.");
                    trackBookingFunnelStep({ step: "submit_error", errorReason: err, unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
                    return;
                }
                if (err === "no_doctors_for_unit") {
                    setSubmitError("Não foi possível selecionar um profissional para esta unidade. Tente escolher um profissional específico.");
                    trackBookingFunnelStep({ step: "submit_error", errorReason: err, unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
                    return;
                }
                if (err === "doctors_unavailable") {
                    setSubmitError("A agenda desta unidade está sendo atualizada. Tente novamente em instantes.");
                    trackBookingFunnelStep({ step: "submit_error", errorReason: err, unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
                    return;
                }
                if (err === "rate_limited") {
                    setSubmitError("Muitas tentativas em sequência. Aguarde alguns segundos e tente novamente.");
                    trackBookingFunnelStep({ step: "submit_error", errorReason: err, unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
                    return;
                }
                if (err === "too_fast") {
                    setSubmitError("Muito rápido. Aguarde um instante e tente novamente.");
                    trackBookingFunnelStep({ step: "submit_error", errorReason: err, unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
                    return;
                }
                if (err === "spam_detected") {
                    setSubmitError("Não foi possível enviar. Recarregue a página e tente novamente.");
                    trackBookingFunnelStep({ step: "submit_error", errorReason: err, unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
                    return;
                }
                if (err === "invalid_email") {
                    setSubmitError("Informe um e-mail válido.");
                    trackBookingFunnelStep({ step: "submit_error", errorReason: err, unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
                    return;
                }
                if (err === "invalid_gender") {
                    setSubmitError("Selecione o gênero.");
                    trackBookingFunnelStep({ step: "submit_error", errorReason: err, unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
                    return;
                }
                if (err === "turnstile_failed") {
                    setSubmitError("Falha na verificação anti-robô. Recarregue a página e tente novamente.");
                    trackBookingFunnelStep({ step: "submit_error", errorReason: err, unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
                    return;
                }
                if (err === "turnstile_unavailable") {
                    setSubmitError("A confirmação do envio ficou temporariamente indisponível. Recarregue a página e tente novamente.");
                    trackBookingFunnelStep({ step: "submit_error", errorReason: err, unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
                    return;
                }
                setSubmitError("Não foi possível enviar seu pedido. Tente novamente.");
                trackBookingFunnelStep({ step: "submit_error", errorReason: err, unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
                return;
            }

            setSubmitted({
                id: json.id,
                status: json.status,
                confirmByMs: json.confirmByMs,
                statusToken: json.statusToken ?? null,
                notifications: json.notifications,
                reservation: {
                    id: json.id,
                    unitSlug,
                    procedureName: selectedServicesLabel || primaryService.name,
                    date: dateKey,
                    time: timeKey,
                    patientName,
                    patientGender,
                    email: emailValue,
                    whatsapp,
                    doctorName: json.doctorName || effectiveDoctor.name,
                },
            });
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
            trackBookingFunnelStep({ step: "submit_error", errorReason: "network_failure", unitSlug, doctorSlug: effectiveDoctor.slug, serviceId: primaryService.id, date: dateKey, time: timeKey, detailsStage: "contact" });
        } finally {
            setSubmitting(false);
        }
    }

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

    const ensureDefaultSelections = useCallback(() => {
        if (!doctor) setDoctor(ANY_DOCTOR);
        if (selectedServices.length === 0) setSelectedServices([OTHER_SERVICE]);
    }, [doctor, selectedServices.length]);

    const openDetailsModal = useCallback((nextTime: string) => {
        ensureDefaultSelections();
        setTimeKey(nextTime);
        setStep("details");
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
    }, [dateKey, effectiveDoctorSlug, effectiveServiceId, ensureDefaultSelections, unitSlug]);

    const emailValue = email.trim().toLowerCase();
    const emailSeemsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue);
    const whatsappDigits = whatsapp.replace(/\D/g, "");
    const whatsappSeemsValid = whatsappDigits.length >= 10;
    const hasTurnstileWidget = !!turnstileSiteKey;
    const canSubmit =
        !!selectedSlot &&
        !!patientName.trim() &&
        !!patientGender &&
        emailSeemsValid &&
        whatsappSeemsValid;

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
        const timer = window.setTimeout(() => {
            patientNameInputRef.current?.focus();
        }, 0);
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                trackBookingFunnelStep({
                    step: "details_closed",
                    unitSlug,
                    doctorSlug: effectiveDoctorSlug,
                    serviceId: effectiveServiceId,
                    date: dateKey,
                    time: timeKey,
                    detailsStage: "contact",
                });
                setStep("pick");
                setSubmitError(null);
                setTurnstileToken(null);
                setTurnstileHadError(false);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener("keydown", onKey);
        };
    }, [dateKey, effectiveDoctorSlug, effectiveServiceId, showDetailsModal, timeKey, unitSlug]);

    function selectDoctor(nextDoctor: DoctorSelection | null) {
        if (!nextDoctor) return;
        if (doctor?.slug === nextDoctor.slug) return;
        trackBookingFunnelStep({
            step: "doctor_selected",
            unitSlug,
            doctorSlug: nextDoctor.slug,
        });
        setDoctor(nextDoctor);
        setDateKey(null);
        setDateTouched(false);
        setTimeKey(null);
        setStep("pick");
    }

    function toggleProcedure(nextService: Service) {
        setSelectedServices((current) => {
            if (nextService.id === OTHER_SERVICE.id) {
                const alreadySelected = current.some((item) => item.id === OTHER_SERVICE.id);
                if (alreadySelected) return current;

                const nextSelection = [OTHER_SERVICE];
                trackBookingFunnelStep({
                    step: "service_selected",
                    unitSlug,
                    doctorSlug: effectiveDoctorSlug,
                    serviceId: nextSelection[0]?.id ?? null,
                    selectedCount: nextSelection.length,
                });
                return nextSelection;
            }

            const withoutOther = current.filter((item) => item.id !== OTHER_SERVICE.id);
            const alreadySelected = withoutOther.some((item) => item.id === nextService.id);
            if (alreadySelected) return current;

            const nextSelection = [...withoutOther, nextService];
            trackBookingFunnelStep({
                step: "service_selected",
                unitSlug,
                doctorSlug: effectiveDoctorSlug,
                serviceId: nextService.id,
                selectedCount: nextSelection.length,
            });
            return nextSelection;
        });
        setDateKey(null);
        setDateTouched(false);
        setTimeKey(null);
        setStep("pick");
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
            patientGender ||
            email.trim() ||
            whatsapp.trim() ||
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
            patientName,
            patientGender,
            email,
            whatsapp,
            notes,
        });
    }, [
        dateKey,
        doctor?.handle,
        doctor?.name,
        doctor?.slug,
        email,
        notes,
        patientName,
        patientGender,
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
                        <div className="bookingFlow__stage bookingFlow__cardEntryUnit">
                            <div className="bookingFlow__stepIntro">
                                <div className="bookingFlow__entryTitle">Escolha a unidade</div>
                                <div className="bookingFlow__cardSub">A unidade libera a equipe, o procedimento e os horários reais.</div>
                            </div>
                            <div className="bookingFlow__embeddedUnitChooser">
                                <UnitChooser />
                            </div>
                        </div>
                    ) : null}

                    <div
                        className={`bookingFlow__stage bookingFlow__cardDoctor ${unitSlug ? "bookingFlow__cardDoctor--half" : "bookingFlow__cardDoctor--withUnit"}`.trim()}
                    >
                        <div className="bookingFlow__stepIntro">
                            <div className="bookingFlow__entryTitle">Escolha o seu doutor</div>
                            <div className="bookingFlow__cardSub">Escolha o especialista e veja os dias e horários disponíveis para atendimento.</div>
                        </div>
                        <div>
                            {!unitLabel ? (
                                <div className="bookingFlow__emptyState" role="status">
                                    <span className="bookingFlow__emptyEyebrow">Primeiro passo</span>
                                    <strong className="bookingFlow__emptyTitle">A equipe aparece depois da unidade.</strong>
                                    <p className="bookingFlow__emptyBody">
                                        Depois de escolher a unidade, mostramos os especialistas disponíveis naquele local.
                                        Se preferir comparar os perfis antes, abra a página de especialistas.
                                    </p>
                                    <div className="bookingFlow__emptyActions">
                                        <SmoothAnchorLink className="decisionCard__secondary" href="/#doutores">
                                            Ver especialistas
                                        </SmoothAnchorLink>
                                    </div>
                                </div>
                            ) : doctorsForUnit === null || membersLoading ? (
                                <div className="bookingFlow__doctorLoading" aria-hidden="true">
                                    <span className="bookingFlow__doctorLoadingAvatar" />
                                    <span className="bookingFlow__doctorLoadingLine bookingFlow__doctorLoadingLine--title" />
                                    <span className="bookingFlow__doctorLoadingLine" />
                                </div>
                            ) : doctorsForUnit.length === 0 ? (
                                <div className="small">
                                    {membersError ? "A agenda desta unidade está sendo atualizada. Tente novamente em instantes." : "Nenhum doutor encontrado para esta unidade."}
                                </div>
                            ) : (
                                <div className="bookingFlow__railShell bookingFlow__railShell--doctors">
                                    <UnitDoctorsGrid
                                        variant="booking-select"
                                        doctorSelections={doctorsForUnit.map(
                                            (doctor): BookingSelectDoctor => ({
                                                slug: doctor.slug,
                                                name: doctor.name,
                                                handle: doctor.handle,
                                            }),
                                        )}
                                        activeDoctorSlug={doctor?.slug ?? null}
                                        onDoctorSelect={selectDoctor}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    <div className={`bookingFlow__stage bookingFlow__cardProcedure ${unitSlug ? "bookingFlow__cardProcedure--half" : "bookingFlow__cardProcedure--full"}`.trim()}>
                        <div className="bookingFlow__stepIntro">
                            <div className="bookingFlow__entryTitle">Escolha os procedimentos</div>
                            <div className="bookingFlow__cardSub">Selecione um ou mais procedimentos para o seu atendimento.</div>
                        </div>
                        {!canPickProcedure ? (
                            <div className="bookingFlow__emptyState" role="status">
                                <span className="bookingFlow__emptyEyebrow">Como continuar</span>
                                <strong className="bookingFlow__emptyTitle">Os procedimentos aparecem depois da unidade.</strong>
                                <p className="bookingFlow__emptyBody">
                                    Primeiro escolha a unidade. Depois você pode selecionar o procedimento
                                    ou seguir mesmo se ainda quiser orientação.
                                </p>
                            </div>
                        ) : (
                            <div className="bookingFlow__railShell bookingFlow__railShell--procedures">
                                <HoverScrollPicker
                                    ariaLabel="Lista de procedimentos"
                                    className="bookingFlow__picker--rail"
                                    scrollWindowRef={procedureScrollWindowRef}
                                >
                                    <div className="bookingFlow__procedureBadgeGrid">
                                        {services.map((s) => {
                                            const active = selectedServices.some((item) => item.id === s.id);
                                            return (
                                                <div key={s.id} className="bookingFlow__procedureBadgeWrap" role="listitem" data-active={active ? "true" : "false"}>
                                                    <PortalTooltip
                                                        className="bookingFlow__procedureTooltip"
                                                        disabled={!s.subtitle}
                                                        content={s.subtitle ?? ""}
                                                    >
                                                        <button
                                                            type="button"
                                                            className="bookingFlow__procedureBadge"
                                                            data-active={active ? "true" : "false"}
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
                                                    </PortalTooltip>
                                                </div>
                                            );
                                        })}

                                        <div
                                            className="bookingFlow__procedureBadgeWrap"
                                            role="listitem"
                                            data-active={selectedServices.some((item) => item.id === OTHER_SERVICE.id) ? "true" : "false"}
                                        >
                                            <PortalTooltip className="bookingFlow__procedureTooltip" content="Outros procedimentos ou combinação">
                                                <button
                                                    type="button"
                                                    className="bookingFlow__procedureBadge"
                                                    data-active={selectedServices.some((item) => item.id === OTHER_SERVICE.id) ? "true" : "false"}
                                                    onClick={() => toggleProcedure(OTHER_SERVICE)}
                                                >
                                                    <span className="bookingFlow__procedureBadgeAvatar bookingFlow__procedureBadgeAvatar--all">
                                                        <span className="bookingFlow__procedureBadgeFallback bookingFlow__procedureBadgeFallback--all">Outros</span>
                                                    </span>
                                                    <span className="bookingFlow__procedureBadgeLabel">Outros</span>
                                                </button>
                                            </PortalTooltip>
                                        </div>
                                    </div>
                                </HoverScrollPicker>
                            </div>
                        )}
                    </div>

                    <div className="bookingFlow__stage bookingFlow__cardFull bookingFlow__cardDateTime">
                        <div className="bookingFlow__cardHeader">
                            <div className="bookingFlow__stepIntro">
                                <div className="bookingFlow__entryTitle">Data e horário</div>
                                <div className="bookingFlow__cardSub">Selecione uma data e verifique os horários disponíveis.</div>
                            </div>
                        </div>
                        {!canPick ? (
                            <div className="bookingFlow__emptyState bookingFlow__emptyState--wide" role="status">
                                <span className="bookingFlow__emptyEyebrow">Agenda real</span>
                                <strong className="bookingFlow__emptyTitle">Os horários aparecem quando a unidade estiver definida.</strong>
                                <p className="bookingFlow__emptyBody">
                                    Ao escolher a unidade, mostramos as datas e os horários disponíveis para aquele atendimento.
                                </p>
                            </div>
                        ) : (
                            <div className="bookingFlow__datetimeGrid bookingFlow__datetimeGrid--centered">
                                <div>
                                    <div className="bookingFlow__dateWeeks">
                                        {visibleUpcomingWeeks.map((week) => (
                                            <div key={week[0]} className="bookingFlow__dateWeekRow">
                                                {week.map((d) => {
                                                    const active = dateKey === d;
                                                    const isPastDate = isDateKeyBeforeToday(d);
                                                    const isOccupiedDate = canPick && hasResolvedDateAvailability && !isPastDate && dateAvailability[d] === false;
                                                    const isLockedDate = isPastDate || isOccupiedDate;
                                                    const dateTooltip = isPastDate ? "passou" : isOccupiedDate ? "ocupado" : "disponível";
                                                    const dateTooltipTone = isPastDate ? "neutral" : isOccupiedDate ? "occupied" : "available";
                                                    const dateReason = isPastDate ? "past" : isOccupiedDate ? "agenda" : "available";
                                                    const ariaDisabled = !canPick || isLockedDate;
                                                    return (
                                                        <button
                                                            key={d}
                                                            type="button"
                                                            disabled={!canPick}
                                                            aria-disabled={ariaDisabled}
                                                            className="bookingFlow__selectItem bookingFlow__dateBtn"
                                                            data-active={active ? "true" : "false"}
                                                            data-locked={isLockedDate ? "true" : "false"}
                                                            data-reason={dateReason}
                                                            data-tooltip={dateTooltip}
                                                            data-tooltip-tone={dateTooltipTone}
                                                            onClick={() => {
                                                                if (ariaDisabled) return;
                                                                ensureDefaultSelections();
                                                                setDateTouched(true);
                                                                if (active) {
                                                                    trackBookingFunnelStep({
                                                                        step: "date_cleared",
                                                                        unitSlug,
                                                                        doctorSlug: effectiveDoctorSlug,
                                                                        serviceId: effectiveServiceId,
                                                                        date: d,
                                                                    });
                                                                    setDateKey(null);
                                                                    setTimeKey(null);
                                                                    setStep("pick");
                                                                    return;
                                                                }

                                                                trackBookingFunnelStep({
                                                                    step: "date_selected",
                                                                    unitSlug,
                                                                    doctorSlug: effectiveDoctorSlug,
                                                                    serviceId: effectiveServiceId,
                                                                    date: d,
                                                                });
                                                                setDateKey(d);
                                                                setTimeKey(null);
                                                                setStep("pick");
                                                            }}
                                                        >
                                                            <div className="bookingFlow__dateBtnWeekday">
                                                                {weekdayPtBrShort(d)}
                                                            </div>
                                                            <div className="bookingFlow__dateBtnDay">
                                                                {parseLocalDateKey(d)?.getDate()}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ))}
                                    </div>
                                    {!canPick ? (
                                        <div className="small bookingFlow__dateHint">
                                            Selecione a unidade no topo para liberar as datas.
                                        </div>
                                    ) : null}
                                </div>

                                <div>
                                    <div className="bookingFlow__timeStateWrap">
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
                                                    const isOccupied = s.reason === "agenda" || s.reason === "booked";
                                                    const hasTooltip = isPast || isOccupied || s.available;
                                                    const tooltip = isPast ? "passou" : isOccupied ? "ocupado" : s.available ? "disponível" : "";
                                                    const tooltipTone = isPast ? "neutral" : isOccupied ? "occupied" : s.available ? "available" : "neutral";
                                                    const ariaDisabled = !s.available;
                                                    const nativeDisabled = !s.available && !hasTooltip;
                                                    const label =
                                                        isPast || isOccupied
                                                            ? ""
                                                            : s.reason === "in_review"
                                                                    ? "Em análise"
                                                                    : "";

                                                    return (
                                                        <button
                                                            key={s.time}
                                                            type="button"
                                                            disabled={nativeDisabled}
                                                            aria-disabled={ariaDisabled}
                                                            data-reason={s.reason ?? ""}
                                                            data-locked={hasTooltip ? "true" : "false"}
                                                            data-tooltip={hasTooltip ? tooltip : undefined}
                                                            data-tooltip-tone={hasTooltip ? tooltipTone : undefined}
                                                            className="bookingFlow__selectItem bookingFlow__timeBtn"
                                                            data-active={active ? "true" : "false"}
                                                            onClick={() => {
                                                                if (ariaDisabled) return;
                                                                if (active) {
                                                                    if (step !== "details") {
                                                                        trackBookingFunnelStep({
                                                                            step: "time_selected",
                                                                            unitSlug,
                                                                            doctorSlug: effectiveDoctorSlug,
                                                                            serviceId: effectiveServiceId,
                                                                            date: dateKey,
                                                                            time: s.time,
                                                                        });
                                                                        openDetailsModal(s.time);
                                                                        return;
                                                                    }
                                                                    trackBookingFunnelStep({
                                                                        step: "time_cleared",
                                                                        unitSlug,
                                                                        doctorSlug: effectiveDoctorSlug,
                                                                        serviceId: effectiveServiceId,
                                                                        date: dateKey,
                                                                        time: s.time,
                                                                    });
                                                                    setTimeKey(null);
                                                                    setStep("pick");
                                                                    setDetailsStartedAtMs(null);
                                                                    setTurnstileToken(null);
                                                                    setTurnstileHadError(false);
                                                                    setSubmitError(null);
                                                                    return;
                                                                }
                                                                trackBookingFunnelStep({
                                                                    step: "time_selected",
                                                                    unitSlug,
                                                                    doctorSlug: effectiveDoctorSlug,
                                                                    serviceId: effectiveServiceId,
                                                                    date: dateKey,
                                                                    time: s.time,
                                                                });
                                                                openDetailsModal(s.time);
                                                            }}
                                                            tabIndex={ariaDisabled ? -1 : 0}
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
                        )}
                    </div>
                </div>
	            ) : (
	                <div className="bookingFlow__grid">
	                    <div className="bookingFlow__cardFull">
	                        {submitted ? (
	                            <BookingConfirmationCard
                                    reservation={submitted.reservation}
                                    notifications={submitted.notifications}
                                    variant={isReservationDetailsView ? "details_link" : "default"}
                                />
	                        ) : null}
	                    </div>
	                </div>
	            )}
            {showDetailsModal && unitSlug && primaryService && dateKey && timeKey ? (
                <div
                    className="bookingFlow__modalBackdrop"
                    role="dialog"
                    aria-modal="true"
                    onClick={(event) => {
                        if (event.target !== event.currentTarget) return;
                        trackBookingFunnelStep({
                            step: "details_closed",
                            unitSlug,
                            doctorSlug: effectiveDoctorSlug,
                            serviceId: effectiveServiceId,
                            date: dateKey,
                            time: timeKey,
                            detailsStage: "contact",
                        });
                        setStep("pick");
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
                                    trackBookingFunnelStep({
                                        step: "details_closed",
                                        unitSlug,
                                        doctorSlug: effectiveDoctorSlug,
                                        serviceId: effectiveServiceId,
                                        date: dateKey,
                                        time: timeKey,
                                        detailsStage: "contact",
                                    });
                                    setStep("pick");
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

                            <div className="bookingFlow__formGrid">
                                <label className="bookingFlow__field">
                                    <span>Nome</span>
                                    <input
                                        ref={patientNameInputRef}
                                        value={patientName}
                                        onChange={(e) => setPatientName(e.target.value)}
                                        placeholder="Seu nome"
                                        autoComplete="name"
                                        className="bookingFlow__input"
                                    />
                                </label>

                                <label className="bookingFlow__field">
                                    <span>Gênero</span>
                                    <select
                                        value={patientGender}
                                        onChange={(e) => setPatientGender(normalizePatientGender(e.target.value))}
                                        className="bookingFlow__input"
                                        aria-invalid={patientGender === "" && (patientName.length > 0 || email.length > 0 || whatsapp.length > 0)}
                                    >
                                        <option value="">Selecione</option>
                                        <option value="female">Feminino</option>
                                        <option value="male">Masculino</option>
                                        <option value="unspecified">Prefiro não informar</option>
                                    </select>
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

                                <label className="bookingFlow__field" style={{ gridColumn: "1 / -1" }}>
                                    <span>Informações</span>
                                    <textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Observações relevantes para o seu atendimento (opcional)."
                                        rows={3}
                                        className="bookingFlow__textarea"
                                    />
                                </label>
                            </div>
                            {email.length > 0 && !emailSeemsValid ? (
                                <div className="bookingFlow__fieldError">Informe um e-mail válido.</div>
                            ) : null}
                            {patientGender === "" && (patientName.length > 0 || email.length > 0 || whatsapp.length > 0) ? (
                                <div className="bookingFlow__fieldError">Selecione o gênero.</div>
                            ) : null}
                            {!whatsappSeemsValid && whatsapp.length > 0 ? (
                                <div className="bookingFlow__fieldError">Informe DDD + número (ex.: (51) 99999-9999).</div>
                            ) : null}

                            {hasTurnstileWidget ? (
                                <div style={{ display: "grid", gap: 8 }}>
                                    <TurnstileWidget
                                        siteKey={turnstileSiteKey}
                                        onToken={setTurnstileToken}
                                        onError={() => setTurnstileHadError(true)}
                                    />
                                    {!turnstileToken ? (
                                        <div className="small" style={{ color: turnstileHadError ? "#b91c1c" : "var(--muted)" }}>
                                            {turnstileHadError
                                                ? "A verificação anti-robô não carregou, mas você pode continuar e tentar enviar mesmo assim."
                                                : "Se a verificação aparecer, conclua-a antes de enviar."}
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}

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
                                        trackBookingFunnelStep({
                                            step: "details_closed",
                                            unitSlug,
                                            doctorSlug: effectiveDoctorSlug,
                                            serviceId: effectiveServiceId,
                                            date: dateKey,
                                            time: timeKey,
                                            detailsStage: "contact",
                                        });
                                        setStep("pick");
                                        setSubmitError(null);
                                        setTurnstileToken(null);
                                        setTurnstileHadError(false);
                                    }}
                                >
                                    Voltar para agenda
                                </button>
                            </div>

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
