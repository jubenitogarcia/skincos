"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TrackedWhatsappLink from "@/components/TrackedWhatsappLink";
import { trackEvent } from "@/lib/analytics";
import { trackLeadConversion } from "@/lib/conversions";
import { CADASTRO_WHEEL_PRIZES, type CadastroPrize } from "@/lib/cadastroWheelPrizes";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import styles from "./CadastroWheelExperience.module.css";

type SpinStatus = "idle" | "spinning" | "done";
type ButtonPhase = "hidden" | "visible" | "fading" | "gone";
type CadastroLeadForm = {
    fullName: string;
    phone: string;
    email: string;
};

type WheelStatusResponse =
    | { ok: true; locked: true; prizeId: number; expMs?: number }
    | { ok: true; locked: false; prizeId: null }
    | { ok: false; error: string };

type WheelSpinResponse =
    | { ok: true; prizeId: number; replay: boolean; expMs?: number }
    | { ok: false; error: string };

type SpinSoundNodes = {
    ctx: AudioContext;
    masterGain: GainNode;
    audioNodes: AudioNode[];
    stopNodes: Array<OscillatorNode | AudioBufferSourceNode>;
};

const PRIZES = CADASTRO_WHEEL_PRIZES;
const SLICE_COUNT = PRIZES.length;
const CALIBRATION_DEG = 15;
const READY_DEADLINE_MS = 1600;
const BUTTON_FADE_OUT_MS = 1200;
const BOOKING_EXTRA_DELAY_MS = 700;
const RESULT_STING_MS = 2000;
const SPIN_AUDIO_FADE_OUT_MS = 250;
const LOCAL_LOCK_KEY = "ef_cadastro_wheel_lock";
const LOCAL_LOCK_MS = 24 * 60 * 60 * 1000;
const CADASTRO_LEAD_STORAGE_KEY = "ef_cadastro_lead_form";
const CADASTRO_WHATSAPP_BY_UNIT: Record<string, string> = {
    barrashoppingsul: "5551980882293",
    "novo-hamburgo": "5551995811008",
    novohamburgo: "5551995811008",
};
const EMPTY_LEAD_FORM: CadastroLeadForm = {
    fullName: "",
    phone: "",
    email: "",
};
const DUPLICATE_LEAD_ERROR = "Cadastro já realizado";

function wait(ms: number) {
    return new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

function nextFrame() {
    return new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}

function formatBrPhone(input: string): string {
    const digits = (input ?? "").replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits ? `(${digits}` : "";
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function normalizePhoneDigits(input: string): string {
    return (input ?? "").replace(/\D/g, "").slice(0, 11);
}

function isValidFullName(input: string): boolean {
    const parts = (input ?? "")
        .trim()
        .split(/\s+/)
        .filter((part) => part.length >= 2);
    return parts.length >= 2;
}

function isValidEmail(input: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((input ?? "").trim().toLowerCase());
}

function isLeadFormValid(form: CadastroLeadForm): boolean {
    return isValidFullName(form.fullName) && normalizePhoneDigits(form.phone).length >= 10 && isValidEmail(form.email);
}

function readStoredLeadForm(): CadastroLeadForm | null {
    try {
        const raw = window.sessionStorage.getItem(CADASTRO_LEAD_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<CadastroLeadForm>;
        const form = {
            fullName: String(parsed.fullName ?? "").trim(),
            phone: formatBrPhone(String(parsed.phone ?? "")),
            email: String(parsed.email ?? "").trim().toLowerCase(),
        };
        return isLeadFormValid(form) ? form : null;
    } catch {
        return null;
    }
}

function persistLeadForm(form: CadastroLeadForm) {
    try {
        window.sessionStorage.setItem(
            CADASTRO_LEAD_STORAGE_KEY,
            JSON.stringify({
                fullName: form.fullName.trim(),
                phone: normalizePhoneDigits(form.phone),
                email: form.email.trim().toLowerCase(),
            }),
        );
    } catch {
        // noop
    }
}

function targetOffsetForPrize(prize: CadastroPrize) {
    const slice = 360 / SLICE_COUNT;
    const pointerAngle = (prize.id - 0.5) * slice;
    return ((360 + CALIBRATION_DEG - pointerAngle) % 360 + 360) % 360;
}

function findPrizeById(prizeId: number): CadastroPrize | null {
    return PRIZES.find((prize) => prize.id === prizeId) ?? null;
}

function clearLocalLock() {
    try {
        window.localStorage.removeItem(LOCAL_LOCK_KEY);
    } catch {
        // noop
    }
}

function readLocalLockedPrize(): CadastroPrize | null {
    try {
        const raw = window.localStorage.getItem(LOCAL_LOCK_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { prizeId?: unknown; expMs?: unknown };
        const prizeId = Number(parsed.prizeId);
        const expMs = Number(parsed.expMs);
        if (!Number.isInteger(prizeId) || !Number.isFinite(expMs) || expMs <= Date.now()) {
            clearLocalLock();
            return null;
        }
        const prize = findPrizeById(prizeId);
        if (!prize) {
            clearLocalLock();
            return null;
        }
        return prize;
    } catch {
        clearLocalLock();
        return null;
    }
}

function persistLocalLockedPrize(prize: CadastroPrize, expMs = Date.now() + LOCAL_LOCK_MS) {
    try {
        window.localStorage.setItem(
            LOCAL_LOCK_KEY,
            JSON.stringify({
                prizeId: prize.id,
                expMs,
            }),
        );
    } catch {
        // noop
    }
}

function createNoiseBuffer(ctx: AudioContext, durationMs = 1400) {
    const frameCount = Math.max(1, Math.floor((ctx.sampleRate * durationMs) / 1000));
    const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
    const channel = buffer.getChannelData(0);

    let lastSample = 0;
    for (let index = 0; index < frameCount; index += 1) {
        const white = Math.random() * 2 - 1;
        lastSample = lastSample * 0.72 + white * 0.28;
        channel[index] = lastSample;
    }

    return buffer;
}

async function getAudioContext(): Promise<AudioContext | null> {
    const AudioCtx = window.AudioContext;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
        try {
            await ctx.resume();
        } catch {
            // noop
        }
    }
    return ctx;
}

export default function CadastroWheelExperience({ whatsappPhone }: { whatsappPhone: string }) {
    const currentUnit = useCurrentUnit();
    const [leadForm, setLeadForm] = useState<CadastroLeadForm>(EMPTY_LEAD_FORM);
    const [leadAttempted, setLeadAttempted] = useState(false);
    const [leadGateOpen, setLeadGateOpen] = useState(false);
    const [leadSubmitting, setLeadSubmitting] = useState(false);
    const [leadError, setLeadError] = useState<string | null>(null);
    const [duplicatePrize, setDuplicatePrize] = useState<CadastroPrize | null>(null);
    const [status, setStatus] = useState<SpinStatus>("idle");
    const [buttonPhase, setButtonPhase] = useState<ButtonPhase>("hidden");
    const [loaderVisible, setLoaderVisible] = useState(false);
    const [rotation, setRotation] = useState(0);
    const [transition, setTransition] = useState("none");
    const [result, setResult] = useState<CadastroPrize | null>(null);
    const [ctaVisible, setCtaVisible] = useState(false);
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
    const currentRotationRef = useRef(0);
    const timeoutsRef = useRef<number[]>([]);
    const spinSoundRef = useRef<SpinSoundNodes | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const noiseBufferRef = useRef<AudioBuffer | null>(null);
    const cadastroUnitSelected = Boolean(currentUnit?.slug && CADASTRO_WHATSAPP_BY_UNIT[currentUnit.slug]);

    useEffect(() => {
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const sync = () => setPrefersReducedMotion(media.matches);
        sync();
        media.addEventListener("change", sync);
        return () => media.removeEventListener("change", sync);
    }, []);

    useEffect(() => {
        const storedLead = readStoredLeadForm();
        if (!storedLead) return;
        setLeadForm(storedLead);
    }, []);

    useEffect(() => {
        if (!cadastroUnitSelected || !leadGateOpen || duplicatePrize !== null) return;
        let active = true;

        async function gateReady() {
            setLoaderVisible(true);
            setButtonPhase("hidden");
            const restoredPrizePromise = fetchLockedPrize();
            await wait(READY_DEADLINE_MS);
            await nextFrame();
            if (!active) return;

            setLoaderVisible(false);
            const restoredPrize = await Promise.race([restoredPrizePromise, wait(450).then(() => null)]);
            if (!active) return;

            if (restoredPrize) {
                setStatus("done");
                setButtonPhase("gone");
                setResult(restoredPrize);
                setCtaVisible(true);
                trackEvent("cadastro_wheel_state_restored", {
                    page: "/cadastro",
                    prizeId: restoredPrize.id,
                    prizeName: restoredPrize.label,
                });
                return;
            }

            setButtonPhase("visible");
        }

        gateReady();

        return () => {
            active = false;
        };
    }, [cadastroUnitSelected, duplicatePrize, leadGateOpen]);

    useEffect(() => {
        const timeoutStore = timeoutsRef;
        const spinSound = spinSoundRef;
        const audioCtxStore = audioCtxRef;

        return () => {
            for (const timeout of timeoutStore.current) {
                window.clearTimeout(timeout);
            }
            if (spinSound.current) {
                for (const node of spinSound.current.stopNodes) {
                    try {
                        node.stop();
                    } catch {
                        // noop
                    }
                }
                for (const node of spinSound.current.audioNodes) {
                    try {
                        node.disconnect();
                    } catch {
                        // noop
                    }
                }
                spinSound.current = null;
            }
            if (audioCtxStore.current) {
                void audioCtxStore.current.close();
                audioCtxStore.current = null;
            }
        };
    }, []);

    const resolvedWhatsappPhone = useMemo(() => {
        const currentUnitSlug = currentUnit?.slug ?? "";
        return CADASTRO_WHATSAPP_BY_UNIT[currentUnitSlug] ?? whatsappPhone;
    }, [currentUnit?.slug, whatsappPhone]);

    const duplicateDetected = duplicatePrize !== null;
    const fullNameInvalid = leadAttempted && !isValidFullName(leadForm.fullName);
    const phoneInvalid = leadAttempted && normalizePhoneDigits(leadForm.phone).length < 10;
    const emailInvalid = leadAttempted && !isValidEmail(leadForm.email);
    const canSubmitLead = isLeadFormValid(leadForm);

    const whatsappUrl = useMemo(() => {
        if (!result) return null;
        return buildWhatsAppUrl(resolvedWhatsappPhone, result.message);
    }, [resolvedWhatsappPhone, result]);

    const duplicateWhatsappUrl = useMemo(() => {
        if (!duplicatePrize) return null;
        return buildWhatsAppUrl(resolvedWhatsappPhone, duplicatePrize.message);
    }, [duplicatePrize, resolvedWhatsappPhone]);

    function trackTimeout(callback: () => void, ms: number) {
        const id = window.setTimeout(callback, ms);
        timeoutsRef.current.push(id);
        return id;
    }

    function resolveFallbackLocalPrize(): { prize: CadastroPrize; replay: boolean } {
        const lockedPrize = readLocalLockedPrize();
        if (lockedPrize) {
            return { prize: lockedPrize, replay: true };
        }
        const drawnPrize = PRIZES[Math.floor(Math.random() * PRIZES.length)];
        persistLocalLockedPrize(drawnPrize);
        return { prize: drawnPrize, replay: false };
    }

    async function fetchLockedPrize(): Promise<CadastroPrize | null> {
        try {
            const response = await fetch("/api/cadastro/wheel", {
                method: "GET",
                cache: "no-store",
            });
            if (!response.ok) {
                return readLocalLockedPrize();
            }

            const payload = (await response.json()) as WheelStatusResponse;
            if (payload.ok && payload.locked && typeof payload.prizeId === "number") {
                return findPrizeById(payload.prizeId);
            }

            if (payload.ok && !payload.locked) {
                clearLocalLock();
                return null;
            }

            if (!payload.ok && payload.error === "wheel_secret_unavailable") {
                return readLocalLockedPrize();
            }

            return null;
        } catch {
            return readLocalLockedPrize();
        }
    }

    async function claimPrize(): Promise<{ prize: CadastroPrize; replay: boolean; source: "server" | "local-lock" }> {
        try {
            const response = await fetch("/api/cadastro/wheel", {
                method: "POST",
                cache: "no-store",
            });
            if (response.ok) {
                const payload = (await response.json()) as WheelSpinResponse;
                if (payload.ok && typeof payload.prizeId === "number") {
                    const prize = findPrizeById(payload.prizeId);
                    if (prize) {
                        clearLocalLock();
                        return { prize, replay: payload.replay, source: "server" };
                    }
                }

                if (!payload.ok && payload.error === "wheel_secret_unavailable") {
                    const fallback = resolveFallbackLocalPrize();
                    return { ...fallback, source: "local-lock" };
                }
            }
        } catch {
            // noop
        }

        const fallback = resolveFallbackLocalPrize();
        return { ...fallback, source: "local-lock" };
    }

    async function ensureAudioContext(): Promise<AudioContext | null> {
        if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
            if (audioCtxRef.current.state === "suspended") {
                try {
                    await audioCtxRef.current.resume();
                } catch {
                    // noop
                }
            }
            return audioCtxRef.current;
        }
        const ctx = await getAudioContext();
        audioCtxRef.current = ctx;
        return ctx;
    }

    async function startSpinSound() {
        const ctx = await ensureAudioContext();
        if (!ctx || spinSoundRef.current) return;

        const noiseBuffer = noiseBufferRef.current ?? createNoiseBuffer(ctx);
        noiseBufferRef.current = noiseBuffer;

        const masterGain = ctx.createGain();
        const lowOsc = ctx.createOscillator();
        const lowGain = ctx.createGain();
        const wobbleOsc = ctx.createOscillator();
        const wobbleGain = ctx.createGain();
        const noiseSource = ctx.createBufferSource();
        const noiseFilter = ctx.createBiquadFilter();
        const noiseGain = ctx.createGain();

        masterGain.gain.value = 0;

        lowOsc.type = "triangle";
        lowOsc.frequency.value = 132;

        lowGain.gain.value = 0.22;

        wobbleOsc.type = "sine";
        wobbleOsc.frequency.value = 4.6;
        wobbleGain.gain.value = 10;

        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        noiseFilter.type = "bandpass";
        noiseFilter.frequency.value = 1850;
        noiseFilter.Q.value = 1.1;

        noiseGain.gain.value = 0.1;

        lowOsc.connect(lowGain);
        lowGain.connect(masterGain);
        wobbleOsc.connect(wobbleGain);
        wobbleGain.connect(lowOsc.frequency);
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(masterGain);
        masterGain.connect(ctx.destination);

        lowOsc.start();
        wobbleOsc.start();
        noiseSource.start();

        spinSoundRef.current = {
            ctx,
            masterGain,
            audioNodes: [masterGain, lowGain, wobbleGain, noiseFilter, noiseGain, lowOsc, wobbleOsc, noiseSource],
            stopNodes: [lowOsc, wobbleOsc, noiseSource],
        };
    }

    function fadeSpinSound(toValue: number, ms: number) {
        const nodes = spinSoundRef.current;
        if (!nodes) return;
        const now = nodes.ctx.currentTime;
        nodes.masterGain.gain.cancelScheduledValues(now);
        nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value, now);
        nodes.masterGain.gain.linearRampToValueAtTime(toValue, now + ms / 1000);
    }

    function stopSpinSound(ms = SPIN_AUDIO_FADE_OUT_MS) {
        const nodes = spinSoundRef.current;
        if (!nodes) return;
        fadeSpinSound(0, ms);
        trackTimeout(() => {
            const current = spinSoundRef.current;
            if (!current) return;
            for (const node of current.stopNodes) {
                try {
                    node.stop();
                } catch {
                    // noop
                }
            }
            for (const node of current.audioNodes) {
                try {
                    node.disconnect();
                } catch {
                    // noop
                }
            }
            spinSoundRef.current = null;
        }, ms + 20);
    }

    async function playClickSound() {
        const ctx = await ensureAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc.type = "square";
        osc.frequency.setValueAtTime(920, now);
        osc.frequency.exponentialRampToValueAtTime(420, now + 0.06);

        filter.type = "highpass";
        filter.frequency.value = 480;

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.16, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.onended = () => {
            osc.disconnect();
            filter.disconnect();
            gain.disconnect();
        };

        osc.start(now);
        osc.stop(now + 0.1);
    }

    function scheduleToneBurst(
        ctx: AudioContext,
        {
            startAt,
            duration,
            frequency,
            gainPeak,
            type = "triangle",
            slideTo,
        }: {
            startAt: number;
            duration: number;
            frequency: number;
            gainPeak: number;
            type?: OscillatorType;
            slideTo?: number;
        },
    ) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = type;
        osc.frequency.setValueAtTime(frequency, startAt);
        if (slideTo && slideTo > 0) {
            osc.frequency.exponentialRampToValueAtTime(slideTo, startAt + duration);
        }

        filter.type = "lowpass";
        filter.frequency.value = 3200;

        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(gainPeak, startAt + Math.min(0.04, duration * 0.28));
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.onended = () => {
            osc.disconnect();
            filter.disconnect();
            gain.disconnect();
        };

        osc.start(startAt);
        osc.stop(startAt + duration + 0.03);
    }

    function scheduleNoiseBurst(ctx: AudioContext, startAt: number, duration = 0.18) {
        const source = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        const noiseBuffer = noiseBufferRef.current ?? createNoiseBuffer(ctx, 500);
        noiseBufferRef.current = noiseBuffer;

        source.buffer = noiseBuffer;

        filter.type = "highpass";
        filter.frequency.value = 2600;
        filter.Q.value = 0.7;

        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        source.onended = () => {
            source.disconnect();
            filter.disconnect();
            gain.disconnect();
        };

        source.start(startAt);
        source.stop(startAt + duration + 0.03);
    }

    async function playResultTone(totalMs = RESULT_STING_MS) {
        const ctx = await ensureAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime + 0.02;
        const scale = Math.max(0.85, totalMs / RESULT_STING_MS);

        scheduleToneBurst(ctx, {
            startAt: now,
            duration: 0.24 * scale,
            frequency: 523.25,
            slideTo: 587.33,
            gainPeak: 0.09,
        });
        scheduleToneBurst(ctx, {
            startAt: now + 0.16 * scale,
            duration: 0.24 * scale,
            frequency: 659.25,
            slideTo: 698.46,
            gainPeak: 0.085,
        });
        scheduleToneBurst(ctx, {
            startAt: now + 0.34 * scale,
            duration: 0.32 * scale,
            frequency: 783.99,
            slideTo: 987.77,
            gainPeak: 0.09,
        });
        scheduleToneBurst(ctx, {
            startAt: now + 0.52 * scale,
            duration: 0.5 * scale,
            frequency: 1046.5,
            gainPeak: 0.1,
            type: "sine",
        });
        scheduleToneBurst(ctx, {
            startAt: now + 0.58 * scale,
            duration: 0.64 * scale,
            frequency: 1318.51,
            gainPeak: 0.05,
            type: "sine",
        });
        scheduleToneBurst(ctx, {
            startAt: now + 0.52 * scale,
            duration: 0.62 * scale,
            frequency: 783.99,
            gainPeak: 0.04,
            type: "triangle",
        });
        scheduleNoiseBurst(ctx, now + 0.56 * scale, 0.22 * scale);
        scheduleNoiseBurst(ctx, now + 0.86 * scale, 0.18 * scale);
    }

    async function handleSpin() {
        if (status !== "idle" || buttonPhase !== "visible") return;

        const accelMs = prefersReducedMotion ? 400 : 1000;
        const cruiseMs = prefersReducedMotion ? 800 : 3200;
        const decelMs = prefersReducedMotion ? 600 : 1800;
        const accelRot = prefersReducedMotion ? 1 : 2;
        const cruiseRot = prefersReducedMotion ? 1 : 4;

        void playClickSound();
        setStatus("spinning");
        setResult(null);
        setCtaVisible(false);
        setButtonPhase("fading");
        trackTimeout(() => setButtonPhase("gone"), BUTTON_FADE_OUT_MS);

        const claimed = await claimPrize();
        const selectedPrize = claimed.prize;

        if (claimed.replay) {
            setStatus("done");
            setButtonPhase("gone");
            setResult(selectedPrize);
            setCtaVisible(true);
            trackEvent("cadastro_wheel_spin_replay", {
                page: "/cadastro",
                claimSource: claimed.source,
                prizeId: selectedPrize.id,
                prizeName: selectedPrize.label,
            });
            return;
        }

        if (claimed.source === "local-lock") {
            trackEvent("cadastro_wheel_spin_local_lock", { page: "/cadastro" });
        }

        await startSpinSound();
        fadeSpinSound(0.08, 400);

        trackEvent("cadastro_wheel_spin_start", {
            page: "/cadastro",
            prizeCount: PRIZES.length,
        });

        let current = currentRotationRef.current;

        current += 360 * accelRot;
        setTransition(`transform ${accelMs}ms cubic-bezier(.42,0,1,1)`);
        setRotation(current);
        await wait(accelMs);

        current += 360 * cruiseRot;
        setTransition(`transform ${cruiseMs}ms linear`);
        setRotation(current);
        await wait(cruiseMs);

        current += targetOffsetForPrize(selectedPrize);
        setTransition(`transform ${decelMs}ms cubic-bezier(0,0,0.2,1)`);
        setRotation(current);
        await wait(decelMs);

        currentRotationRef.current = current;
        stopSpinSound(SPIN_AUDIO_FADE_OUT_MS);
        trackTimeout(() => {
            void playResultTone(RESULT_STING_MS);
        }, SPIN_AUDIO_FADE_OUT_MS + 40);

        setResult(selectedPrize);
        setStatus("done");
        trackTimeout(() => setCtaVisible(true), SPIN_AUDIO_FADE_OUT_MS + 40 + RESULT_STING_MS + BOOKING_EXTRA_DELAY_MS);

        trackEvent("cadastro_wheel_spin_complete", {
            page: "/cadastro",
            claimSource: claimed.source,
            prizeId: selectedPrize.id,
            prizeName: selectedPrize.label,
            finalAngle: current,
        });
    }

    function updateLeadField<K extends keyof CadastroLeadForm>(field: K, value: CadastroLeadForm[K]) {
        if (duplicateDetected) {
            setDuplicatePrize(null);
            setLeadError(null);
        }
        setLeadForm((current) => ({
            ...current,
            [field]: field === "phone" ? formatBrPhone(String(value)) : value,
        }));
    }

    async function handleLeadSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (leadSubmitting) return;
        setLeadAttempted(true);
        if (!canSubmitLead) return;
        setLeadError(null);
        setDuplicatePrize(null);

        const payload = {
            fullName: leadForm.fullName.trim(),
            phone: formatBrPhone(leadForm.phone),
            email: leadForm.email.trim().toLowerCase(),
            unitSlug: currentUnit?.slug ?? null,
        };

        setLeadSubmitting(true);
        let keepSubmittingState = false;
        try {
            const response = await fetch("/api/cadastro/lead", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            const resultPayload = (await response.json().catch(() => null)) as
                | { ok?: boolean; error?: string; duplicate?: boolean; prizeId?: number | null }
                | null;

            if (!response.ok || !resultPayload?.ok) {
                setLeadError("Não foi possível validar seu cadastro agora. Tente novamente.");
                return;
            }

            persistLeadForm(payload);
            setLeadForm(payload);
            trackEvent("cadastro_gate_submit", {
                page: "/cadastro",
                unitSlug: currentUnit?.slug ?? null,
                fullNameProvided: true,
                phoneDigits: normalizePhoneDigits(payload.phone).length,
                emailDomain: payload.email.split("@")[1] ?? null,
            });
            trackLeadConversion({
                source: "cadastro_gate",
                placement: "cadastro",
                unitSlug: currentUnit?.slug ?? null,
            });

            if (resultPayload.duplicate && typeof resultPayload.prizeId === "number") {
                setDuplicatePrize(findPrizeById(resultPayload.prizeId));
                setLeadError(DUPLICATE_LEAD_ERROR);
                setLeadGateOpen(false);
                setStatus("idle");
                setButtonPhase("hidden");
                setLoaderVisible(false);
                setCtaVisible(false);
                setResult(null);
                return;
            }

            keepSubmittingState = true;
            trackTimeout(() => {
                setLeadGateOpen(true);
                setLeadSubmitting(false);
            }, 420);
            return;
        } catch {
            setLeadError("Não foi possível validar seu cadastro agora. Tente novamente.");
        } finally {
            if (!keepSubmittingState) {
                setLeadSubmitting(false);
            }
        }
    }

    function handlePrizeWhatsappClick(prize: CadastroPrize, url: string) {
        trackEvent("cadastro_wheel_whatsapp_click", {
            page: "/cadastro",
            unitSlug: currentUnit?.slug ?? null,
            prizeId: prize.id,
            prizeName: prize.label,
            destination: "whatsapp",
            whatsappUrl: url,
        });
        trackLeadConversion({
            source: "cadastro_wheel",
            placement: "cadastro",
            unitSlug: currentUnit?.slug ?? null,
            prizeId: prize.id,
            prizeName: prize.label,
        });
    }

    function handleWhatsappClick() {
        if (!result || !whatsappUrl) return;
        handlePrizeWhatsappClick(result, whatsappUrl);
    }

    const statusLabel =
        buttonPhase === "hidden"
            ? "carregando..."
            : status === "idle"
              ? "pronto para girar"
              : status === "spinning"
                ? "sorteando..."
                : "prêmio revelado";

    return (
        <main className={styles.page}>
            <div className={styles.container}>
                <section className={styles.hero} aria-labelledby="cadastro-title">
                    <div className={styles.heroIntro}>
                        <h1 id="cadastro-title" className={styles.title}>
                            <span className={styles.titleLead}>Cadastre-se e </span>
                            <span>teste a sua sorte</span>!
                        </h1>
                        <p className={styles.subtitle}>
                            Preencha seus dados, gire a <strong>RODA DA BELEZA</strong> e revele o seu procedimento GRÁTIS!
                        </p>
                    </div>

                    <div className={styles.heroGrid}>
                        <section className={styles.wheelCard} aria-label="Roleta de prêmios">
                            {!cadastroUnitSelected ? (
                                <div className={styles.unitLockGate}>
                                    <div className={styles.leadGateIntro}>
                                        <span className={styles.resultEyebrow}>Selecione a unidade</span>
                                        <h2 className={styles.resultTitle}>Escolha uma unidade no topo para desbloquear o cadastro</h2>
                                        <p className={styles.resultText}>
                                            A dinâmica da campanha só é liberada depois que uma unidade é selecionada no cabeçalho.
                                            Quando isso acontecer, o cadastro básico aparece primeiro e só depois a roleta é carregada.
                                        </p>
                                    </div>
                                </div>
                            ) : duplicateDetected || !leadGateOpen ? (
                                <div
                                    className={[
                                        styles.leadGate,
                                        leadSubmitting ? styles.leadGateSubmitting : "",
                                    ]
                                        .filter(Boolean)
                                        .join(" ")}
                                >
                                    <form className={styles.leadForm} onSubmit={handleLeadSubmit} noValidate>
                                        <label className={styles.formField}>
                                            <span className={styles.formLabel}>Nome completo</span>
                                            <input
                                                type="text"
                                                value={leadForm.fullName}
                                                onChange={(event) => updateLeadField("fullName", event.target.value)}
                                                placeholder="Seu nome e sobrenome"
                                                autoComplete="name"
                                                className={`${styles.formInput} ${fullNameInvalid ? styles.formInputInvalid : ""}`}
                                                aria-invalid={fullNameInvalid}
                                                disabled={leadSubmitting}
                                            />
                                            {fullNameInvalid ? (
                                                <span className={styles.formError}>Informe nome e sobrenome.</span>
                                            ) : null}
                                        </label>

                                        <label className={styles.formField}>
                                            <span className={styles.formLabel}>Telefone</span>
                                            <input
                                                type="tel"
                                                value={leadForm.phone}
                                                onChange={(event) => updateLeadField("phone", event.target.value)}
                                                placeholder="(51) 99999-9999"
                                                autoComplete="tel"
                                                inputMode="tel"
                                                className={`${styles.formInput} ${phoneInvalid ? styles.formInputInvalid : ""}`}
                                                aria-invalid={phoneInvalid}
                                                disabled={leadSubmitting}
                                            />
                                            {phoneInvalid ? (
                                                <span className={styles.formError}>Informe um telefone válido com DDD.</span>
                                            ) : null}
                                        </label>

                                        <label className={styles.formField}>
                                            <span className={styles.formLabel}>E-mail</span>
                                            <input
                                                type="email"
                                                value={leadForm.email}
                                                onChange={(event) => updateLeadField("email", event.target.value)}
                                                placeholder="voce@email.com"
                                                autoComplete="email"
                                                inputMode="email"
                                                className={`${styles.formInput} ${emailInvalid ? styles.formInputInvalid : ""}`}
                                                aria-invalid={emailInvalid}
                                                disabled={leadSubmitting}
                                            />
                                            {emailInvalid ? (
                                                <span className={styles.formError}>Informe um e-mail válido.</span>
                                            ) : null}
                                        </label>

                                        <button
                                            type="submit"
                                            className={[
                                                styles.formSubmit,
                                                duplicateDetected ? styles.formSubmitError : "",
                                            ]
                                                .filter(Boolean)
                                                .join(" ")}
                                            disabled={leadSubmitting}
                                        >
                                            {leadSubmitting
                                                ? "Processando"
                                                : duplicateDetected
                                                  ? "Cadastro já realizado"
                                                  : "Cadastrar e RODAR ROLETA"}
                                        </button>
                                    </form>

                                    {leadError ? <p className={styles.formNoticeError}>{leadError}</p> : null}

                                    {duplicatePrize ? (
                                        <div className={styles.resultPanel} aria-live="polite">
                                            <span className={styles.resultEyebrow}>Prêmio restaurado</span>
                                            <h2 className={`${styles.resultTitle} ${styles.resultTitleVisible}`}>{duplicatePrize.label}</h2>
                                            <p className={`${styles.resultText} ${styles.resultDescription}`}>{duplicatePrize.description}</p>
                                            <p className={styles.resultText}>
                                                Localizamos um cadastro anterior com este prêmio já vinculado ao seu e-mail ou telefone.
                                            </p>

                                            {duplicateWhatsappUrl ? (
                                                <div className={`${styles.ctaRow} ${styles.ctaRowVisible}`}>
                                                    <a
                                                        href={duplicateWhatsappUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className={styles.ctaPrimary}
                                                        onClick={() => handlePrizeWhatsappClick(duplicatePrize, duplicateWhatsappUrl)}
                                                    >
                                                        Clique e agende
                                                    </a>
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>
                            ) : (
                                <div className={styles.wheelReveal}>
                                    <div className={styles.wheelStage}>
                                        <div className={styles.pointer} aria-hidden="true" />

                                        <div className={styles.wheelShell}>
                                            <div className={styles.wheelDisc} style={{ transform: `rotate(${rotation}deg)`, transition }}>
                                                {PRIZES.map((prize, index) => {
                                                    const deg = (360 / PRIZES.length) * index + 7;
                                                    return (
                                                        <span
                                                            key={prize.id}
                                                            className={styles.segmentLabel}
                                                            style={{ transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(-42%)` }}
                                                        >
                                                            {prize.id}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {loaderVisible ? (
                                            <div className={`${styles.centerDisc} ${styles.preloaderDisc}`} aria-hidden="true">
                                                <span className={styles.preloaderGlow} />
                                                <span className={styles.preloaderText}>Carregando</span>
                                            </div>
                                        ) : null}

                                        {buttonPhase !== "gone" && !result ? (
                                            <button
                                                type="button"
                                                className={[
                                                    styles.centerDisc,
                                                    styles.centerButton,
                                                    buttonPhase === "visible" ? styles.centerButtonVisible : "",
                                                    buttonPhase === "fading" ? styles.centerButtonFading : "",
                                                ]
                                                    .filter(Boolean)
                                                    .join(" ")}
                                                onClick={handleSpin}
                                                disabled={status === "spinning" || buttonPhase !== "visible"}
                                            >
                                                {status === "spinning" ? "Girando..." : "Gire agora"}
                                            </button>
                                        ) : null}

                                        {status === "done" && result ? (
                                            <div className={`${styles.centerDisc} ${styles.centerBadge}`} aria-hidden="true">
                                                <span>
                                                    <span className={styles.centerBadgeLabel}>Seu prêmio</span>
                                                    <span className={styles.centerBadgeValue}>{result.label}</span>
                                                </span>
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className={styles.statusRow}>
                                        <span className={styles.statusPill}>
                                            Status:&nbsp;<strong>{statusLabel}</strong>
                                        </span>
                                        <span className={styles.statusHint}>1 giro por acesso</span>
                                    </div>

                                    <div className={styles.resultPanel} aria-live="polite">
                                        {result ? (
                                            <>
                                                <span className={styles.resultEyebrow}>Prêmio revelado</span>
                                                <h2 className={`${styles.resultTitle} ${styles.resultTitleVisible}`}>{result.label}</h2>
                                                <p className={`${styles.resultText} ${styles.resultDescription}`}>{result.description}</p>
                                                <p className={styles.resultText}>
                                                    O prêmio já foi travado. Depois da vinheta, o botão de atendimento abre o WhatsApp com a
                                                    mensagem exata do prêmio sorteado.
                                                </p>

                                                {ctaVisible && whatsappUrl ? (
                                                    <div className={`${styles.ctaRow} ${styles.ctaRowVisible}`}>
                                                        <TrackedWhatsappLink
                                                            rawUrl={whatsappUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className={styles.ctaPrimary}
                                                            placement="cadastro"
                                                            unitSlug={currentUnit?.slug ?? null}
                                                            source="cadastro_wheel"
                                                            onClick={handleWhatsappClick}
                                                        >
                                                            Clique e agende
                                                        </TrackedWhatsappLink>
                                                    </div>
                                                ) : null}
                                            </>
                                        ) : (
                                            <>
                                                <span className={styles.resultEyebrow}>Como funciona</span>
                                                <h2 className={styles.resultTitle}>Gire a roleta para liberar o seu atendimento</h2>
                                                <p className={styles.resultText}>
                                                    Assim que o carregamento inicial terminar, o botão central é liberado. O prêmio aparece
                                                    após o giro completo e o CTA é exibido com atraso para manter a cadência da dinâmica.
                                                </p>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                        </section>

                        <aside className={styles.prizeCard}>
                            <h2 className={styles.prizeTitle}>Prêmios</h2>
                            <p className={styles.prizeLead}>Procedimentos selecionados especialmente para você!</p>
                            <ol className={styles.prizeGrid}>
                                {PRIZES.map((prize) => (
                                    <li key={prize.id} className={styles.prizeItem}>
                                        <span className={styles.prizeIndex}>{prize.id}</span>
                                        <span className={styles.prizeName}>{prize.label}</span>
                                    </li>
                                ))}
                            </ol>

                            <p className={styles.prizeFootnote}>
                                Cada prêmio abre um texto próprio no WhatsApp. O botão só aparece no fim da sequência de revelação.
                            </p>
                        </aside>
                    </div>
                </section>
            </div>
        </main>
    );
}
