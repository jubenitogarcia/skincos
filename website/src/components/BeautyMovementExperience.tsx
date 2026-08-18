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
    const autoAdvanceTimerRef = useRef<number | null>(null);
    const autoAdvanceFrameRef = useRef<number | null>(null);
    const handTransitionTimerRef = useRef<number | null>(null);
    const introTimerRef = useRef<number | null>(null);
    const handExpansionFrameRef = useRef<number | null>(null);
    const progressMotionTimerRef = useRef<number | null>(null);
    const scrollAnimationFrameRef = useRef<number | null>(null);
    const scrollInterruptCleanupRef = useRef<(() => void) | null>(null);
    const initialDealScrollFrameRef = useRef<number | null>(null);
    const initialDealScrollActiveRef = useRef(false);
    const initialDealScrollInterruptCleanupRef = useRef<(() => void) | null>(null);
    const tableRef = useRef<HTMLElement | null>(null);
    const tableSurfaceRef = useRef<HTMLDivElement | null>(null);
    const finaleCountdownRef = useRef<HTMLDivElement | null>(null);
    const progressListRef = useRef<HTMLOListElement | null>(null);
    const progressButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
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
    const autoAdvanceScheduledRef = useRef(false);
    const autoAdvancePendingRef = useRef(false);
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
                "--bm-finale-hold-ms": `${BEAUTY_MOVEMENT_MOTION.finaleHoldMs}ms`,
                "--bm-finale-merge-ms": `${BEAUTY_MOVEMENT_MOTION.finaleMergeMs}ms`,
                "--bm-finale-card-merge-ms": `${BEAUTY_MOVEMENT_MOTION.finaleCardMergeMs}ms`,
                "--bm-special-enter-ms": "820ms",
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
            if (initialDealScrollFrameRef.current !== null) {
                window.cancelAnimationFrame(initialDealScrollFrameRef.current);
            }
            initialDealScrollActiveRef.current = false;
            initialDealScrollInterruptCleanupRef.current?.();
            initialDealScrollInterruptCleanupRef.current = null;
            scrollInterruptCleanupRef.current?.();
        };
    }, []);

    const reading = useMemo(
        () => getBeautyMovementReading(initialState.palette, selections),
        [initialState.palette, selections],
    );
    const consentInvalid = confirmationAttempted && !operationalConsent;
    const primaryWhatsappLabel = initialState.campaign.whatsappLabel?.trim() || "Falar com a equipe";
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
        autoAdvanceScheduledRef.current = false;
        autoAdvancePendingRef.current = false;
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

    function getTableScrollTarget(): number | null {
        const target = tableRef.current;
        if (!target) return null;

        const title = document.getElementById("beauty-movement-title");
        const titlePeek =
            title instanceof HTMLElement
                ? Math.min(184, Math.max(0, Math.round(title.getBoundingClientRect().height - 2)))
                : 0;
        const stickyHeader = document.querySelector("header");
        const stickyHeaderRect = stickyHeader instanceof HTMLElement ? stickyHeader.getBoundingClientRect() : null;
        // HeaderScrollBehavior translates the header out of view but keeps its
        // layout box. Only the visible portion should reserve scroll space;
        // otherwise the follow loop pushes the hero title above the viewport.
        const headerOffset = stickyHeaderRect
            ? Math.max(0, Math.min(stickyHeaderRect.height, stickyHeaderRect.bottom)) + 4
            : 32;
        const scrollOffset = headerOffset + titlePeek;
        const editorialTarget = window.scrollY + target.getBoundingClientRect().top - scrollOffset;
        const deck = target.querySelector<HTMLElement>(`.${styles.deckStage}`);
        const deckRect = deck?.getBoundingClientRect();
        const deckBottomPadding = Math.max(28, Math.round(window.innerHeight * 0.08));
        const deckTarget = deckRect
            ? window.scrollY + deckRect.bottom - (window.innerHeight - deckBottomPadding)
            : editorialTarget;

        // The surface grows downward while the deck travels with it. Keep the
        // deck fully in the lower half of the viewport instead of leaving its
        // final card cut off below the fold. The editorial anchor remains the
        // floor so the first scroll still starts from the hero/table handoff.
        const fittedTarget = Math.max(0, Math.max(editorialTarget, deckTarget));

        // Keep the campaign thesis readable while the table settles. The
        // compact layout is deliberately designed so the title can fit above
        // the cards; capping the automatic follow target prevents the old
        // behavior where the title was completely scrolled away.
        if (title instanceof HTMLElement) {
            const titleRect = title.getBoundingClientRect();
            const titleTop = window.scrollY + titleRect.top;
            const titleFits = titleRect.height <= window.innerHeight - headerOffset - 16;
            const tableRect = target.getBoundingClientRect();
            const cardGrid = target.querySelector<HTMLElement>(`.${styles.cardGrid}`);
            // The card row is the readable hand that must share the frame
            // with the thesis. The deck remains a separate lower anchor in
            // fittedTarget and may intentionally overhang the viewport edge.
            const handBottom = cardGrid?.getBoundingClientRect().bottom ?? Math.max(tableRect.top + 312, deckRect?.bottom ?? 0);
            const isStackedLayout = window.matchMedia("(max-width: 720px)").matches;
            if (titleFits && !isStackedLayout) {
                const titleTarget = Math.max(0, titleTop - headerOffset - 12);
                // Evaluate the hand at the proposed title target, rather than
                // at the current scroll position. This prevents the RAF follow
                // loop from alternating between the title and deck targets.
                const handBottomAtTitle = handBottom - (titleTarget - window.scrollY);
                const handFitsAtTitle = handBottomAtTitle <= window.innerHeight + 24;
                if (handFitsAtTitle) return Math.min(fittedTarget, titleTarget);
            }
        }

        return fittedTarget;
    }

    function stopInitialDealScroll() {
        initialDealScrollActiveRef.current = false;
        if (initialDealScrollFrameRef.current !== null) {
            window.cancelAnimationFrame(initialDealScrollFrameRef.current);
            initialDealScrollFrameRef.current = null;
        }
        initialDealScrollInterruptCleanupRef.current?.();
        initialDealScrollInterruptCleanupRef.current = null;
    }

    function startInitialDealScroll() {
        stopInitialDealScroll();
        cancelScrollAnimation();

        if (reducedMotion) {
            scrollToTable();
            return;
        }

        // Keep the table's editorial anchor in the viewport while its surface
        // grows and the deck travels down into the dealt hand. Re-measuring on
        // every frame avoids a one-time target becoming stale during layout
        // transitions and lets the scroll itself trigger the header collapse.
        initialDealScrollActiveRef.current = true;
        const interruptOnUserIntent = () => stopInitialDealScroll();
        const removeFollowInterrupts = () => {
            window.removeEventListener("wheel", interruptOnUserIntent);
            window.removeEventListener("touchstart", interruptOnUserIntent);
            window.removeEventListener("pointerdown", interruptOnUserIntent);
            window.removeEventListener("keydown", interruptOnUserIntent);
        };
        // Register after the activating click/keydown has finished bubbling.
        // Otherwise Enter/Space on the deck would immediately see this new
        // listener and cancel the follow loop it just started.
        window.requestAnimationFrame(() => {
            if (!initialDealScrollActiveRef.current) return;
            window.addEventListener("wheel", interruptOnUserIntent, { passive: true, once: true });
            window.addEventListener("touchstart", interruptOnUserIntent, { passive: true, once: true });
            window.addEventListener("pointerdown", interruptOnUserIntent, { passive: true, once: true });
            window.addEventListener("keydown", interruptOnUserIntent, { once: true });
            initialDealScrollInterruptCleanupRef.current = removeFollowInterrupts;
        });
        let previousTime = performance.now();
        const follow = (now: number) => {
            if (!initialDealScrollActiveRef.current || !mountedRef.current) {
                initialDealScrollFrameRef.current = null;
                return;
            }

            const targetTop = getTableScrollTarget();
            if (targetTop !== null) {
                const currentTop = window.scrollY;
                const elapsed = Math.max(0, now - previousTime);
                const easing = 1 - Math.exp(-Math.min(48, elapsed) / 180);
                const nextTop = currentTop + (targetTop - currentTop) * easing;
                if (Math.abs(targetTop - currentTop) > 0.25) {
                    window.scrollTo(0, nextTop);
                }
            }

            previousTime = now;
            initialDealScrollFrameRef.current = window.requestAnimationFrame(follow);
        };

        initialDealScrollFrameRef.current = window.requestAnimationFrame(follow);
    }

    function scrollToElement(target: HTMLElement | null, extraOffset = 0, visibleHeaderOffset?: number) {
        cancelScrollAnimation();
        if (!target) return;

        const startTop = window.scrollY;
        const stickyHeader = document.querySelector("header");
        const headerOffset =
            visibleHeaderOffset ??
            (stickyHeader instanceof HTMLElement ? stickyHeader.getBoundingClientRect().height + 4 : 32);
        const scrollOffset = headerOffset + extraOffset;
        const targetTop = Math.max(0, startTop + target.getBoundingClientRect().top - scrollOffset);

        if (reducedMotion) {
            // Keep the semantic anchor for assistive/browser tooling, then use
            // the measured visible-header offset as the actual destination.
            // scrollIntoView alone aligns the table to y=0, where a visible
            // sticky header would cover the progress row on compact screens.
            target.scrollIntoView({ behavior: "auto", block: "start" });
            window.scrollTo({ top: targetTop, behavior: "auto" });
            return;
        }

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

    useEffect(() => {
        if (finaleStage !== "collecting") return;

        const frame = window.requestAnimationFrame(() => {
            const countdown = finaleCountdownRef.current;
            if (!countdown) return;

            const stickyHeader = document.querySelector("header");
            const headerRect = stickyHeader instanceof HTMLElement ? stickyHeader.getBoundingClientRect() : null;
            const headerOffset = headerRect
                ? Math.max(0, Math.min(headerRect.height, headerRect.bottom)) + 12
                : 24;
            const countdownTop = window.scrollY + countdown.getBoundingClientRect().top;
            const targetTop = Math.max(0, countdownTop - headerOffset);
            if (Math.abs(targetTop - window.scrollY) > 8) {
                window.scrollTo({ top: targetTop, behavior: reducedMotion ? "auto" : "smooth" });
            }
        });

        return () => window.cancelAnimationFrame(frame);
    }, [finaleStage, reducedMotion]);

    function scrollToTable() {
        const target = tableRef.current;
        if (!target) return;

        const title = document.getElementById("beauty-movement-title");
        const stickyHeader = document.querySelector("header");
        const stickyHeaderRect = stickyHeader instanceof HTMLElement ? stickyHeader.getBoundingClientRect() : null;
        const headerOffset = stickyHeaderRect
            ? Math.max(0, Math.min(stickyHeaderRect.height, stickyHeaderRect.bottom)) + 4
            : 32;
        const titleRect = title instanceof HTMLElement ? title.getBoundingClientRect() : null;
        const tableTop = window.scrollY + target.getBoundingClientRect().top;
        const titleTop = titleRect ? window.scrollY + titleRect.top : null;
        const titleTarget = titleTop === null ? null : Math.max(0, titleTop - headerOffset - 12);
        const isStackedLayout = window.matchMedia("(max-width: 720px)").matches;
        const cardGrid = target.querySelector<HTMLElement>(`.${styles.cardGrid}`);
        const deck = target.querySelector<HTMLElement>(`.${styles.deckStage}`);
        const handBottom = cardGrid?.getBoundingClientRect().bottom ?? Math.max(
            target.getBoundingClientRect().top + 312,
            deck?.getBoundingClientRect().bottom ?? 0,
        );
        const handFitsAtTitle =
            titleTarget !== null &&
            handBottom - (titleTarget - window.scrollY) <= window.innerHeight + 24;
        const canAnchorTitle =
            titleTarget !== null &&
            !isStackedLayout &&
            Boolean(titleRect) &&
            (titleRect?.height ?? 0) <= window.innerHeight - headerOffset - 16 &&
            handFitsAtTitle;
        const titlePeek =
            !canAnchorTitle
                ? 0
                : Math.max(
                      Math.min(184, Math.max(0, Math.round((titleRect?.height ?? 0) - 2))),
                      tableTop - headerOffset - titleTarget,
                  );
        scrollToElement(target, titlePeek, headerOffset);
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
        startInitialDealScroll();
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
                                // Let the ready-state DOM commit once before
                                // releasing the follow loop, so the final
                                // card-grid layout is included in the anchor.
                                window.requestAnimationFrame(stopInitialDealScroll);
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
                            if (!confirmed) {
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
        // The deck is the visual anchor for a category handoff. Follow its
        // moving position from collection through the next deal so the page
        // does not jump after the cards return to the stack.
        startInitialDealScroll();
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
                                        window.requestAnimationFrame(() => {
                                            // Let the ready-state DOM commit once
                                            // so the follow loop includes the
                                            // final card/deck geometry.
                                            window.requestAnimationFrame(stopInitialDealScroll);
                                        });
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
        autoAdvanceScheduledRef.current = true;
        autoAdvancePendingRef.current = false;
        // The countdown belongs to the choice, not to the end of the flip.
        // Render it before the RAF/timer so a fast or throttled frame cannot
        // leave the category without feedback.
        setAutoAdvanceActive(true);
        autoAdvanceFrameRef.current = window.requestAnimationFrame(() => {
            autoAdvanceFrameRef.current = null;
            if (
                !mountedRef.current ||
                reducedMotionRef.current ||
                !autoAdvanceGateRef.current.isCurrent(token) ||
                (handStageRef.current !== "reveal" && handStageRef.current !== "held") ||
                displayedActIndexRef.current !== index ||
                finaleStageRef.current !== "hidden"
            ) {
                autoAdvanceScheduledRef.current = false;
                setAutoAdvanceActive(false);
                return;
            }

            autoAdvanceTimerRef.current = window.setTimeout(() => {
                autoAdvanceTimerRef.current = null;
                if (
                    !mountedRef.current ||
                    !autoAdvanceGateRef.current.isCurrent(token) ||
                    (handStageRef.current !== "reveal" && handStageRef.current !== "held") ||
                    displayedActIndexRef.current !== index ||
                    finaleStageRef.current !== "hidden"
                ) {
                    autoAdvanceScheduledRef.current = false;
                    autoAdvancePendingRef.current = false;
                    setAutoAdvanceActive(false);
                    return;
                }

                if (handStageRef.current === "reveal") {
                    // The fallback reveal timer will settle the card. Keep the
                    // completed countdown latched so settleReveal can advance
                    // immediately instead of silently dropping the hand.
                    autoAdvancePendingRef.current = true;
                    return;
                }

                autoAdvanceScheduledRef.current = false;
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
        if (!reducedMotion) return;
        cancelScrollAnimation();
        stopInitialDealScroll();
        // Keep the dependency-list shape stable for Fast Refresh. The
        // auto-advance cancellation was intentionally removed; this
        // dependency remains only to avoid a dev-time hook signature change.
    }, [reducedMotion, cancelAutoAdvance, cancelScrollAnimation, stopInitialDealScroll]);

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

    function handleProgressClick(index: number) {
        // Once the automatic handoff is armed, progress controls are passive:
        // user input must never turn a visible countdown into a cancellation.
        if (autoAdvanceActive) return;
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
        if (autoAdvancePendingRef.current) {
            autoAdvancePendingRef.current = false;
            autoAdvanceScheduledRef.current = false;
            setAutoAdvanceActive(false);
            moveToNextHand(actIndex);
        }
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
            scheduleNextHand(actIndex);
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

    function renderSpecialCard(
        revealed: boolean,
        action: SpecialCardAction = "none",
        settled = false,
        deferRevealContent = false,
    ) {
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
                className={`${styles.specialCard} ${settled ? styles.specialCardSettled : ""}`.trim()}
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
                        <div className={deferRevealContent ? styles.specialCardRevealContent : undefined}>
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
                        </div>
                        <span className={styles.specialCardSeal} aria-hidden="true">
                            <i />
                            <i />
                            <i />
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
                        {revealed && shareStatus ? <span className={styles.specialCardCopy} role="status">{shareStatus}</span> : null}
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

    return (
        <>
        <main className={styles.page} aria-hidden={isSpecialCardModalOpen || undefined}>
            <div className={styles.backgroundOrbOne} aria-hidden="true" />
            <div className={styles.backgroundOrbTwo} aria-hidden="true" />
            <div className={styles.rhythmThread} aria-hidden="true">
                <svg viewBox="0 0 1200 420" preserveAspectRatio="none" focusable="false">
                    <path className={styles.rhythmThreadRail} d="M 0 56 H 208" />
                    <path className={styles.rhythmThreadVein} d="M 208 56 C 306 56 310 166 412 166 C 516 166 522 86 628 86 C 742 86 728 244 844 244 C 960 244 976 156 1200 156" />
                    <circle className={styles.rhythmThreadBeat} cx="844" cy="244" r="4" />
                    <circle className={styles.rhythmThreadBeat} cx="876" cy="226" r="3.5" />
                    <circle className={styles.rhythmThreadBeat} cx="908" cy="210" r="3" />
                </svg>
            </div>

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
                    className={styles.tableStage}
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
                                                    disabled={!isCurrent || Boolean(progressMotion) || autoAdvanceActive}
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

                    {finaleStage === "assembling" || finaleStage === "collecting" || finaleStage === "merging" ? (
                        <div className={styles.finaleCountdownSlot} ref={finaleCountdownRef}>
                            {finaleStage === "collecting" ? (
                                <div
                                    className={styles.finaleCountdown}
                                    aria-hidden="true"
                                >
                                    <span className={styles.finaleCountdownLabel}>Sua leitura está se reunindo · 5 segundos</span>
                                    <span className={styles.finaleCountdownTrack} aria-hidden="true">
                                        <span className={styles.finaleCountdownBar} />
                                    </span>
                                </div>
                            ) : null}
                        </div>
                    ) : null}

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
                                        {renderSpecialCard(false, "none", false, true)}
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
                                {renderSpecialCard(false, isLocalPreview ? "confirm" : "none", true, true)}
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

                {finaleStage === "collecting" ? (
                    <p className={styles.srOnly} role="status" aria-live="polite">
                        Sua leitura está se reunindo. A carta especial aparece em cinco segundos.
                    </p>
                ) : null}

                {actionError && finaleStage === "hidden" ? (
                    <p className={styles.inlineError} role="alert">
                        {actionError}
                    </p>
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
