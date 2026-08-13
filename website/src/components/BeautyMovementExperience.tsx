"use client";

import {
    type AnimationEvent as ReactAnimationEvent,
    type CSSProperties,
    type KeyboardEvent as ReactKeyboardEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
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
import { BEAUTY_MOVEMENT_MOTION, createBeautyMovementMotionGate } from "@/lib/beautyMovementMotion";
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

type HandStage =
    | "waiting"
    | "prompt"
    | "prompt-out"
    | "ready"
    | "reveal"
    | "held"
    | "collect"
    | "expand"
    | "deal"
    | "finale";
type IntroStage = "hidden" | "entering" | "holding" | "exiting";
type FinaleStage = "hidden" | "assembling" | "collecting" | "merging" | "confirmation" | "result";
type SpecialCardKind = "velocity" | "discount" | "free_procedure" | "reserved";
type SpecialCardAction = "none" | "confirm" | "reopen";
type ProgressRect = {
    left: number;
    top: number;
    width: number;
    height: number;
};
type ProgressMotion = {
    fromIndex: number;
    toIndex: number;
    from: ProgressRect;
    to: ProgressRect;
    key: number;
};

type ShareNavigator = Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data?: ShareData) => Promise<void>;
};

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;
// Keep the intro/prompt compact while preserving enough room for the deck to
// cross the lower edge of the surface without being visually detached from the copy.
const INITIAL_TABLE_HEIGHT = 112;
const AUTO_ADVANCE_SECONDS = BEAUTY_MOVEMENT_MOTION.autoAdvanceMs / 1_000;
const INITIAL_EXPERIENCE_TITLE = "3 anos. 3 cartas.";
const INITIAL_EXPERIENCE_SUBTITLE = "Um novo movimento para celebrar tudo o que ainda vem pela frente.";

type InitialExperienceCopy = {
    title: string;
    subtitle: string;
};

function getInitialExperienceCopy(description?: string | null): InitialExperienceCopy {
    const text = description?.trim();
    const fallback = `${INITIAL_EXPERIENCE_TITLE} ${INITIAL_EXPERIENCE_SUBTITLE}`;
    const fullText = text || fallback;

    if (fullText.startsWith(`${INITIAL_EXPERIENCE_TITLE} `)) {
        return {
            title: INITIAL_EXPERIENCE_TITLE,
            subtitle: fullText.slice(INITIAL_EXPERIENCE_TITLE.length).trim(),
        };
    }

    return { title: fullText, subtitle: "" };
}

function motionDuration(durationMs: number, reducedMotion: boolean, preserveTiming = false): number {
    return reducedMotion && !preserveTiming ? 0 : durationMs;
}

function promptReadingDelay(text: string, reducedMotion: boolean): number {
    return reducedMotion ? BEAUTY_MOVEMENT_MOTION.promptReadingHoldMs : promptReadingDuration(text);
}

function useReducedMotionPreference(): boolean {
    const [reducedMotion, setReducedMotion] = useState(false);

    useEffect(() => {
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const syncPreference = () => setReducedMotion(media.matches);

        syncPreference();
        media.addEventListener("change", syncPreference);
        return () => media.removeEventListener("change", syncPreference);
    }, []);

    return reducedMotion;
}

function promptWordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

function promptEntryDuration(text: string): number {
    return BEAUTY_MOVEMENT_MOTION.promptWordAnimationMs + Math.max(0, promptWordCount(text) - 1) * BEAUTY_MOVEMENT_MOTION.promptWordDelayMs;
}

function promptReadingDuration(text: string): number {
    return promptEntryDuration(text) + BEAUTY_MOVEMENT_MOTION.promptReadingHoldMs;
}

function promptExitDuration(text: string): number {
    return BEAUTY_MOVEMENT_MOTION.promptExitBaseMs + Math.max(0, promptWordCount(text) - 1) * BEAUTY_MOVEMENT_MOTION.promptExitWordDelayMs;
}

function promptExitTransitionDuration(text: string): number {
    return promptExitDuration(text) + BEAUTY_MOVEMENT_MOTION.promptExitBreathMs;
}

function renderPromptWords(text: string, wordOffset = 0) {
    const words = text.trim().split(/\s+/).filter(Boolean);

    return words.map((word, index) => (
        <span
            className={styles.promptWord}
            key={`${word}-${index}`}
            style={{ "--prompt-word-index": wordOffset + index } as CSSProperties}
        >
            {word}
            {index < words.length - 1 ? " " : null}
        </span>
    ));
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
    partnerName?: string | null,
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
        context.fillText(partnerName?.trim() || "Espaço Facial · 3 anos em movimento", 104, 1700);

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
    const reducedMotion = useReducedMotionPreference();
    const incomingSelections = useMemo(
        () => getSelectionsFromReveals(initialState.palette, initialState.reveals),
        [initialState.palette, initialState.reveals],
    );
    const initialReadingComplete = getCurrentActIndex(incomingSelections) >= BEAUTY_MOVEMENT_ACTS.length;
    const [selections, setSelections] = useState<BeautyMovementSelections>(incomingSelections);
    const [displayedActIndex, setDisplayedActIndex] = useState(() =>
        Math.min(getCurrentActIndex(incomingSelections), BEAUTY_MOVEMENT_ACTS.length - 1),
    );
    const [introStage, setIntroStage] = useState<IntroStage>("hidden");
    const [handStage, setHandStage] = useState<HandStage>(() =>
        initialState.confirmed || initialReadingComplete ? "ready" : "waiting",
    );
    const [confirmed, setConfirmed] = useState(initialState.confirmed);
    const [operationalConsent, setOperationalConsent] = useState(false);
    const [confirmationAttempted, setConfirmationAttempted] = useState(false);
    const [revealPendingCardId, setRevealPendingCardId] = useState<string | null>(null);
    const [isConfirming, setIsConfirming] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [shareStatus, setShareStatus] = useState<string | null>(null);
    const [finaleStage, setFinaleStage] = useState<FinaleStage>(() =>
        initialState.confirmed ? "result" : initialReadingComplete ? "confirmation" : "hidden",
    );
    const [isSpecialCardModalOpen, setIsSpecialCardModalOpen] = useState(initialState.confirmed);
    const [tableExpansionHeight, setTableExpansionHeight] = useState<number | null>(null);
    const [tableIntroHeight, setTableIntroHeight] = useState(0);
    const [autoAdvanceActive, setAutoAdvanceActive] = useState(false);
    const [progressMotion, setProgressMotion] = useState<ProgressMotion | null>(null);
    const openedRef = useRef(false);
    const viewedActsRef = useRef(new Set<number>());
    const viewedResultRef = useRef(false);
    const conditionsOpenedRef = useRef(false);
    const autoAdvanceTimerRef = useRef<number | null>(null);
    const autoAdvanceFrameRef = useRef<number | null>(null);
    const handTransitionTimerRef = useRef<number | null>(null);
    const introTimerRef = useRef<number | null>(null);
    const handExpansionFrameRef = useRef<number | null>(null);
    const progressMotionTimerRef = useRef<number | null>(null);
    const scrollAnimationFrameRef = useRef<number | null>(null);
    const scrollInterruptCleanupRef = useRef<(() => void) | null>(null);
    const tableRef = useRef<HTMLElement | null>(null);
    const tableSurfaceRef = useRef<HTMLDivElement | null>(null);
    const progressListRef = useRef<HTMLOListElement | null>(null);
    const progressButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const finaleRef = useRef<HTMLElement | null>(null);
    const confirmationActionRef = useRef<HTMLElement | null>(null);
    const specialCardModalCloseRef = useRef<HTMLButtonElement | null>(null);
    const specialCardReopenActionRef = useRef<HTMLButtonElement | null>(null);
    const selectionsRef = useRef(selections);
    const displayedActIndexRef = useRef(displayedActIndex);
    const introStageRef = useRef(introStage);
    const handStageRef = useRef(handStage);
    const finaleStageRef = useRef(finaleStage);
    const reducedMotionRef = useRef(reducedMotion);
    const revealInFlightRef = useRef(false);
    const transitionInFlightRef = useRef(false);
    const confirmInFlightRef = useRef(false);
    const mountedRef = useRef(true);
    const revealTransitionTokenRef = useRef<number | null>(null);
    const autoAdvanceGateRef = useRef(createBeautyMovementMotionGate());
    const handTransitionGateRef = useRef(createBeautyMovementMotionGate());
    const introTransitionGateRef = useRef(createBeautyMovementMotionGate());
    const progressMotionKeyRef = useRef(0);

    const closeSpecialCardModal = useCallback(() => {
        setIsSpecialCardModalOpen(false);
        window.requestAnimationFrame(() => {
            specialCardReopenActionRef.current?.focus({ preventScroll: true });
        });
    }, []);

    const openSpecialCardModal = useCallback(() => {
        setIsSpecialCardModalOpen(true);
    }, []);

    const motionCssVariables = useMemo(
        () =>
            ({
                "--bm-auto-advance-ms": `${BEAUTY_MOVEMENT_MOTION.autoAdvanceMs}ms`,
                "--bm-hand-reveal-ms": `${BEAUTY_MOVEMENT_MOTION.handRevealMs}ms`,
                "--bm-hand-collect-ms": `${BEAUTY_MOVEMENT_MOTION.handCollectMs}ms`,
                "--bm-hand-expand-ms": `${BEAUTY_MOVEMENT_MOTION.handExpandMs}ms`,
                "--bm-hand-deal-ms": `${BEAUTY_MOVEMENT_MOTION.handDealMs}ms`,
                "--bm-table-expand-height": `${tableExpansionHeight ?? INITIAL_TABLE_HEIGHT}px`,
                "--bm-table-intro-height": `${tableIntroHeight}px`,
                "--bm-progress-collapse-ms": `${BEAUTY_MOVEMENT_MOTION.progressCollapseMs}ms`,
                "--bm-progress-enter-ms": `${BEAUTY_MOVEMENT_MOTION.progressEnterMs}ms`,
                "--bm-progress-transfer-ms": `${BEAUTY_MOVEMENT_MOTION.progressTransferMs}ms`,
                "--bm-progress-expand-ms": `${BEAUTY_MOVEMENT_MOTION.progressExpandMs}ms`,
                "--bm-progress-total-ms": `${BEAUTY_MOVEMENT_MOTION.progressTransitionMs}ms`,
                "--bm-finale-enter-ms": `${BEAUTY_MOVEMENT_MOTION.finaleCardsEnterMs}ms`,
                "--bm-finale-merge-ms": `${BEAUTY_MOVEMENT_MOTION.finaleMergeMs}ms`,
                "--bm-finale-card-merge-ms": `${BEAUTY_MOVEMENT_MOTION.finaleCardMergeMs}ms`,
                "--bm-prompt-word-delay-ms": `${BEAUTY_MOVEMENT_MOTION.promptWordDelayMs}ms`,
                "--bm-prompt-word-animation-ms": `${BEAUTY_MOVEMENT_MOTION.promptWordAnimationMs}ms`,
                "--bm-prompt-exit-ms": `${BEAUTY_MOVEMENT_MOTION.promptExitBaseMs}ms`,
                "--bm-prompt-exit-delay-ms": `${BEAUTY_MOVEMENT_MOTION.promptExitWordDelayMs}ms`,
            }) as CSSProperties,
        [tableExpansionHeight, tableIntroHeight],
    );

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
        introStageRef.current = introStage;
    }, [introStage]);

    useEffect(() => {
        handStageRef.current = handStage;
    }, [handStage]);

    useEffect(() => {
        finaleStageRef.current = finaleStage;
    }, [finaleStage]);

    useEffect(() => {
        reducedMotionRef.current = reducedMotion;
    }, [reducedMotion]);

    useEffect(() => {
        if (initialState.confirmed) {
            setConfirmed(true);
            setCurrentFinaleStage("result");
            setIsSpecialCardModalOpen(true);
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
        if (finaleStage === "confirmation") {
            window.requestAnimationFrame(() => {
                const confirmationAction = confirmationActionRef.current;
                const focusTarget = isLocalPreview
                    ? confirmationAction?.querySelector<HTMLButtonElement>("button")
                    : confirmationAction;
                focusTarget?.focus({ preventScroll: true });
            });
            return;
        }
        if (finaleStage !== "result") return;
        window.requestAnimationFrame(() => {
            finaleRef.current?.focus({ preventScroll: true });
        });
    }, [finaleStage, isLocalPreview]);

    useEffect(() => {
        if (finaleStage !== "result" || !isSpecialCardModalOpen) return;

        const previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") closeSpecialCardModal();
        };
        window.addEventListener("keydown", closeOnEscape);
        const focusFrame = window.requestAnimationFrame(() => {
            specialCardModalCloseRef.current?.focus({ preventScroll: true });
        });

        return () => {
            window.cancelAnimationFrame(focusFrame);
            window.removeEventListener("keydown", closeOnEscape);
            document.body.style.overflow = previousBodyOverflow;
        };
    }, [closeSpecialCardModal, finaleStage, isSpecialCardModalOpen]);

    useEffect(() => {
        mountedRef.current = true;
        const autoAdvanceGate = autoAdvanceGateRef.current;
        const handTransitionGate = handTransitionGateRef.current;
        const introTransitionGate = introTransitionGateRef.current;
        return () => {
            mountedRef.current = false;
            autoAdvanceGate.invalidate();
            handTransitionGate.invalidate();
            introTransitionGate.invalidate();
            if (autoAdvanceTimerRef.current !== null) {
                window.clearTimeout(autoAdvanceTimerRef.current);
            }
            if (autoAdvanceFrameRef.current !== null) {
                window.cancelAnimationFrame(autoAdvanceFrameRef.current);
            }
            if (handTransitionTimerRef.current !== null) {
                window.clearTimeout(handTransitionTimerRef.current);
            }
            if (introTimerRef.current !== null) {
                window.clearTimeout(introTimerRef.current);
            }
            if (handExpansionFrameRef.current !== null) {
                window.cancelAnimationFrame(handExpansionFrameRef.current);
            }
            if (progressMotionTimerRef.current !== null) {
                window.clearTimeout(progressMotionTimerRef.current);
            }
            if (scrollAnimationFrameRef.current !== null) {
                window.cancelAnimationFrame(scrollAnimationFrameRef.current);
            }
            scrollInterruptCleanupRef.current?.();
        };
    }, []);

    const reading = useMemo(
        () => getBeautyMovementReading(initialState.palette, selections),
        [initialState.palette, selections],
    );
    const consentInvalid = confirmationAttempted && !operationalConsent;
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

    function measureProgressButton(index: number): ProgressRect | null {
        const list = progressListRef.current;
        const button = progressButtonRefs.current[index];
        if (!list || !button) return null;

        const listRect = list.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        return {
            left: buttonRect.left - listRect.left,
            top: buttonRect.top - listRect.top,
            width: buttonRect.width,
            height: buttonRect.height,
        };
    }

    function measureProgressTransition(fromIndex: number, toIndex: number): { from: ProgressRect; to: ProgressRect } | null {
        const from = measureProgressButton(fromIndex);
        const sourceButton = progressButtonRefs.current[fromIndex];
        const targetButton = progressButtonRefs.current[toIndex];
        const sourceItem = sourceButton?.closest("li");
        const targetItem = targetButton?.closest("li");
        if (!from || !sourceItem || !targetItem) return null;

        const sourceWasCurrent = sourceItem.classList.contains(styles.progressItemCurrent);
        const targetWasCurrent = targetItem.classList.contains(styles.progressItemCurrent);
        let to: ProgressRect | null = null;

        // Measure the destination in the layout it will have after React commits
        // the new active index: the source collapses while the destination grows.
        sourceItem.classList.remove(styles.progressItemCurrent);
        targetItem.classList.add(styles.progressItemCurrent);
        try {
            to = measureProgressButton(toIndex);
        } finally {
            sourceItem.classList.toggle(styles.progressItemCurrent, sourceWasCurrent);
            targetItem.classList.toggle(styles.progressItemCurrent, targetWasCurrent);
        }

        return to ? { from, to } : null;
    }

    function startProgressMotion(fromIndex: number, toIndex: number): boolean {
        if (fromIndex === toIndex || reducedMotionRef.current) {
            if (progressMotionTimerRef.current !== null) {
                window.clearTimeout(progressMotionTimerRef.current);
                progressMotionTimerRef.current = null;
            }
            setProgressMotion(null);
            return false;
        }

        const measuredTransition = measureProgressTransition(fromIndex, toIndex);
        if (!measuredTransition) return false;
        const { from, to } = measuredTransition;

        if (progressMotionTimerRef.current !== null) {
            window.clearTimeout(progressMotionTimerRef.current);
        }

        const key = progressMotionKeyRef.current + 1;
        progressMotionKeyRef.current = key;
        setProgressMotion({ fromIndex, toIndex, from, to, key });
        progressMotionTimerRef.current = window.setTimeout(() => {
            progressMotionTimerRef.current = null;
            if (mountedRef.current && progressMotionKeyRef.current === key) {
                setProgressMotion(null);
            }
        }, BEAUTY_MOVEMENT_MOTION.progressTransitionMs);

        return true;
    }

    function setCurrentActIndex(next: number): boolean {
        const previous = displayedActIndexRef.current;
        const progressMotionStarted = startProgressMotion(previous, next);
        displayedActIndexRef.current = next;
        setDisplayedActIndex(next);
        return progressMotionStarted;
    }

    function setCurrentHandStage(next: HandStage) {
        handStageRef.current = next;
        setHandStage(next);
    }

    function setCurrentIntroStage(next: IntroStage) {
        introStageRef.current = next;
        setIntroStage(next);
    }

    function setCurrentFinaleStage(next: FinaleStage) {
        finaleStageRef.current = next;
        setFinaleStage(next);
    }

    function isActUnlocked(index: number): boolean {
        return index === 0 || Boolean(selectionsRef.current[BEAUTY_MOVEMENT_ACTS[index - 1]]);
    }

    const cancelAutoAdvance = useCallback(() => {
        autoAdvanceGateRef.current.invalidate();
        if (autoAdvanceTimerRef.current !== null) {
            window.clearTimeout(autoAdvanceTimerRef.current);
            autoAdvanceTimerRef.current = null;
        }
        if (autoAdvanceFrameRef.current !== null) {
            window.cancelAnimationFrame(autoAdvanceFrameRef.current);
            autoAdvanceFrameRef.current = null;
        }
        setAutoAdvanceActive(false);
    }, []);

    const cancelScrollAnimation = useCallback(() => {
        if (scrollAnimationFrameRef.current !== null) {
            window.cancelAnimationFrame(scrollAnimationFrameRef.current);
            scrollAnimationFrameRef.current = null;
        }
        scrollInterruptCleanupRef.current?.();
        scrollInterruptCleanupRef.current = null;
    }, []);

    function scrollToElement(target: HTMLElement | null) {
        cancelScrollAnimation();
        if (!target) return;

        if (reducedMotion) {
            target.scrollIntoView({ behavior: "auto", block: "start" });
            return;
        }

        const startTop = window.scrollY;
        const stickyHeader = document.querySelector("header");
        const scrollOffset = stickyHeader instanceof HTMLElement ? stickyHeader.getBoundingClientRect().height + 4 : 32;
        const targetTop = Math.max(0, startTop + target.getBoundingClientRect().top - scrollOffset);
        const distance = targetTop - startTop;
        const duration = Math.min(1040, Math.max(680, Math.abs(distance) * 0.55));
        const startedAt = performance.now();
        const easeInOut = (progress: number) =>
            progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        const interruptOnUserIntent = () => cancelScrollAnimation();
        const removeScrollInterrupts = () => {
            window.removeEventListener("wheel", interruptOnUserIntent);
            window.removeEventListener("touchstart", interruptOnUserIntent);
            window.removeEventListener("pointerdown", interruptOnUserIntent);
            window.removeEventListener("keydown", interruptOnUserIntent);
        };
        window.addEventListener("wheel", interruptOnUserIntent, { passive: true, once: true });
        window.addEventListener("touchstart", interruptOnUserIntent, { passive: true, once: true });
        window.addEventListener("pointerdown", interruptOnUserIntent, { passive: true, once: true });
        window.addEventListener("keydown", interruptOnUserIntent, { once: true });
        scrollInterruptCleanupRef.current = removeScrollInterrupts;

        const animate = (now: number) => {
            const progress = Math.min(1, (now - startedAt) / duration);
            window.scrollTo(0, startTop + distance * easeInOut(progress));
            if (progress < 1) {
                scrollAnimationFrameRef.current = window.requestAnimationFrame(animate);
            } else {
                scrollAnimationFrameRef.current = null;
                removeScrollInterrupts();
                scrollInterruptCleanupRef.current = null;
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

    function clearHandTransitionTimer() {
        if (handTransitionTimerRef.current !== null) {
            window.clearTimeout(handTransitionTimerRef.current);
            handTransitionTimerRef.current = null;
        }
    }

    function cancelHandTransition() {
        handTransitionGateRef.current.invalidate();
        revealTransitionTokenRef.current = null;
        clearHandTransitionTimer();
        if (handExpansionFrameRef.current !== null) {
            window.cancelAnimationFrame(handExpansionFrameRef.current);
            handExpansionFrameRef.current = null;
        }
    }

    function beginHandTransition() {
        cancelHandTransition();
        return handTransitionGateRef.current.start();
    }

    function scheduleHandTransition(
        token: number,
        delayMs: number,
        callback: () => void,
        preserveTiming = false,
    ) {
        clearHandTransitionTimer();
        handTransitionTimerRef.current = window.setTimeout(() => {
            handTransitionTimerRef.current = null;
            if (!mountedRef.current || !handTransitionGateRef.current.isCurrent(token)) return;
            callback();
        }, motionDuration(delayMs, reducedMotionRef.current, preserveTiming));
    }

    function scheduleDealSequence(token: number, onReady: () => void) {
        if (reducedMotionRef.current) {
            setCurrentHandStage("deal");
            scheduleHandTransition(
                token,
                BEAUTY_MOVEMENT_MOTION.handDealMs + BEAUTY_MOVEMENT_MOTION.handDealSettleMs,
                onReady,
            );
            return;
        }

        // Freeze the compact surface height before revealing the next hand.
        // The expand class then transitions from this measured height to the
        // full card-grid height, instead of asking CSS to animate from `auto`.
        // This keeps the deck visibly anchored to the lower edge while the
        // white table grows around it.
        const surfaceBeforeExpand = tableSurfaceRef.current;
        const startHeight = Math.max(
            INITIAL_TABLE_HEIGHT,
            Math.ceil(surfaceBeforeExpand?.getBoundingClientRect().height ?? INITIAL_TABLE_HEIGHT),
        );
        setTableExpansionHeight(startHeight);
        setCurrentHandStage("expand");
        // Wait for the expansion state to render the next hand before measuring it.
        // A second frame avoids measuring the previous hand's layout during a fast
        // state transition, especially on mobile and after a smooth scroll.
        handExpansionFrameRef.current = window.requestAnimationFrame(() => {
            if (!mountedRef.current || !handTransitionGateRef.current.isCurrent(token)) return;

            handExpansionFrameRef.current = window.requestAnimationFrame(() => {
                handExpansionFrameRef.current = null;
                if (!mountedRef.current || !handTransitionGateRef.current.isCurrent(token)) return;

                const surface = tableSurfaceRef.current;
                const targetHeight = Math.max(
                    startHeight,
                    Math.ceil(surface?.scrollHeight ?? startHeight),
                );
                setTableExpansionHeight(targetHeight);
                scheduleHandTransition(token, BEAUTY_MOVEMENT_MOTION.handExpandMs, () => {
                    setCurrentHandStage("deal");
                    scheduleHandTransition(
                        token,
                        BEAUTY_MOVEMENT_MOTION.handDealMs + BEAUTY_MOVEMENT_MOTION.handDealSettleMs,
                        onReady,
                    );
                });
            });
        });
    }

    function clearIntroTransitionTimer() {
        if (introTimerRef.current !== null) {
            window.clearTimeout(introTimerRef.current);
            introTimerRef.current = null;
        }
    }

    function cancelIntroTransition() {
        introTransitionGateRef.current.invalidate();
        clearIntroTransitionTimer();
    }

    function beginIntroTransition() {
        cancelIntroTransition();
        return introTransitionGateRef.current.start();
    }

    function scheduleIntroTransition(
        token: number,
        delayMs: number,
        callback: () => void,
        preserveTiming = false,
    ) {
        clearIntroTransitionTimer();
        introTimerRef.current = window.setTimeout(() => {
            introTimerRef.current = null;
            if (!mountedRef.current || !introTransitionGateRef.current.isCurrent(token)) return;
            callback();
        }, motionDuration(delayMs, reducedMotionRef.current, preserveTiming));
    }

    function startInitialDeal() {
        if (
            handStageRef.current !== "waiting" ||
            introStageRef.current !== "hidden" ||
            finaleStageRef.current !== "hidden" ||
            transitionInFlightRef.current
        ) return;

        transitionInFlightRef.current = true;
        const handToken = beginHandTransition();
        const introToken = beginIntroTransition();
        setTableIntroHeight(0);
        setCurrentIntroStage("entering");
        scheduleIntroTransition(introToken, promptEntryDuration(initialExperienceText), () => {
            setCurrentIntroStage("holding");
            scheduleIntroTransition(introToken, BEAUTY_MOVEMENT_MOTION.initialIntroHoldMs, () => {
                setCurrentIntroStage("exiting");
                scheduleIntroTransition(introToken, promptExitTransitionDuration(initialExperienceText), () => {
                    setCurrentIntroStage("hidden");
                    setCurrentHandStage("prompt");
                    scheduleHandTransition(handToken, promptReadingDelay(tableDefinition.prompt, reducedMotionRef.current), () => {
                        setCurrentHandStage("prompt-out");
                        scheduleHandTransition(handToken, promptExitTransitionDuration(tableDefinition.prompt), () => {
                            scheduleDealSequence(handToken, () => {
                                transitionInFlightRef.current = false;
                                setCurrentHandStage("ready");
                                window.requestAnimationFrame(scrollToTable);
                            });
                        });
                    }, true);
                });
            }, true);
        });
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
        const handToken = beginHandTransition();
        setCurrentHandStage("collect");
        scheduleHandTransition(handToken, BEAUTY_MOVEMENT_MOTION.handCollectMs, () => {
            setCurrentHandStage("finale");
            setCurrentFinaleStage("assembling");
            scheduleHandTransition(handToken, BEAUTY_MOVEMENT_MOTION.finaleCardsEnterMs, () => {
                setCurrentFinaleStage("collecting");
                scheduleHandTransition(handToken, BEAUTY_MOVEMENT_MOTION.finaleHoldMs, () => {
                    setCurrentFinaleStage("merging");
                    scheduleHandTransition(
                        handToken,
                        BEAUTY_MOVEMENT_MOTION.finaleMergeMs + BEAUTY_MOVEMENT_MOTION.finaleMergeSettleMs,
                        () => {
                            transitionInFlightRef.current = false;
                            setCurrentHandStage("ready");
                            setCurrentFinaleStage(confirmed ? "result" : "confirmation");
                            setIsSpecialCardModalOpen(confirmed);
                            if (confirmed) {
                                window.requestAnimationFrame(() => {
                                    window.requestAnimationFrame(scrollToFinale);
                                });
                            } else {
                                window.requestAnimationFrame(() => {
                                    const confirmationAction = confirmationActionRef.current;
                                    const focusTarget = isLocalPreview
                                        ? confirmationAction?.querySelector<HTMLButtonElement>("button")
                                        : confirmationAction;
                                    focusTarget?.focus({ preventScroll: true });
                                });
                            }
                        },
                    );
                }, true);
            });
        });
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
        const handToken = beginHandTransition();
        setCurrentHandStage("collect");
        scheduleHandTransition(handToken, BEAUTY_MOVEMENT_MOTION.handCollectMs, () => {
            setCurrentHandStage("prompt");
            const progressMotionStarted = setCurrentActIndex(nextIndex);
            scheduleHandTransition(
                handToken,
                progressMotionStarted ? BEAUTY_MOVEMENT_MOTION.progressTransitionMs : 0,
                () => {
                    scheduleHandTransition(
                        handToken,
                        promptReadingDelay(BEAUTY_MOVEMENT_ACT_DEFINITIONS[nextIndex]?.prompt || "", reducedMotionRef.current),
                        () => {
                            setCurrentHandStage("prompt-out");
                            scheduleHandTransition(
                                handToken,
                                promptExitTransitionDuration(BEAUTY_MOVEMENT_ACT_DEFINITIONS[nextIndex]?.prompt || ""),
                                () => {
                                    scheduleDealSequence(handToken, () => {
                                        transitionInFlightRef.current = false;
                                        setCurrentHandStage("ready");
                                        window.requestAnimationFrame(scrollToTable);
                                    });
                                },
                            );
                        },
                        true,
                    );
                },
            );
        });
    }

    function startAutoAdvance(index: number, delayMs = BEAUTY_MOVEMENT_MOTION.autoAdvanceMs) {
        const token = autoAdvanceGateRef.current.start();
        autoAdvanceFrameRef.current = window.requestAnimationFrame(() => {
            autoAdvanceFrameRef.current = null;
            if (
                !mountedRef.current ||
                reducedMotionRef.current ||
                !autoAdvanceGateRef.current.isCurrent(token) ||
                handStageRef.current !== "held" ||
                displayedActIndexRef.current !== index ||
                finaleStageRef.current !== "hidden"
            ) return;

            setAutoAdvanceActive(true);
            autoAdvanceTimerRef.current = window.setTimeout(() => {
                autoAdvanceTimerRef.current = null;
                if (
                    !mountedRef.current ||
                    !autoAdvanceGateRef.current.isCurrent(token) ||
                    handStageRef.current !== "held" ||
                    displayedActIndexRef.current !== index ||
                    finaleStageRef.current !== "hidden"
                ) return;

                setAutoAdvanceActive(false);
                moveToNextHand(index);
            }, delayMs);
        });
    }

    function scheduleNextHand(index: number) {
        if (reducedMotion) return;
        cancelAutoAdvance();
        startAutoAdvance(index);
    }

    useEffect(() => {
        if (!autoAdvanceActive) return;

        const cancelOnReadingIntent = () => cancelAutoAdvance();
        window.addEventListener("wheel", cancelOnReadingIntent, { passive: true });
        window.addEventListener("touchmove", cancelOnReadingIntent, { passive: true });
        window.addEventListener("keydown", cancelOnReadingIntent);

        return () => {
            window.removeEventListener("wheel", cancelOnReadingIntent);
            window.removeEventListener("touchmove", cancelOnReadingIntent);
            window.removeEventListener("keydown", cancelOnReadingIntent);
        };
    }, [autoAdvanceActive, cancelAutoAdvance]);

    useEffect(() => {
        if (!reducedMotion) return;
        cancelAutoAdvance();
        cancelScrollAnimation();
    }, [reducedMotion, cancelAutoAdvance, cancelScrollAnimation]);

    useEffect(() => {
        if (handStage !== "expand") return;

        let resizeFrame: number | null = null;
        const syncExpansionHeight = () => {
            if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
            resizeFrame = window.requestAnimationFrame(() => {
                resizeFrame = null;
                const surface = tableSurfaceRef.current;
                if (!surface || handStageRef.current !== "expand") return;
                setTableExpansionHeight(Math.max(INITIAL_TABLE_HEIGHT, surface.scrollHeight));
            });
        };

        window.addEventListener("resize", syncExpansionHeight);
        const surfaceObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncExpansionHeight);
        if (surfaceObserver && tableSurfaceRef.current) surfaceObserver.observe(tableSurfaceRef.current);
        return () => {
            window.removeEventListener("resize", syncExpansionHeight);
            surfaceObserver?.disconnect();
            if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
        };
    }, [handStage]);

    useEffect(() => {
        if (introStage !== "entering" || handStage !== "waiting") return;

        let measureFrame: number | null = window.requestAnimationFrame(() => {
            measureFrame = null;
            const surface = tableSurfaceRef.current;
            if (!surface || surface.dataset.deckState !== "intro") return;

            // The deck intentionally crosses the surface boundary. Exclude it
            // from this one intrinsic-content measurement so later intro
            // phases cannot measure their own overflow and grow the table
            // repeatedly.
            const deck = surface.querySelector<HTMLElement>(`.${styles.deckStage}`);
            const previousDisplay = deck?.style.display;
            if (deck) deck.style.display = "none";
            setTableIntroHeight(Math.max(INITIAL_TABLE_HEIGHT, Math.ceil(surface.scrollHeight)));
            if (deck) deck.style.display = previousDisplay ?? "";
        });

        return () => {
            if (measureFrame !== null) window.cancelAnimationFrame(measureFrame);
        };
    }, [handStage, introStage]);

    useEffect(() => {
        const cancelWhenBackgrounded = () => {
            if (document.visibilityState === "hidden") cancelAutoAdvance();
        };

        document.addEventListener("visibilitychange", cancelWhenBackgrounded);
        return () => document.removeEventListener("visibilitychange", cancelWhenBackgrounded);
    }, [cancelAutoAdvance]);

    function handleProgressClick(index: number) {
        if (index !== displayedActIndexRef.current || !isActUnlocked(index)) return;

        const act = BEAUTY_MOVEMENT_ACTS[index];
        const hasSelection = Boolean(act && selectionsRef.current[act]);
        if (hasSelection && handStageRef.current === "held") {
            if (index === BEAUTY_MOVEMENT_ACTS.length - 1) {
                beginFinale();
            } else {
                moveToNextHand(index);
            }
            return;
        }

        scrollToTable();
    }

    function settleReveal(actIndex: number, token: number) {
        if (
            !handTransitionGateRef.current.isCurrent(token) ||
            handStageRef.current !== "reveal" ||
            displayedActIndexRef.current !== actIndex
        ) return;

        clearHandTransitionTimer();
        revealTransitionTokenRef.current = null;
        setCurrentHandStage("held");
        scheduleNextHand(actIndex);
    }

    function handleSelectedCardAnimationEnd(event: ReactAnimationEvent<HTMLButtonElement>, actIndex: number) {
        // CSS Modules scopes keyframe names (for example, `cardLiftAndSettle__hash`),
        // so comparing against the source name would silently ignore the event.
        // The stage/token guards in settleReveal already make this handler idempotent
        // and keep collect/deal animations from advancing the hand accidentally.
        if (event.currentTarget !== event.target) return;
        const token = revealTransitionTokenRef.current;
        if (token === null) return;
        settleReveal(actIndex, token);
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
            const handToken = beginHandTransition();
            revealTransitionTokenRef.current = handToken;
            setCurrentHandStage("reveal");
            scheduleHandTransition(handToken, BEAUTY_MOVEMENT_MOTION.handRevealFallbackMs, () => {
                settleReveal(actIndex, handToken);
            });
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

        if (!operationalConsent && !isLocalPreview) return;

        confirmInFlightRef.current = true;
        setIsConfirming(true);
        try {
            await onConfirm?.({
                email: null,
                operationalConsent: true,
            });
            if (!mountedRef.current) return;
            setConfirmed(true);
            setCurrentFinaleStage("result");
            setIsSpecialCardModalOpen(true);
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

    function renderWhatsappAction(className: string, label = primaryWhatsappLabel) {
        if (isLocalPreview) {
            return (
                <button className={className} type="button" onClick={handleWhatsappClick}>
                    {label}
                </button>
            );
        }

        if (initialState.campaign.whatsappMessage?.trim()) {
            return (
                <BeautyMovementWhatsappLink
                    className={className}
                    message={initialState.campaign.whatsappMessage.trim()}
                    placement="result"
                    onClick={handleWhatsappClick}
                >
                    {label}
                </BeautyMovementWhatsappLink>
            );
        }

        return (
            <button className={className} type="button" disabled>
                {label}
            </button>
        );
    }

    function handleConditionsClick() {
        if (conditionsOpenedRef.current) return;
        conditionsOpenedRef.current = true;
        onTrack?.("beauty_movement_conditions_open", { stage: "result" });
    }

    async function handleShare() {
        if (reading.length !== BEAUTY_MOVEMENT_ACTS.length) return;

        setShareStatus(null);
        const blob = await createStoryBlob(reading, initialState.campaign.partnerName);
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
    const initialExperienceCopy = getInitialExperienceCopy(initialState.campaign.description);
    const initialExperienceText = [initialExperienceCopy.title, initialExperienceCopy.subtitle].filter(Boolean).join(" ");
    const tableCards = getBeautyMovementCardsForAct(initialState.palette, tableAct);
    const tableSelectedCardId = selections[tableAct];
    const tableSelected = Boolean(tableSelectedCardId);
    const nextDefinition = BEAUTY_MOVEMENT_ACT_DEFINITIONS[displayedActIndex + 1];
    const tableIsUnlocked = isActUnlocked(displayedActIndex);
    const waitingForInitialDeal = handStage === "waiting" && introStage === "hidden" && finaleStage === "hidden";
    const tablePromptCopy =
        introStage !== "hidden"
            ? initialExperienceCopy
            : handStage === "prompt" || handStage === "prompt-out"
              ? { title: tableDefinition.promptTitle, subtitle: tableDefinition.promptSubtitle }
              : null;
    const tablePromptText = tablePromptCopy ? [tablePromptCopy.title, tablePromptCopy.subtitle].filter(Boolean).join(" ") : null;
    const promptTitleWordCount = tablePromptCopy ? promptWordCount(tablePromptCopy.title) : 0;
    const tablePromptClassName =
        introStage === "entering"
            ? styles.tablePromptIntro
            : introStage === "holding"
              ? styles.tablePromptIntroHolding
              : introStage === "exiting"
                ? styles.tablePromptIntroExit
                : handStage === "prompt-out"
                  ? styles.tablePromptExit
                  : "";
    const tableIsBusy =
        introStage !== "hidden" ||
        handStage === "prompt" ||
        handStage === "prompt-out" ||
        handStage === "reveal" ||
        handStage === "collect" ||
        handStage === "expand" ||
        handStage === "deal" ||
        handStage === "finale" ||
        finaleStage === "assembling" ||
        finaleStage === "collecting" ||
        finaleStage === "merging";

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
                onKeyDown={(event) => {
                    if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
                        event.preventDefault();
                        void handleReveal(displayedActIndex, card);
                    }
                }}
                onAnimationEnd={isSelected ? (event) => handleSelectedCardAnimationEnd(event, displayedActIndex) : undefined}
                disabled={!tableIsUnlocked || handStage !== "ready" || Boolean(revealPendingCardId) || tableSelected}
                aria-busy={isPending || undefined}
                aria-pressed={isSelected}
                aria-label={`${isSelected ? "Carta revelada" : "Revelar carta"} ${cardIndex + 1} de ${tableDefinition.label}`}
            >
                <span className={styles.cardInner}>
                    <span className={`${styles.cardFace} ${styles.cardFront}`}>
                        <span className={styles.cardBrandMark} aria-hidden="true">
                            <BrandMark className={styles.cardBrandLogo} loading="eager" tone="light" title="" />
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
                    <strong>{card.title}</strong>
                    <span className={styles.finaleCardMessage}>{card.shortMessage}</span>
                </div>
            </article>
        );
    }

    function renderSpecialCard(revealed: boolean, action: SpecialCardAction = "none") {
        const showRevealAction = action !== "none";
        const kind: SpecialCardKind = revealed
            ? hasCourtesyClass
                ? "velocity"
                : initialState.benefit?.type === "discount"
                  ? "discount"
                  : initialState.benefit?.type === "free_procedure"
                    ? "free_procedure"
                    : "reserved"
            : "reserved";
        const benefit = initialState.benefit;
        const velocity = initialState.velocity;
        const iconId =
            kind === "velocity"
                ? "reward-velocity"
                : kind === "discount"
                  ? "reward-discount"
                  : kind === "free_procedure"
                    ? "reward-procedure"
                    : "reward-reserved";
        const kindLabel =
            kind === "velocity"
                ? "AULA-CORTESIA"
                : kind === "discount"
                  ? "CONDIÇÃO ESPECIAL"
                  : kind === "free_procedure"
                    ? "CORTESIA DE CELEBRAÇÃO"
                    : "PRESENTE RESERVADO";
        const title =
            kind === "velocity"
                ? velocity?.label?.trim() || "Aula-cortesia Velocity"
                : kind === "discount" || kind === "free_procedure"
                  ? benefit?.procedureName || "Cuidado reservado"
                  : "Seu presente está reservado";
        const description =
            kind === "velocity"
                ? "Seu movimento também faz parte da celebração."
                : kind === "discount" || kind === "free_procedure"
                  ? benefit?.displayText || "Um cuidado especial para celebrar o seu momento."
                  : "Um presente preparado para acompanhar o seu momento.";
        const specialCardWhatsappLabel = /whatsapp/i.test(primaryWhatsappLabel)
            ? primaryWhatsappLabel
            : `${primaryWhatsappLabel} no WhatsApp`;

        return (
            <article
                className={styles.specialCard}
                data-special-state={revealed ? "revealed" : "locked"}
                aria-label={revealed ? `Carta especial: ${title}` : "Carta especial reservada"}
            >
                <div className={styles.specialCardInner}>
                    <div
                        className={[
                            styles.specialCardFace,
                            styles.specialCardBack,
                            showRevealAction ? styles.specialCardBackWithAction : "",
                        ].filter(Boolean).join(" ")}
                        aria-hidden={revealed}
                    >
                        <BrandMark className={styles.specialCardBrand} loading="eager" tone="light" title="" />
                        <span className={styles.specialCardBackLabel}>CARTA ESPECIAL</span>
                        <strong>A soma da sua leitura está pronta.</strong>
                        {showRevealAction ? (
                            <div
                                className={styles.specialCardRevealAction}
                                ref={(node) => {
                                    if (action === "confirm") confirmationActionRef.current = node;
                                }}
                            >
                                {action === "confirm" && actionError ? <p className={styles.specialCardRevealError} role="alert">{actionError}</p> : null}
                                <button
                                    ref={action === "reopen" ? specialCardReopenActionRef : undefined}
                                    className={styles.primaryButton}
                                    type="button"
                                    onClick={action === "confirm" ? () => void handleConfirm() : openSpecialCardModal}
                                    disabled={action === "confirm" ? isConfirming : undefined}
                                >
                                    {action === "confirm" && isConfirming ? "Revelando…" : "Clique aqui para revelar sua carta especial"}
                                </button>
                            </div>
                        ) : null}
                        <span className={styles.specialCardSeal} aria-hidden="true">
                            ✦
                        </span>
                    </div>
                    <div className={`${styles.specialCardFace} ${styles.specialCardFront}`} aria-hidden={!revealed}>
                        <span className={styles.specialCardKind}>{kindLabel}</span>
                        <span className={styles.specialCardIllustration} aria-hidden="true">
                            <BeautyMovementCardIllustration cardId={iconId} />
                        </span>
                        <strong>{title}</strong>
                        <span className={styles.specialCardCopy}>{description}</span>
                        {revealed
                            ? renderWhatsappAction(
                                `${styles.primaryButton} ${styles.specialCardWhatsappAction}`,
                                specialCardWhatsappLabel,
                            )
                            : null}
                    </div>
                </div>
            </article>
        );
    }

    function renderConfirmationAction() {
        return (
            <section
                className={styles.specialCardConfirmation}
                ref={confirmationActionRef}
                tabIndex={-1}
                aria-labelledby="beauty-movement-special-confirmation-title"
            >
                <p className={styles.sectionLabel}>Confirmação</p>
                <h2 id="beauty-movement-special-confirmation-title">Garanta seu presente e confirme presença.</h2>
                <label className={`${styles.consentField} ${consentInvalid ? styles.consentFieldInvalid : ""}`.trim()}>
                    <input
                        type="checkbox"
                        checked={operationalConsent}
                        onChange={(event) => setOperationalConsent(event.target.checked)}
                    />
                    <span>Aceito entrar na lista exclusiva e receber comunicações operacionais sobre este evento.</span>
                </label>
                {consentInvalid ? <p className={styles.fieldError}>Confirme o aceite para seguir.</p> : null}
                {actionError ? <p className={styles.inlineError} role="alert">{actionError}</p> : null}
                <button
                    className={styles.primaryButton}
                    type="button"
                    onClick={() => void handleConfirm()}
                    disabled={isConfirming}
                >
                    {isConfirming ? "Confirmando…" : "Garantir presente e confirmar presença"}
                </button>
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
                    {renderWhatsappAction(styles.primaryButton)}
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
        <>
        <main className={styles.page} aria-hidden={isSpecialCardModalOpen || undefined}>
            <div className={styles.backgroundOrbOne} aria-hidden="true" />
            <div className={styles.backgroundOrbTwo} aria-hidden="true" />

            <section className={styles.shell} aria-labelledby="beauty-movement-title">
                <header className={styles.hero}>
                    <h1 id="beauty-movement-title">{initialState.campaign.title?.trim() || "Beleza que se move com você."}</h1>
                    <p
                        className={`${styles.heroDeckInstruction} ${waitingForInitialDeal ? "" : styles.heroDeckInstructionHidden}`.trim()}
                        id="beauty-movement-deck-prompt"
                        aria-hidden={!waitingForInitialDeal || undefined}
                    >
                        Clique no baralho para começar a sua leitura
                    </p>
                </header>

                <section
                    ref={tableRef}
                    className={`${styles.tableStage} ${waitingForInitialDeal ? "" : styles.tableStageShifted}`.trim()}
                    id="mesa-de-cartas"
                    aria-label={tableDefinition.label}
                    aria-describedby={tablePromptText ? "table-stage-prompt" : undefined}
                    data-hand-stage={handStage}
                    data-act-index={displayedActIndex}
                    data-finale-stage={finaleStage}
                    aria-busy={tableIsBusy || undefined}
                    style={motionCssVariables}
                >
                    <div
                        className={`${styles.progressRow} ${waitingForInitialDeal ? styles.progressRowWaiting : ""}`.trim()}
                    >
                        <div className={styles.progressGroup} aria-hidden={waitingForInitialDeal || undefined}>
                            <ol
                                ref={progressListRef}
                                className={`${styles.progress} ${progressMotion ? styles.progressMotionActive : ""}`.trim()}
                                aria-label="Progresso da experiência"
                            >
                                {progressMotion ? (
                                    <li
                                        className={styles.progressTransfer}
                                        aria-hidden="true"
                                        style={
                                            {
                                                "--progress-from-left": `${progressMotion.from.left}px`,
                                                "--progress-from-top": `${progressMotion.from.top}px`,
                                                "--progress-from-width": `${progressMotion.from.width}px`,
                                                "--progress-from-height": `${progressMotion.from.height}px`,
                                                "--progress-to-left": `${progressMotion.to.left}px`,
                                                "--progress-to-top": `${progressMotion.to.top}px`,
                                                "--progress-to-width": `${progressMotion.to.width}px`,
                                                "--progress-to-height": `${progressMotion.to.height}px`,
                                            } as CSSProperties
                                        }
                                    />
                                ) : null}
                                {BEAUTY_MOVEMENT_ACT_DEFINITIONS.map((act, index) => {
                                    const isDone = Boolean(selections[act.id]);
                                    const isCurrent =
                                        finaleStage === "hidden" &&
                                        introStage === "hidden" &&
                                        !waitingForInitialDeal &&
                                        index === displayedActIndex;
                                    const isInitialCategoryEntering =
                                        isCurrent &&
                                        !progressMotion &&
                                        displayedActIndex === 0 &&
                                        (handStage === "prompt" || handStage === "prompt-out");
                                    const isLocked = !isActUnlocked(index);
                                    const isProgressSource = progressMotion?.fromIndex === index;
                                    const isProgressTarget = progressMotion?.toIndex === index;
                                    const isAdvanceReady = isCurrent && isDone && handStage === "held";
                                    const isAutoAdvanceVisible = isCurrent && !progressMotion && autoAdvanceActive;
                                    const nextAct = BEAUTY_MOVEMENT_ACT_DEFINITIONS[index + 1];
                                    const progressActionLabel = isAdvanceReady
                                        ? index === BEAUTY_MOVEMENT_ACTS.length - 1
                                            ? "Continuar para confirmação"
                                            : `Continuar para ${nextAct?.label || "a próxima etapa"}`
                                        : `Acompanhar a mesa de cartas em ${act.label}${isLocked ? ", ainda bloqueada" : ""}`;
                                    return (
                                        <li
                                            className={[
                                                styles.progressItem,
                                                isDone ? styles.progressItemDone : "",
                                                isCurrent && !progressMotion ? styles.progressItemCurrent : "",
                                                isInitialCategoryEntering ? styles.progressItemEntering : "",
                                                isProgressSource ? styles.progressItemTransferFrom : "",
                                                isProgressTarget ? styles.progressItemTransferTo : "",
                                            ].filter(Boolean).join(" ")}
                                            key={act.id}
                                        >
                                                <button
                                                    className={styles.progressButton}
                                                    type="button"
                                                    onClick={() => handleProgressClick(index)}
                                                    ref={(element) => {
                                                        progressButtonRefs.current[index] = element;
                                                    }}
                                                    disabled={!isCurrent || Boolean(progressMotion)}
                                                aria-current={isCurrent ? "step" : undefined}
                                                aria-label={progressActionLabel}
                                            >
                                                <span className={styles.progressCopy}>
                                                    <strong>{act.label}</strong>
                                                </span>
                                                {isCurrent && !progressMotion ? (
                                                    <span
                                                        className={`${styles.autoAdvance} ${isAutoAdvanceVisible ? styles.autoAdvanceVisible : ""}`.trim()}
                                                        role="status"
                                                        aria-live={isAutoAdvanceVisible ? "polite" : undefined}
                                                        aria-hidden={isAutoAdvanceVisible ? undefined : true}
                                                    >
                                                        <span className={styles.srOnly}>
                                                            {isAutoAdvanceVisible ? (
                                                                <>
                                                                    {nextDefinition ? "Próxima mão" : "Confirmação"} automática em {AUTO_ADVANCE_SECONDS} segundos.
                                                                </>
                                                            ) : null}
                                                        </span>
                                                    </span>
                                                ) : null}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ol>
                        </div>

                    </div>

                    <div
                        ref={tableSurfaceRef}
                        className={styles.tableSurface}
                        data-deck-state={
                            waitingForInitialDeal
                                ? "waiting"
                                : introStage !== "hidden"
                                  ? "intro"
                                  : handStage === "prompt" || handStage === "prompt-out"
                                    ? "prompt"
                                    : handStage === "expand"
                                      ? "expanding"
                                      : finaleStage === "confirmation" || finaleStage === "result"
                                        ? "final"
                                        : "ready"
                        }
                    >
                        {waitingForInitialDeal ? (
                            <span className={styles.tableDeckPromptArrow} aria-hidden="true">
                                ↓
                            </span>
                        ) : null}
                        {tablePromptCopy ? (
                            <p
                                className={`${styles.tablePrompt} ${tablePromptClassName}`.trim()}
                                id="table-stage-prompt"
                                key={introStage !== "hidden" ? "experience-intro" : tableDefinition.id}
                            >
                                <span className={styles.promptTitle}>{renderPromptWords(tablePromptCopy.title)}</span>
                                {tablePromptCopy.subtitle ? (
                                    <span className={styles.promptSubtitle}>
                                        {renderPromptWords(tablePromptCopy.subtitle, promptTitleWordCount)}
                                    </span>
                                ) : null}
                            </p>
                        ) : null}
                        <button
                            className={styles.deckStage}
                            type="button"
                            onClick={startInitialDeal}
                            onKeyDown={handleDeckKeyDown}
                            disabled={!waitingForInitialDeal}
                            aria-hidden={finaleStage !== "hidden" ? true : undefined}
                            aria-label="Clique no baralho para começar a sua leitura"
                        >
                            <span className={`${styles.deckCard} ${styles.deckCardUnder}`} />
                            <span className={`${styles.deckCard} ${styles.deckCardMiddle}`} />
                            <span className={`${styles.deckCard} ${styles.deckCardTop}`}>
                                <BrandMark className={styles.deckBrandLogo} loading="eager" tone="light" title="" />
                            </span>
                        </button>
                        {finaleStage === "assembling" || finaleStage === "collecting" || finaleStage === "merging" ? (
                            <div
                                className={`${styles.finaleCardGrid} ${finaleStage === "merging" ? styles.finaleCardGridMerging : styles.finaleCardGridHolding}`}
                                aria-hidden="true"
                            >
                                {reading.map(renderFinaleCard)}
                                {finaleStage === "merging" ? (
                                    <div className={styles.finaleSpecialCardTransform}>
                                        {renderSpecialCard(false)}
                                    </div>
                                ) : null}
                            </div>
                        ) : finaleStage === "confirmation" ? (
                            <div
                                className={styles.specialCardStage}
                                role="group"
                                aria-label="Carta especial da celebração"
                            >
                                {!isLocalPreview ? renderConfirmationAction() : null}
                                {renderSpecialCard(false, isLocalPreview ? "confirm" : "none")}
                            </div>
                        ) : finaleStage === "result" ? (
                            <div
                                className={`${styles.specialCardStage} ${styles.specialCardStageReopen}`}
                                role="group"
                                aria-label="Carta especial do benefício"
                            >
                                {renderSpecialCard(false, "reopen")}
                            </div>
                        ) : finaleStage === "hidden" && introStage === "hidden" && handStage !== "waiting" && handStage !== "prompt" && handStage !== "prompt-out" ? (
                            <div className={styles.cardGrid} role="group" aria-label={`Cartas da etapa ${tableDefinition.label}`}>
                                {tableCards.map(renderCard)}
                            </div>
                        ) : null}
                    </div>

                </section>

                {actionError && finaleStage === "hidden" ? (
                    <p className={styles.inlineError} role="alert">
                        {actionError}
                    </p>
                ) : null}

                {finaleStage === "result" ? (
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
                        {renderResultStage()}
                    </section>
                ) : null}

            </section>
        </main>
            {finaleStage === "result" && isSpecialCardModalOpen ? (
                <div
                    className={styles.specialCardModalOverlay}
                    role="presentation"
                    onClick={(event) => {
                        if (event.target === event.currentTarget) closeSpecialCardModal();
                    }}
                >
                    <section
                        className={styles.specialCardModalDialog}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Carta especial"
                    >
                        <button
                            ref={specialCardModalCloseRef}
                            className={styles.specialCardModalClose}
                            type="button"
                            aria-label="Fechar carta especial"
                            onClick={closeSpecialCardModal}
                        >
                            ×
                        </button>
                        {renderSpecialCard(true)}
                    </section>
                </div>
            ) : null}
        </>
    );
}
