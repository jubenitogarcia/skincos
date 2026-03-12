"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { trackLeadConversion } from "@/lib/conversions";
import { CADASTRO_WHEEL_PRIZES, type CadastroPrize } from "@/lib/cadastroWheelPrizes";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import styles from "./CadastroWheelExperience.module.css";

type SpinStatus = "idle" | "spinning" | "done";
type ButtonPhase = "hidden" | "visible" | "fading" | "gone";

type WheelStatusResponse =
    | { ok: true; locked: true; prizeId: number; expMs?: number }
    | { ok: true; locked: false; prizeId: null }
    | { ok: false; error: string };

type WheelSpinResponse =
    | { ok: true; prizeId: number; replay: boolean; expMs?: number }
    | { ok: false; error: string };

type SpinSoundNodes = {
    ctx: AudioContext;
    osc: OscillatorNode;
    gain: GainNode;
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
    const [status, setStatus] = useState<SpinStatus>("idle");
    const [buttonPhase, setButtonPhase] = useState<ButtonPhase>("hidden");
    const [loaderVisible, setLoaderVisible] = useState(true);
    const [rotation, setRotation] = useState(0);
    const [transition, setTransition] = useState("none");
    const [result, setResult] = useState<CadastroPrize | null>(null);
    const [ctaVisible, setCtaVisible] = useState(false);
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
    const currentRotationRef = useRef(0);
    const timeoutsRef = useRef<number[]>([]);
    const spinSoundRef = useRef<SpinSoundNodes | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);

    useEffect(() => {
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const sync = () => setPrefersReducedMotion(media.matches);
        sync();
        media.addEventListener("change", sync);
        return () => media.removeEventListener("change", sync);
    }, []);

    useEffect(() => {
        let active = true;

        async function gateReady() {
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
    }, []);

    useEffect(() => {
        const timeoutStore = timeoutsRef;
        const spinSound = spinSoundRef;
        const audioCtxStore = audioCtxRef;

        return () => {
            for (const timeout of timeoutStore.current) {
                window.clearTimeout(timeout);
            }
            if (spinSound.current) {
                try {
                    spinSound.current.osc.stop();
                } catch {
                    // noop
                }
                spinSound.current.osc.disconnect();
                spinSound.current.gain.disconnect();
                spinSound.current = null;
            }
            if (audioCtxStore.current) {
                void audioCtxStore.current.close();
                audioCtxStore.current = null;
            }
        };
    }, []);

    const whatsappUrl = useMemo(() => {
        if (!result) return null;
        return buildWhatsAppUrl(whatsappPhone, result.message);
    }, [result, whatsappPhone]);

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

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = 170;
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        spinSoundRef.current = { ctx, osc, gain };
    }

    function fadeSpinSound(toValue: number, ms: number) {
        const nodes = spinSoundRef.current;
        if (!nodes) return;
        const now = nodes.ctx.currentTime;
        nodes.gain.gain.cancelScheduledValues(now);
        nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
        nodes.gain.gain.linearRampToValueAtTime(toValue, now + ms / 1000);
    }

    function stopSpinSound(ms = SPIN_AUDIO_FADE_OUT_MS) {
        const nodes = spinSoundRef.current;
        if (!nodes) return;
        fadeSpinSound(0, ms);
        trackTimeout(() => {
            const current = spinSoundRef.current;
            if (!current) return;
            try {
                current.osc.stop();
            } catch {
                // noop
            }
            current.osc.disconnect();
            current.gain.disconnect();
            spinSoundRef.current = null;
        }, ms + 20);
    }

    async function playResultTone(totalMs = RESULT_STING_MS) {
        const ctx = await ensureAudioContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;
        const totalSec = totalMs / 1000;
        const attackSec = Math.min(0.12, totalSec / 5);
        const releaseSec = Math.min(0.16, totalSec / 4);
        const holdUntil = Math.max(now + attackSec, now + totalSec - releaseSec);

        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(620, now + Math.min(0.35, totalSec / 2));
        osc.frequency.exponentialRampToValueAtTime(480, now + totalSec);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.12, now + attackSec);
        gain.gain.setValueAtTime(0.12, holdUntil);
        gain.gain.linearRampToValueAtTime(0, now + totalSec);

        osc.start(now);
        osc.stop(now + totalSec + 0.05);
    }

    async function handleSpin() {
        if (status !== "idle" || buttonPhase !== "visible") return;

        const accelMs = prefersReducedMotion ? 400 : 1000;
        const cruiseMs = prefersReducedMotion ? 800 : 3200;
        const decelMs = prefersReducedMotion ? 600 : 1800;
        const accelRot = prefersReducedMotion ? 1 : 2;
        const cruiseRot = prefersReducedMotion ? 1 : 4;

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

    function handleWhatsappClick() {
        if (!result || !whatsappUrl) return;
        trackEvent("cadastro_wheel_whatsapp_click", {
            page: "/cadastro",
            prizeId: result.id,
            prizeName: result.label,
            destination: "whatsapp",
            whatsappUrl,
        });
        trackLeadConversion({
            source: "cadastro_wheel",
            placement: "cadastro",
            prizeId: result.id,
            prizeName: result.label,
        });
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
                        <span className={styles.eyebrow}>Roda da beleza</span>
                        <h1 id="cadastro-title" className={styles.title}>
                            teste a sua sorte e revele o seu prêmio
                        </h1>
                        <p className={styles.subtitle}>
                            A roleta mantém o comportamento da campanha original: gate de carregamento, animação em fases,
                            revelação com atraso real do CTA e mensagem individual por prêmio.
                        </p>
                    </div>

                    <div className={styles.heroGrid}>
                        <section className={styles.wheelCard} aria-label="Roleta de prêmios">
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
                                        <p className={styles.resultText}>
                                            O prêmio já foi travado. Depois da vinheta, o botão de atendimento abre o WhatsApp com a
                                            mensagem exata do prêmio sorteado.
                                        </p>

                                        {ctaVisible && whatsappUrl ? (
                                            <div className={`${styles.ctaRow} ${styles.ctaRowVisible}`}>
                                                <a
                                                    href={whatsappUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className={styles.ctaPrimary}
                                                    onClick={handleWhatsappClick}
                                                >
                                                    Clique e agende
                                                </a>
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
                        </section>

                        <aside className={styles.prizeCard}>
                            <h2 className={styles.prizeTitle}>Prêmios</h2>
                            <p className={styles.prizeLead}>A mesma lista da campanha, preservada no site principal.</p>

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
