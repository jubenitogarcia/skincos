"use client";

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
    BEAUTY_MOVEMENT_ACTS,
    BEAUTY_MOVEMENT_ACT_DEFINITIONS,
    type BeautyMovementAct,
    type BeautyMovementCard,
    type BeautyMovementPalette,
    type BeautyMovementSelections,
    buildBeautyMovementSummary,
    getBeautyMovementCard,
    getBeautyMovementCardsForAct,
    getBeautyMovementReading,
    normalizeBeautyMovementSelections,
} from "@/lib/beautyMovementCards";
import BeautyMovementWhatsappLink from "@/components/BeautyMovementWhatsappLink";
import BeautyMovementCardIllustration from "@/components/BeautyMovementCardIllustration";
import BrandMark from "@/components/BrandMark";
import type {
    BeautyMovementDiscountKind,
    BeautyMovementRewardType,
} from "@/lib/beautyMovementRewards";
import styles from "./BeautyMovementExperience.module.css";

export type BeautyMovementBenefit = {
    type: BeautyMovementRewardType;
    procedureName: string;
    discount: {
        kind: BeautyMovementDiscountKind;
        value: number;
        currency: "BRL";
    } | null;
    displayText: string;
    validity: string;
    rules: string;
    termsVersion: string;
};

export type BeautyMovementVelocity = {
    enabled: true;
    label: string;
    text: string;
};

export type BeautyMovementReveal = {
    /** One-based act position, matching the persisted D1 contract (1 = Beleza). */
    actIndex: number;
    cardId: string;
};

export type BeautyMovementCampaignCopy = {
    title?: string | null;
    description?: string | null;
    invitationTitle?: string | null;
    invitationText?: string | null;
    partnerName?: string | null;
    whatsappMessage?: string | null;
    whatsappLabel?: string | null;
    conditionsLabel?: string | null;
    conditionsText?: string | null;
};

export type BeautyMovementExperienceInitialState = {
    invite: {
        displayName?: string | null;
        maskedWhatsapp: string;
        emailRegistered?: boolean;
    };
    palette: BeautyMovementPalette;
    benefit: BeautyMovementBenefit | null;
    velocity: BeautyMovementVelocity | null;
    reveals: readonly BeautyMovementReveal[];
    confirmed: boolean;
    campaign: BeautyMovementCampaignCopy;
};

export type BeautyMovementRevealCommit =
    | void
    | {
          reveals?: readonly BeautyMovementReveal[];
      };

export type BeautyMovementConfirmationInput = {
    email: string | null;
    operationalConsent: true;
};

export type BeautyMovementConfirmationCommit =
    | void
    | {
          confirmed?: boolean;
      };

export type BeautyMovementTrackingParams = Record<string, string | number | boolean | null | undefined> &
    Partial<{
        actIndex: number;
        stage: "act" | "confirmation" | "result";
        method: "web_share" | "download";
    }>;

export type BeautyMovementExperienceProps = {
    initialState: BeautyMovementExperienceInitialState;
    onReveal?: (actIndex: number, cardId: string) => Promise<BeautyMovementRevealCommit> | BeautyMovementRevealCommit;
    onConfirm?: (
        input: BeautyMovementConfirmationInput,
    ) => Promise<BeautyMovementConfirmationCommit> | BeautyMovementConfirmationCommit;
    onTrack?: (event: string, params?: BeautyMovementTrackingParams) => void;
    /** Local-only harness: keeps the preview from opening the real WhatsApp redirect. */
    isLocalPreview?: boolean;
};

type HandStage = "waiting" | "ready" | "reveal" | "held" | "collect" | "deal" | "finale";
type FinaleStage = "hidden" | "collecting" | "confirmation" | "result";

type ShareNavigator = Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data?: ShareData) => Promise<void>;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;
const AUTO_ADVANCE_SECONDS = 5;
const HAND_REVEAL_MS = 1350;
const HAND_COLLECT_MS = 720;
const HAND_DEAL_MS = 880;
const HAND_FINALE_MS = 1120;

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function motionDuration(durationMs: number): number {
    return prefersReducedMotion() ? 0 : durationMs;
}

function getSelectionsFromReveals(
    palette: BeautyMovementPalette,
    reveals: readonly BeautyMovementReveal[],
): BeautyMovementSelections {
    const incoming = reveals.reduce<BeautyMovementSelections>((selections, reveal) => {
        const act = BEAUTY_MOVEMENT_ACTS[reveal.actIndex - 1];
        if (act && !selections[act]) {
            selections[act] = reveal.cardId;
        }
        return selections;
    }, {});

    return normalizeBeautyMovementSelections(palette, incoming);
}

function getCurrentActIndex(selections: BeautyMovementSelections): number {
    const index = BEAUTY_MOVEMENT_ACTS.findIndex((act) => !selections[act]);
    return index === -1 ? BEAUTY_MOVEMENT_ACTS.length : index;
}

function sanitizeEmail(value: string): string | null {
    const normalized = value.trim().toLowerCase();
    return normalized || null;
}

function isEmailValid(value: string): boolean {
    return value.length === 0 || EMAIL_PATTERN.test(value);
}

function formatRewardDiscount(discount: NonNullable<BeautyMovementBenefit["discount"]>): string {
    if (discount.kind === "percent") return `${discount.value}% de desconto`;
    return `R$ ${discount.value.toFixed(2).replace(".", ",")} de desconto`;
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.arcTo(x + width, y, x + width, y + height, safeRadius);
    context.arcTo(x + width, y + height, x, y + height, safeRadius);
    context.arcTo(x, y + height, x, y, safeRadius);
    context.arcTo(x, y, x + width, y, safeRadius);
    context.closePath();
}

function drawWrappedText(
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
): number {
    const words = text.split(/\s+/).filter(Boolean);
    let line = "";
    let currentY = y;

    for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && context.measureText(candidate).width > maxWidth) {
            context.fillText(line, x, currentY);
            currentY += lineHeight;
            line = word;
        } else {
            line = candidate;
        }
    }

    if (line) {
        context.fillText(line, x, currentY);
        currentY += lineHeight;
    }

    return currentY;
}

function getStoryCanvasFont(cssVariable: "--font-brand-ui" | "--font-brand-text", fallback: string): string {
    const probe = document.createElement("span");
    probe.style.fontFamily = `var(${cssVariable})`;
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    document.body.appendChild(probe);
    const fontFamily = window.getComputedStyle(probe).fontFamily.trim();
    probe.remove();
    return fontFamily && !fontFamily.includes("var(") ? fontFamily : fallback;
}

function drawStorySpark(context: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
    context.save();
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(x, y - size);
    context.lineTo(x, y + size);
    context.moveTo(x - size, y);
    context.lineTo(x + size, y);
    context.stroke();
    context.restore();
}

/** Keeps the shared Story in the same illustrated language as the chosen cards. */
function drawStoryCardIllustration(context: CanvasRenderingContext2D, cardId: string, centerX: number, centerY: number) {
    const ink = "#303030";
    const yellow = "#f5b301";
    const line = (fromX: number, fromY: number, toX: number, toY: number, color = ink, width = 4) => {
        context.beginPath();
        context.strokeStyle = color;
        context.lineWidth = width;
        context.lineCap = "round";
        context.moveTo(fromX, fromY);
        context.lineTo(toX, toY);
        context.stroke();
    };
    const dot = (x: number, y: number, radius = 4, color = ink) => {
        context.beginPath();
        context.fillStyle = color;
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
    };
    const ring = (x: number, y: number, radius: number, color = ink, width = 4) => {
        context.beginPath();
        context.strokeStyle = color;
        context.lineWidth = width;
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.stroke();
    };

    context.save();
    context.translate(centerX, centerY);
    context.scale(0.56, 0.56);
    context.lineJoin = "round";

    switch (cardId) {
        case "beleza-presenca":
            ring(0, 0, 43);
            ring(0, 0, 16);
            dot(0, 0, 5);
            context.beginPath();
            context.strokeStyle = yellow;
            context.lineWidth = 3;
            context.arc(0, 0, 58, -1.6, -0.1);
            context.stroke();
            dot(45, -38, 3, yellow);
            break;
        case "beleza-autocuidado":
            context.strokeStyle = ink;
            context.lineWidth = 4;
            context.strokeRect(-42, 9, 84, 25);
            context.beginPath();
            context.arc(0, 9, 31, Math.PI, 0);
            context.stroke();
            context.beginPath();
            context.moveTo(0, -22);
            context.quadraticCurveTo(-4, -42, 18, -52);
            context.quadraticCurveTo(18, -30, 0, -22);
            context.stroke();
            line(0, -22, 17, -51, yellow, 3);
            break;
        case "beleza-radiancia":
            ring(0, 0, 35);
            dot(0, 0, 20);
            for (let index = 0; index < 8; index += 1) {
                const angle = (index * Math.PI) / 4;
                line(Math.cos(angle) * 47, Math.sin(angle) * 47, Math.cos(angle) * 61, Math.sin(angle) * 61);
            }
            drawStorySpark(context, -50, 0, 6, yellow);
            break;
        case "beleza-autoria":
            context.beginPath();
            context.strokeStyle = ink;
            context.lineWidth = 4;
            context.ellipse(-3, 3, 46, 14, -0.67, 0, Math.PI * 2);
            context.stroke();
            line(-36, 28, 35, -35, yellow, 3);
            context.beginPath();
            context.moveTo(33, -39);
            context.lineTo(48, -52);
            context.lineTo(52, -34);
            context.lineTo(38, -23);
            context.closePath();
            context.stroke();
            break;
        case "beleza-harmonia":
            ring(-18, 0, 30);
            ring(18, 0, 30);
            dot(0, 0, 5);
            line(0, -44, 0, -56, yellow, 3);
            line(0, 44, 0, 56, yellow, 3);
            break;
        case "movimento-constancia":
            context.beginPath();
            context.strokeStyle = ink;
            context.lineWidth = 4;
            context.moveTo(-50, 31);
            context.lineTo(-20, 15);
            context.lineTo(8, -3);
            context.lineTo(38, -28);
            context.stroke();
            [-50, -20, 8, 38].forEach((x, index) => dot(x, [31, 15, -3, -28][index], index === 3 ? 5 : 4));
            line(-52, 42, 44, -32, yellow, 3);
            break;
        case "movimento-potencia":
            context.beginPath();
            context.strokeStyle = ink;
            context.lineWidth = 4;
            for (let index = 0; index < 10; index += 1) {
                const angle = -Math.PI / 2 + (index * Math.PI) / 5;
                const radius = index % 2 === 0 ? 49 : 23;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                if (index === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            }
            context.closePath();
            context.stroke();
            dot(0, 0, 8);
            drawStorySpark(context, 0, 56, 5, yellow);
            break;
        case "movimento-leveza":
            context.beginPath();
            context.strokeStyle = ink;
            context.lineWidth = 4;
            context.moveTo(-48, 20);
            context.quadraticCurveTo(-9, -49, 50, -33);
            context.quadraticCurveTo(12, -4, -48, 20);
            context.stroke();
            line(-37, 13, 34, -25, yellow, 3);
            drawStorySpark(context, 41, 34, 6, ink);
            break;
        case "movimento-ritmo":
            [-20, 0, 20].forEach((offset) => {
                context.beginPath();
                context.strokeStyle = ink;
                context.lineWidth = 4;
                context.moveTo(-54, offset);
                context.bezierCurveTo(-32, offset - 24, -12, offset + 24, 10, offset);
                context.bezierCurveTo(32, offset - 24, 42, offset + 12, 56, offset - 6);
                context.stroke();
            });
            dot(-36, -27, 4, yellow);
            dot(0, 1, 4);
            dot(37, 20, 4);
            break;
        case "movimento-sintonia":
            ring(0, 0, 16);
            ring(0, 0, 33);
            ring(0, 0, 50);
            dot(-50, 0, 4);
            dot(50, 0, 4);
            line(-64, 0, -55, 0, yellow, 3);
            line(55, 0, 64, 0, yellow, 3);
            break;
        case "celebracao-confianca":
            context.beginPath();
            context.strokeStyle = ink;
            context.lineWidth = 4;
            context.moveTo(0, -51);
            context.lineTo(40, -34);
            context.lineTo(40, 2);
            context.quadraticCurveTo(37, 33, 0, 54);
            context.quadraticCurveTo(-37, 33, -40, 2);
            context.lineTo(-40, -34);
            context.closePath();
            context.stroke();
            context.beginPath();
            context.arc(-9, 2, 11, 0, Math.PI);
            context.arc(9, 2, 11, 0, Math.PI);
            context.stroke();
            dot(0, 31, 3, yellow);
            break;
        case "celebracao-renovacao":
            context.beginPath();
            context.strokeStyle = ink;
            context.lineWidth = 4;
            context.arc(0, 0, 43, -1.7, 0.6);
            context.stroke();
            context.beginPath();
            context.arc(0, 0, 43, 1.45, 3.7);
            context.stroke();
            line(42, 14, 49, 27, yellow, 3);
            line(-42, -14, -49, -27, yellow, 3);
            context.beginPath();
            context.moveTo(0, 33);
            context.quadraticCurveTo(-7, 9, 16, -2);
            context.quadraticCurveTo(17, 20, 0, 33);
            context.stroke();
            break;
        case "celebracao-brilho":
        case "celebracao-impulso":
        case "celebracao-encontro":
        default:
            drawStorySpark(context, 0, 0, 45, ink);
            drawStorySpark(context, 0, 0, 27, yellow);
            dot(-43, 34, 3, yellow);
            dot(42, -34, 3, yellow);
    }

    context.restore();
}

function createStoryBlob(
    reading: ReturnType<typeof getBeautyMovementReading>,
    partnerName: string,
): Promise<Blob | null> {
    return new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width = STORY_WIDTH;
        canvas.height = STORY_HEIGHT;
        const context = canvas.getContext("2d");

        if (!context) {
            resolve(null);
            return;
        }

        context.fillStyle = "#FAFAFA";
        context.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
        context.fillStyle = "#303030";
        context.fillRect(0, 0, STORY_WIDTH, 20);
        context.fillRect(0, STORY_HEIGHT - 20, STORY_WIDTH, 20);

        context.strokeStyle = "#D0D0D0";
        context.lineWidth = 2;
        context.strokeRect(54, 54, STORY_WIDTH - 108, STORY_HEIGHT - 108);

        const uiFont = getStoryCanvasFont("--font-brand-ui", '"Eurostile", system-ui, sans-serif');
        const textFont = getStoryCanvasFont("--font-brand-text", '"Cicle Fina", system-ui, sans-serif');

        context.fillStyle = "#303030";
        context.font = `700 31px ${uiFont}`;
        context.fillText("ESPAÇO FACIAL", 102, 142);

        context.font = `700 66px ${uiFont}`;
        context.fillText("Cartas da", 102, 254);
        context.fillText("Beleza em Movimento", 102, 332);

        context.fillStyle = "#505050";
        context.font = `400 32px ${textFont}`;
        drawWrappedText(context, "Uma leitura editorial para acompanhar o seu momento.", 104, 408, 760, 45);

        const cardStartY = 612;
        const cardHeight = 258;
        const cardGap = 36;

        reading.slice(0, 3).forEach((line, index) => {
            const y = cardStartY + index * (cardHeight + cardGap);
            context.fillStyle = "#FFFFFF";
            roundedRect(context, 102, y, 876, cardHeight, 16);
            context.fill();

            context.strokeStyle = "#D0D0D0";
            context.lineWidth = 2;
            roundedRect(context, 102, y, 876, cardHeight, 16);
            context.stroke();

            context.fillStyle = "#505050";
            context.font = `700 24px ${uiFont}`;
            context.fillText(`${String(index + 1).padStart(2, "0")}  ${line.actLabel.toUpperCase()}`, 148, y + 62);

            context.fillStyle = "#303030";
            context.font = `700 55px ${uiFont}`;
            context.fillText(line.title, 148, y + 132);

            context.fillStyle = "#505050";
            context.font = `400 27px ${textFont}`;
            drawWrappedText(context, line.message, 148, y + 186, 570, 38);
            drawStoryCardIllustration(context, line.cardId, 852, y + 128);
        });

        context.fillStyle = "#303030";
        context.font = `700 36px ${uiFont}`;
        context.fillText("Beleza que se move com você.", 104, 1644);
        context.font = `400 26px ${textFont}`;
        context.fillStyle = "#505050";
        context.fillText(`Espaço Facial · com ${partnerName}`, 104, 1700);

        canvas.toBlob((blob) => resolve(blob), "image/png", 0.96);
    });
}

function downloadStory(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "cartas-da-beleza-em-movimento.png";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BeautyMovementExperience({
    initialState,
    onReveal,
    onConfirm,
    onTrack,
    isLocalPreview = false,
}: BeautyMovementExperienceProps) {
    const incomingSelections = useMemo(
        () => getSelectionsFromReveals(initialState.palette, initialState.reveals),
        [initialState.palette, initialState.reveals],
    );
    const initialReadingComplete = getCurrentActIndex(incomingSelections) >= BEAUTY_MOVEMENT_ACTS.length;
    const [selections, setSelections] = useState<BeautyMovementSelections>(incomingSelections);
    const [displayedActIndex, setDisplayedActIndex] = useState(() =>
        Math.min(getCurrentActIndex(incomingSelections), BEAUTY_MOVEMENT_ACTS.length - 1),
    );
    const [handStage, setHandStage] = useState<HandStage>(() =>
        initialState.confirmed || initialReadingComplete ? "ready" : "waiting",
    );
    const [confirmed, setConfirmed] = useState(initialState.confirmed);
    const [email, setEmail] = useState("");
    const [operationalConsent, setOperationalConsent] = useState(false);
    const [confirmationAttempted, setConfirmationAttempted] = useState(false);
    const [revealPendingCardId, setRevealPendingCardId] = useState<string | null>(null);
    const [isConfirming, setIsConfirming] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [shareStatus, setShareStatus] = useState<string | null>(null);
    const [finaleStage, setFinaleStage] = useState<FinaleStage>(() =>
        initialState.confirmed ? "result" : initialReadingComplete ? "confirmation" : "hidden",
    );
    const [autoAdvanceActive, setAutoAdvanceActive] = useState(false);
    const openedRef = useRef(false);
    const viewedActsRef = useRef(new Set<number>());
    const viewedResultRef = useRef(false);
    const conditionsOpenedRef = useRef(false);
    const autoAdvanceTimerRef = useRef<number | null>(null);
    const handTransitionTimerRef = useRef<number | null>(null);
    const scrollAnimationFrameRef = useRef<number | null>(null);
    const tableRef = useRef<HTMLElement | null>(null);
    const finaleRef = useRef<HTMLElement | null>(null);
    const selectionsRef = useRef(selections);
    const displayedActIndexRef = useRef(displayedActIndex);
    const handStageRef = useRef(handStage);
    const finaleStageRef = useRef(finaleStage);
    const revealInFlightRef = useRef(false);
    const transitionInFlightRef = useRef(false);
    const confirmInFlightRef = useRef(false);
    const mountedRef = useRef(true);

    useEffect(() => {
        selectionsRef.current = incomingSelections;
        setSelections(incomingSelections);
    }, [incomingSelections]);

    useEffect(() => {
        selectionsRef.current = selections;
    }, [selections]);

    useEffect(() => {
        displayedActIndexRef.current = displayedActIndex;
    }, [displayedActIndex]);

    useEffect(() => {
        handStageRef.current = handStage;
    }, [handStage]);

    useEffect(() => {
        finaleStageRef.current = finaleStage;
    }, [finaleStage]);

    useEffect(() => {
        if (initialState.confirmed) {
            setConfirmed(true);
            setCurrentFinaleStage("result");
        }
    }, [initialState.confirmed]);

    useEffect(() => {
        if (openedRef.current) return;
        openedRef.current = true;
        onTrack?.("beauty_movement_open", { stage: "act" });
    }, [onTrack]);

    useEffect(() => {
        if (viewedActsRef.current.has(displayedActIndex)) return;
        viewedActsRef.current.add(displayedActIndex);
        onTrack?.("beauty_movement_act_view", { actIndex: displayedActIndex + 1 });
    }, [displayedActIndex, onTrack]);

    useEffect(() => {
        if (finaleStage !== "result" || viewedResultRef.current) return;
        viewedResultRef.current = true;
        onTrack?.("beauty_movement_result_view", { stage: "result" });
    }, [finaleStage, onTrack]);

    useEffect(() => {
        if (finaleStage !== "confirmation" && finaleStage !== "result") return;
        window.requestAnimationFrame(() => {
            finaleRef.current?.focus({ preventScroll: true });
        });
    }, [finaleStage]);

    useEffect(() => {
        return () => {
            mountedRef.current = false;
            if (autoAdvanceTimerRef.current !== null) {
                window.clearTimeout(autoAdvanceTimerRef.current);
            }
            if (handTransitionTimerRef.current !== null) {
                window.clearTimeout(handTransitionTimerRef.current);
            }
            if (scrollAnimationFrameRef.current !== null) {
                window.cancelAnimationFrame(scrollAnimationFrameRef.current);
            }
        };
    }, []);

    const reading = useMemo(
        () => getBeautyMovementReading(initialState.palette, selections),
        [initialState.palette, selections],
    );
    const emailValue = sanitizeEmail(email) ?? "";
    const emailInvalid = confirmationAttempted && !isEmailValid(emailValue);
    const emailAlreadyRegistered = initialState.invite.emailRegistered === true;
    const consentInvalid = confirmationAttempted && !operationalConsent;
    const partnerName = initialState.campaign.partnerName?.trim() || "Velocity";
    const primaryWhatsappLabel = initialState.campaign.whatsappLabel?.trim() || "Falar com a equipe";
    const invitationTitle = initialState.campaign.invitationTitle?.trim() || "Seu convite para celebrar";
    const invitationText =
        initialState.campaign.invitationText?.trim() ||
        "A equipe da Espaço Facial Novo Hamburgo vai confirmar os próximos detalhes com você.";
    const hasCourtesyClass = initialState.velocity?.enabled === true;

    function setCurrentSelections(next: BeautyMovementSelections | ((current: BeautyMovementSelections) => BeautyMovementSelections)) {
        setSelections((current) => {
            const resolved = typeof next === "function" ? next(current) : next;
            selectionsRef.current = resolved;
            return resolved;
        });
    }

    function setCurrentActIndex(next: number) {
        displayedActIndexRef.current = next;
        setDisplayedActIndex(next);
    }

    function setCurrentHandStage(next: HandStage) {
        handStageRef.current = next;
        setHandStage(next);
    }

    function setCurrentFinaleStage(next: FinaleStage) {
        finaleStageRef.current = next;
        setFinaleStage(next);
    }

    function isActUnlocked(index: number): boolean {
        return index === 0 || Boolean(selectionsRef.current[BEAUTY_MOVEMENT_ACTS[index - 1]]);
    }

    function cancelAutoAdvance() {
        if (autoAdvanceTimerRef.current !== null) {
            window.clearTimeout(autoAdvanceTimerRef.current);
            autoAdvanceTimerRef.current = null;
        }
        setAutoAdvanceActive(false);
    }

    function cancelScrollAnimation() {
        if (scrollAnimationFrameRef.current !== null) {
            window.cancelAnimationFrame(scrollAnimationFrameRef.current);
            scrollAnimationFrameRef.current = null;
        }
    }

    function scrollToElement(target: HTMLElement | null) {
        cancelScrollAnimation();
        if (!target) return;

        if (prefersReducedMotion()) {
            target.scrollIntoView({ behavior: "auto", block: "start" });
            return;
        }

        const startTop = window.scrollY;
        const targetTop = Math.max(0, startTop + target.getBoundingClientRect().top - 32);
        const distance = targetTop - startTop;
        const duration = Math.min(1040, Math.max(680, Math.abs(distance) * 0.55));
        const startedAt = performance.now();
        const easeInOut = (progress: number) =>
            progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        const animate = (now: number) => {
            const progress = Math.min(1, (now - startedAt) / duration);
            window.scrollTo(0, startTop + distance * easeInOut(progress));
            if (progress < 1) {
                scrollAnimationFrameRef.current = window.requestAnimationFrame(animate);
            } else {
                scrollAnimationFrameRef.current = null;
            }
        };

        scrollAnimationFrameRef.current = window.requestAnimationFrame(animate);
    }

    function scrollToTable() {
        cancelAutoAdvance();
        scrollToElement(tableRef.current);
    }

    function scrollToFinale() {
        scrollToElement(finaleRef.current);
    }

    function clearHandTransition() {
        if (handTransitionTimerRef.current !== null) {
            window.clearTimeout(handTransitionTimerRef.current);
            handTransitionTimerRef.current = null;
        }
    }

    function startInitialDeal() {
        if (handStageRef.current !== "waiting" || finaleStageRef.current !== "hidden" || transitionInFlightRef.current) return;

        transitionInFlightRef.current = true;
        clearHandTransition();
        setCurrentHandStage("deal");
        handTransitionTimerRef.current = window.setTimeout(() => {
            handTransitionTimerRef.current = null;
            if (!mountedRef.current) return;
            transitionInFlightRef.current = false;
            setCurrentHandStage("ready");
        }, motionDuration(HAND_DEAL_MS));
    }

    function handleDeckKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
        if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;

        // Some embedded browsers focus the native button but do not synthesize its click.
        // Prevent the default activation so physical browsers do not invoke the deal twice.
        event.preventDefault();
        startInitialDeal();
    }

    function beginFinale() {
        if (handStageRef.current !== "held" || finaleStageRef.current !== "hidden" || transitionInFlightRef.current) return;

        transitionInFlightRef.current = true;
        cancelAutoAdvance();
        clearHandTransition();
        setCurrentHandStage("collect");
        handTransitionTimerRef.current = window.setTimeout(() => {
            if (!mountedRef.current) return;
            setCurrentHandStage("finale");
            setCurrentFinaleStage("collecting");
            handTransitionTimerRef.current = window.setTimeout(() => {
                handTransitionTimerRef.current = null;
                if (!mountedRef.current) return;
                transitionInFlightRef.current = false;
                setCurrentHandStage("ready");
                setCurrentFinaleStage(confirmed ? "result" : "confirmation");
                window.requestAnimationFrame(() => {
                    window.requestAnimationFrame(scrollToFinale);
                });
            }, motionDuration(HAND_FINALE_MS));
        }, motionDuration(HAND_COLLECT_MS));
    }

    function moveToNextHand(index: number) {
        if (handStageRef.current !== "held" || transitionInFlightRef.current || finaleStageRef.current !== "hidden") return;
        cancelAutoAdvance();
        const nextIndex = index + 1;
        if (nextIndex >= BEAUTY_MOVEMENT_ACTS.length) {
            beginFinale();
            return;
        }

        transitionInFlightRef.current = true;
        clearHandTransition();
        setCurrentHandStage("collect");
        handTransitionTimerRef.current = window.setTimeout(() => {
            if (!mountedRef.current) return;
            setCurrentActIndex(nextIndex);
            setCurrentHandStage("deal");
            handTransitionTimerRef.current = window.setTimeout(() => {
                handTransitionTimerRef.current = null;
                if (!mountedRef.current) return;
                transitionInFlightRef.current = false;
                setCurrentHandStage("ready");
            }, motionDuration(HAND_DEAL_MS));
        }, motionDuration(HAND_COLLECT_MS));
    }

    function scheduleNextHand(index: number) {
        if (prefersReducedMotion()) return;
        cancelAutoAdvance();
        setAutoAdvanceActive(true);
        autoAdvanceTimerRef.current = window.setTimeout(() => {
            autoAdvanceTimerRef.current = null;
            setAutoAdvanceActive(false);
            moveToNextHand(index);
        }, AUTO_ADVANCE_SECONDS * 1000);
    }

    async function handleReveal(actIndex: number, card: BeautyMovementCard) {
        const act = BEAUTY_MOVEMENT_ACTS[actIndex];
        const pendingKey = `${actIndex}:${card.id}`;
        if (
            !act ||
            actIndex !== displayedActIndexRef.current ||
            handStageRef.current !== "ready" ||
            !isActUnlocked(actIndex) ||
            selectionsRef.current[act] ||
            revealInFlightRef.current
        ) return;

        revealInFlightRef.current = true;
        setActionError(null);
        setRevealPendingCardId(pendingKey);

        try {
            const commit = await onReveal?.(actIndex + 1, card.id);
            if (!mountedRef.current) return;
            const committedSelections =
                commit && typeof commit === "object" && Array.isArray(commit.reveals)
                    ? getSelectionsFromReveals(initialState.palette, commit.reveals)
                    : null;

            setCurrentSelections((current) => ({
                ...current,
                ...(committedSelections ?? {}),
                [act]: committedSelections?.[act] ?? card.id,
            }));
            clearHandTransition();
            setCurrentHandStage("reveal");
            handTransitionTimerRef.current = window.setTimeout(() => {
                handTransitionTimerRef.current = null;
                if (!mountedRef.current) return;
                setCurrentHandStage("held");
                scheduleNextHand(actIndex);
            }, motionDuration(HAND_REVEAL_MS));
            onTrack?.("beauty_movement_card_revealed", { actIndex: actIndex + 1 });
        } catch {
            if (mountedRef.current) {
                setActionError("Não foi possível guardar esta escolha. Tente novamente em instantes.");
            }
        } finally {
            revealInFlightRef.current = false;
            if (mountedRef.current) setRevealPendingCardId(null);
        }
    }

    async function handleConfirm() {
        if (confirmInFlightRef.current || finaleStageRef.current !== "confirmation") return;
        setConfirmationAttempted(true);
        setActionError(null);

        if (!operationalConsent || !isEmailValid(emailValue)) return;

        confirmInFlightRef.current = true;
        setIsConfirming(true);
        try {
            await onConfirm?.({
                email: emailValue || null,
                operationalConsent: true,
            });
            if (!mountedRef.current) return;
            setConfirmed(true);
            setCurrentFinaleStage("result");
            onTrack?.("beauty_movement_confirmed", { stage: "confirmation" });
        } catch {
            if (mountedRef.current) {
                setActionError("Não foi possível confirmar sua entrada agora. Tente novamente em instantes.");
            }
        } finally {
            confirmInFlightRef.current = false;
            if (mountedRef.current) setIsConfirming(false);
        }
    }

    function handleWhatsappClick() {
        onTrack?.("beauty_movement_whatsapp", { stage: "result" });
        if (isLocalPreview) {
            setShareStatus("Prévia local: a abertura do WhatsApp foi simulada.");
        }
    }

    function handleConditionsClick() {
        if (conditionsOpenedRef.current) return;
        conditionsOpenedRef.current = true;
        onTrack?.("beauty_movement_conditions_open", { stage: "result" });
    }

    async function handleShare() {
        if (reading.length !== BEAUTY_MOVEMENT_ACTS.length) return;

        setShareStatus(null);
        const blob = await createStoryBlob(reading, partnerName);
        if (!blob) {
            setShareStatus("Não foi possível preparar o Story neste navegador.");
            return;
        }

        const shareNavigator = navigator as ShareNavigator;

        try {
            const storyFile = new File([blob], "cartas-da-beleza-em-movimento.png", { type: "image/png" });
            const shareData: ShareData = {
                files: [storyFile],
                title: "Cartas da Beleza em Movimento",
                text: "Cartas da Beleza em Movimento · Espaço Facial",
            };
            if (shareNavigator.share && (!shareNavigator.canShare || shareNavigator.canShare(shareData))) {
                await shareNavigator.share(shareData);
                setShareStatus("Story compartilhado.");
                onTrack?.("beauty_movement_share", { stage: "result", method: "web_share" });
                return;
            }

            downloadStory(blob);
            setShareStatus("Seu Story foi preparado para publicar.");
            onTrack?.("beauty_movement_share", { stage: "result", method: "download" });
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                setShareStatus("Compartilhamento cancelado.");
                return;
            }

            downloadStory(blob);
            setShareStatus("Seu Story foi preparado para publicar.");
            onTrack?.("beauty_movement_share", { stage: "result", method: "download" });
        }
    }

    const tableAct = BEAUTY_MOVEMENT_ACTS[displayedActIndex] ?? BEAUTY_MOVEMENT_ACTS[0];
    const tableDefinition = BEAUTY_MOVEMENT_ACT_DEFINITIONS[displayedActIndex] ?? BEAUTY_MOVEMENT_ACT_DEFINITIONS[0];
    const tableCards = getBeautyMovementCardsForAct(initialState.palette, tableAct);
    const tableSelectedCardId = selections[tableAct];
    const tableSelected = Boolean(tableSelectedCardId);
    const nextDefinition = BEAUTY_MOVEMENT_ACT_DEFINITIONS[displayedActIndex + 1];
    const tableIsUnlocked = isActUnlocked(displayedActIndex);
    const waitingForInitialDeal = handStage === "waiting" && finaleStage === "hidden";

    function renderCard(card: BeautyMovementCard, cardIndex: number) {
        const pendingKey = `${displayedActIndex}:${card.id}`;
        const isPending = revealPendingCardId === pendingKey;
        const isSelected = tableSelectedCardId === card.id;

        return (
            <button
                type="button"
                className={`${styles.cardButton} ${isPending ? styles.cardButtonPending : ""} ${isSelected ? styles.cardButtonSelected : ""}`.trim()}
                key={card.id}
                onClick={() => void handleReveal(displayedActIndex, card)}
                disabled={!tableIsUnlocked || handStage !== "ready" || Boolean(revealPendingCardId) || tableSelected}
                aria-busy={isPending || undefined}
                aria-pressed={isSelected}
                aria-label={`${isSelected ? "Carta revelada" : "Revelar carta"} ${cardIndex + 1} de ${tableDefinition.label}`}
            >
                <span className={styles.cardInner}>
                    <span className={`${styles.cardFace} ${styles.cardFront}`}>
                        <span className={styles.cardBrandMark} aria-hidden="true">
                            <BrandMark className={styles.cardBrandLogo} tone="light" title="" />
                        </span>
                        <span className={styles.cardPrompt}>
                            {isPending ? "Guardando escolha" : tableIsUnlocked ? "Revelar carta" : "Bloqueada"}
                        </span>
                    </span>
                    <span className={`${styles.cardFace} ${styles.cardBack}`} aria-hidden={!isSelected}>
                        <span className={styles.cardIllustration} aria-hidden="true">
                            <BeautyMovementCardIllustration cardId={card.id} />
                        </span>
                        <span className={styles.cardActLabel}>{tableDefinition.label}</span>
                        <strong>{card.title}</strong>
                        <span>{card.shortMessage}</span>
                    </span>
                </span>
                <span className={styles.cardSparkles} aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                </span>
            </button>
        );
    }

    function renderFinaleCard(line: ReturnType<typeof getBeautyMovementReading>[number]) {
        const card = getBeautyMovementCard(initialState.palette, selections[line.act]);
        if (!card) return null;

        return (
            <article className={styles.finaleCard} key={line.act}>
                <div className={styles.finaleCardFace}>
                    <span className={styles.finaleCardIllustration} aria-hidden="true">
                        <BeautyMovementCardIllustration cardId={card.id} />
                    </span>
                    <span className={styles.finaleCardAct}>{line.actLabel}</span>
                    <strong>{line.title}</strong>
                </div>
            </article>
        );
    }

    function renderConfirmationStage() {
        return (
            <section className={styles.confirmationStage} aria-labelledby="beauty-movement-inline-confirmation-title">
                <div className={styles.confirmationIntro}>
                    <h2 id="beauty-movement-inline-confirmation-title">Confirme sua entrada na lista exclusiva.</h2>
                    <p>Seus dados de contato já estão vinculados a este convite.</p>
                </div>

                <section className={styles.benefitPanel} aria-labelledby="beauty-movement-inline-confirmation-benefit-title">
                    <p className={styles.sectionLabel}>Seu presente de celebração</p>
                    <h3 id="beauty-movement-inline-confirmation-benefit-title">Seu presente será revelado após a confirmação.</h3>
                    <p>A condição desta experiência está vinculada ao seu convite.</p>
                    <p className={styles.benefitNote}>
                        As cartas criam a leitura; elas não sorteiam nem alteram o presente reservado.
                    </p>
                </section>

                <div className={styles.contactSummary}>
                    <span>Contato vinculado</span>
                    <strong>{initialState.invite.maskedWhatsapp}</strong>
                    <small>Para corrigir dados, fale diretamente com a unidade.</small>
                </div>

                <div className={styles.confirmationForm}>
                    <label className={styles.formField} htmlFor="beauty-movement-inline-email">
                        <span>
                            E-mail <em>opcional</em>
                        </span>
                        <input
                            id="beauty-movement-inline-email"
                            type="email"
                            autoComplete="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            disabled={emailAlreadyRegistered}
                            aria-invalid={emailInvalid || undefined}
                            aria-describedby={emailInvalid ? "beauty-movement-inline-email-error" : undefined}
                            placeholder="voce@email.com"
                        />
                    </label>
                    {emailAlreadyRegistered ? (
                        <p className={styles.fieldHint}>
                            E-mail já cadastrado. Para corrigir dados, fale diretamente com a unidade.
                        </p>
                    ) : null}
                    {emailInvalid ? (
                        <p className={styles.fieldError} id="beauty-movement-inline-email-error">
                            Confira o formato do e-mail ou deixe este campo em branco.
                        </p>
                    ) : null}

                    <label className={`${styles.consentField} ${consentInvalid ? styles.consentFieldInvalid : ""}`.trim()}>
                        <input
                            type="checkbox"
                            checked={operationalConsent}
                            onChange={(event) => setOperationalConsent(event.target.checked)}
                        />
                        <span>
                            Aceito entrar na lista exclusiva e receber comunicações operacionais sobre este evento.
                        </span>
                    </label>
                    {consentInvalid ? <p className={styles.fieldError}>Confirme o aceite para seguir.</p> : null}

                    {actionError ? <p className={styles.inlineError} role="alert">{actionError}</p> : null}

                    <button
                        className={styles.primaryButton}
                        type="button"
                        onClick={() => void handleConfirm()}
                        disabled={isConfirming}
                    >
                        {isConfirming ? "Confirmando…" : "Confirmar minha entrada"}
                    </button>
                </div>
            </section>
        );
    }

    function renderResultStage() {
        return (
            <section className={styles.resultStage} aria-labelledby="beauty-movement-inline-result-title">
                <div className={styles.resultLead}>
                    <h2 id="beauty-movement-inline-result-title">{buildBeautyMovementSummary(reading)}</h2>
                    <p>As cartas formam a leitura da celebração. O benefício reservado foi configurado previamente para este convite.</p>
                </div>

                <section className={styles.invitationPanel} aria-labelledby="beauty-movement-inline-invitation-title">
                    <p className={styles.sectionLabel}>Convite</p>
                    <h3 id="beauty-movement-inline-invitation-title">{invitationTitle}</h3>
                    <p>{invitationText}</p>
                </section>

                <section className={styles.benefitPanel} aria-labelledby="beauty-movement-inline-benefit-title">
                    <p className={styles.sectionLabel}>Seu cuidado</p>
                    {initialState.benefit ? (
                        <>
                            <h3 id="beauty-movement-inline-benefit-title">
                                {initialState.benefit.type === "free_procedure"
                                    ? "Procedimento reservado para você."
                                    : "Condição especial reservada para você."}
                            </h3>
                            <p className={styles.benefitProcedure}>{initialState.benefit.procedureName}</p>
                            <p>{initialState.benefit.displayText}</p>
                            {initialState.benefit.discount ? (
                                <p className={styles.benefitDiscount}>{formatRewardDiscount(initialState.benefit.discount)}</p>
                            ) : (
                                <p className={styles.benefitDiscount}>Cortesia de celebração</p>
                            )}
                            <p className={styles.benefitMeta}>{initialState.benefit.validity}</p>
                            <p className={styles.benefitRules}>{initialState.benefit.rules}</p>
                        </>
                    ) : (
                        <>
                            <h3 id="beauty-movement-inline-benefit-title">Seu benefício reservado será confirmado pela equipe.</h3>
                            <p>Confira os detalhes diretamente com a unidade de Novo Hamburgo.</p>
                        </>
                    )}
                    <p className={styles.benefitNote}>
                        Esta condição foi definida antes da sua leitura e não depende das cartas escolhidas.
                    </p>
                    {initialState.campaign.conditionsText?.trim() ? (
                        <details
                            className={styles.conditionsDetails}
                            onToggle={(event) => {
                                if (event.currentTarget.open) handleConditionsClick();
                            }}
                        >
                            <summary>{initialState.campaign.conditionsLabel?.trim() || "Ler condições da campanha"}</summary>
                            <p>{initialState.campaign.conditionsText.trim()}</p>
                        </details>
                    ) : null}
                    {initialState.benefit?.termsVersion ? (
                        <small className={styles.termsVersion}>Condições da campanha: versão {initialState.benefit.termsVersion}</small>
                    ) : null}
                </section>

                {hasCourtesyClass && initialState.velocity ? (
                    <section className={styles.benefitPanel} aria-labelledby="beauty-movement-inline-velocity-title">
                        <p className={styles.sectionLabel}>Seu movimento</p>
                        <h3 id="beauty-movement-inline-velocity-title">{initialState.velocity.label}</h3>
                        <p>{initialState.velocity.text}</p>
                    </section>
                ) : null}

                <div className={styles.resultActions}>
                    {isLocalPreview ? (
                        <button className={styles.primaryButton} type="button" onClick={handleWhatsappClick}>
                            {primaryWhatsappLabel}
                        </button>
                    ) : initialState.campaign.whatsappMessage?.trim() ? (
                        <BeautyMovementWhatsappLink
                            className={styles.primaryButton}
                            message={initialState.campaign.whatsappMessage.trim()}
                            placement="result"
                            onClick={handleWhatsappClick}
                        >
                            {primaryWhatsappLabel}
                        </BeautyMovementWhatsappLink>
                    ) : (
                        <button className={styles.primaryButton} type="button" disabled>
                            {primaryWhatsappLabel}
                        </button>
                    )}
                    <button className={styles.secondaryButton} type="button" onClick={() => void handleShare()}>
                        Preparar Story para compartilhar
                    </button>
                </div>
                <p className={styles.shareNote}>O Story mostra apenas as três cartas e a assinatura das marcas.</p>
                {shareStatus ? <p className={styles.shareStatus} role="status">{shareStatus}</p> : null}
            </section>
        );
    }

    return (
        <main className={styles.page}>
            <div className={styles.backgroundOrbOne} aria-hidden="true" />
            <div className={styles.backgroundOrbTwo} aria-hidden="true" />

            <section className={styles.shell} aria-labelledby="beauty-movement-title">
                <header className={styles.hero}>
                    <div className={styles.brandLine} aria-label={`Espaço Facial em parceria com ${partnerName}`}>
                        <span>Espaço Facial</span>
                        <span className={styles.brandDivider} aria-hidden="true">
                            ×
                        </span>
                        <span className={styles.partnerName}>{partnerName}</span>
                    </div>
                    <h1 id="beauty-movement-title">{initialState.campaign.title?.trim() || "Beleza que se move com você."}</h1>
                    <p className={styles.heroCopy}>
                        {initialState.campaign.description?.trim() ||
                            "Cartas da Beleza em Movimento celebra os 3 anos da Espaço Facial Novo Hamburgo."}
                    </p>
                </header>

                <ol className={styles.progress} aria-label="Progresso da experiência">
                    {BEAUTY_MOVEMENT_ACT_DEFINITIONS.map((act, index) => {
                        const isDone = Boolean(selections[act.id]);
                        const isCurrent = index === displayedActIndex;
                        const isLocked = !isActUnlocked(index);
                        return (
                            <li
                                className={`${styles.progressItem} ${isDone ? styles.progressItemDone : ""} ${isCurrent ? styles.progressItemCurrent : ""}`.trim()}
                                key={act.id}
                            >
                                <button
                                    className={styles.progressButton}
                                    type="button"
                                    onClick={scrollToTable}
                                    disabled={!isCurrent}
                                    aria-current={isCurrent ? "step" : undefined}
                                    aria-label={`Acompanhar a mesa de cartas em ${act.label}${isLocked ? ", ainda bloqueada" : ""}`}
                                >
                                    <span className={styles.progressCopy}>
                                        <strong>{act.label}</strong>
                                        <small>{isDone ? "Escolha guardada" : act.progressLabel}</small>
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ol>

                <section
                    ref={tableRef}
                    className={styles.tableStage}
                    id="mesa-de-cartas"
                    aria-labelledby="table-stage-title"
                    data-hand-stage={handStage}
                    data-act-index={displayedActIndex}
                >
                    <div className={styles.actHeading}>
                        <h2 id="table-stage-title">{tableDefinition.label}</h2>
                        <p>{tableDefinition.prompt}</p>
                    </div>

                    <div
                        className={styles.tableSurface}
                        data-deck-state={
                            waitingForInitialDeal
                                ? "waiting"
                                : finaleStage === "confirmation" || finaleStage === "result"
                                  ? "final"
                                  : "ready"
                        }
                    >
                        <button
                            className={styles.deckStage}
                            type="button"
                            onClick={startInitialDeal}
                            onKeyDown={handleDeckKeyDown}
                            disabled={!waitingForInitialDeal}
                            aria-describedby={waitingForInitialDeal ? "beauty-movement-deck-prompt" : undefined}
                            aria-label="Clique no baralho para distribuir as cartas"
                        >
                            <span className={`${styles.deckCard} ${styles.deckCardUnder}`} />
                            <span className={`${styles.deckCard} ${styles.deckCardMiddle}`} />
                            <span className={`${styles.deckCard} ${styles.deckCardTop}`}>
                                <BrandMark className={styles.deckBrandLogo} tone="light" title="" />
                            </span>
                        </button>
                        {waitingForInitialDeal ? (
                            <span
                                className={styles.deckPrompt}
                                id="beauty-movement-deck-prompt"
                                role="note"
                            >
                                Clique no baralho <span aria-hidden="true">↗</span>
                            </span>
                        ) : null}
                        {finaleStage === "collecting" ? (
                            <div className={styles.finaleCardGrid} aria-hidden="true">
                                {reading.map(renderFinaleCard)}
                            </div>
                        ) : finaleStage === "confirmation" || finaleStage === "result" ? (
                            <div className={`${styles.finaleCardGrid} ${styles.finaleCardGridSettled}`} role="group" aria-label="Cartas finais">
                                {reading.map(renderFinaleCard)}
                            </div>
                        ) : finaleStage === "hidden" && !waitingForInitialDeal ? (
                            <div className={styles.cardGrid} role="group" aria-label={`Cartas da etapa ${tableDefinition.label}`}>
                                {tableCards.map(renderCard)}
                            </div>
                        ) : null}
                    </div>

                    {finaleStage === "hidden" && tableIsUnlocked && tableSelected ? (
                        <div className={styles.actAdvance}>
                            <p className={styles.advanceNote} role="status">
                                Carta revelada. As outras cartas serão recolhidas antes da próxima mão.
                            </p>
                            {autoAdvanceActive ? (
                                <div className={styles.autoAdvance} role="status" aria-live="polite">
                                    <span className={styles.autoAdvanceLabel}>
                                        {nextDefinition ? "Próxima mão" : "Confirmação"}
                                    </span>
                                    <span className={styles.autoAdvanceHint}>
                                        Você pode continuar antes pelo botão.
                                    </span>
                                    <span className={styles.srOnly}>
                                        {nextDefinition ? "Próxima mão" : "Confirmação"} automática em {AUTO_ADVANCE_SECONDS} segundos.
                                    </span>
                                </div>
                            ) : null}
                            {nextDefinition ? (
                                <button
                                    className={styles.continueButton}
                                    type="button"
                                    onClick={() => moveToNextHand(displayedActIndex)}
                                    disabled={handStage !== "held"}
                                >
                                    Continuar para {nextDefinition.label}
                                </button>
                            ) : (
                                <button
                                    className={styles.continueButton}
                                    type="button"
                                    onClick={beginFinale}
                                    disabled={handStage !== "held"}
                                >
                                    Continuar para confirmar
                                </button>
                            )}
                        </div>
                    ) : null}
                </section>

                {actionError && finaleStage === "hidden" ? (
                    <p className={styles.inlineError} role="alert">
                        {actionError}
                    </p>
                ) : null}

                {finaleStage === "confirmation" || finaleStage === "result" ? (
                    <section
                        ref={finaleRef}
                        className={styles.inlineFinale}
                        tabIndex={-1}
                        aria-labelledby="beauty-movement-finale-title"
                        data-finale-view={finaleStage}
                    >
                        <div className={styles.inlineFinaleHeader}>
                            <p className={styles.sectionLabel}>{finaleStage === "result" ? "Leitura completa" : "Confirmação"}</p>
                            <h2 id="beauty-movement-finale-title">
                                {finaleStage === "result" ? "O seu presente de celebração" : "Um último passo para confirmar"}
                            </h2>
                        </div>
                        {finaleStage === "confirmation" ? renderConfirmationStage() : renderResultStage()}
                    </section>
                ) : null}

            </section>
        </main>
    );
}
