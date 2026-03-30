"use client";

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type MouseEvent as ReactMouseEvent,
    type MutableRefObject,
} from "react";

type Direction = "left" | "right";

type UseHorizontalRailOptions = {
    railRef?: MutableRefObject<HTMLDivElement | null>;
    itemSelector: string;
    fallbackMinStep?: number;
    fallbackStepRatio?: number;
    lockMs?: number;
    baseVelocity?: number;
    maxVelocity?: number;
    edgeThresholdPx?: number;
    edgeThresholdRatio?: number;
    velocitySmoothingMs?: number;
};

export default function useHorizontalRail({
    railRef: externalRailRef,
    itemSelector,
    fallbackMinStep = 180,
    fallbackStepRatio = 0.52,
    lockMs = 720,
    baseVelocity = 0.02,
    maxVelocity = 0.18,
    edgeThresholdPx = 124,
    edgeThresholdRatio = 0.18,
    velocitySmoothingMs = 180,
}: UseHorizontalRailOptions) {
    const internalRailRef = useRef<HTMLDivElement | null>(null);
    const railRef = externalRailRef ?? internalRailRef;

    const autoScrollFrameRef = useRef<number | null>(null);
    const autoScrollVelocityRef = useRef(0);
    const autoScrollTargetVelocityRef = useRef(0);
    const autoScrollLastTsRef = useRef<number | null>(null);
    const settleRafRef = useRef<number | null>(null);
    const triggerLockRef = useRef(false);

    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);
    const [hoverEdge, setHoverEdge] = useState<Direction | null>(null);

    const updateScrollState = useCallback(() => {
        const rail = railRef.current;
        if (!rail) {
            setCanScrollLeft(false);
            setCanScrollRight(false);
            return;
        }

        const epsilon = 1;
        const left = rail.scrollLeft;
        const rightEdge = left + rail.clientWidth;
        const maxRightEdge = rail.scrollWidth;

        setCanScrollLeft(left > epsilon);
        setCanScrollRight(rightEdge < maxRightEdge - epsilon);
    }, [railRef]);

    const syncScrollStateUntilSettled = useCallback(() => {
        const rail = railRef.current;
        if (!rail) return;

        if (settleRafRef.current) {
            window.cancelAnimationFrame(settleRafRef.current);
            settleRafRef.current = null;
        }

        let previousLeft = rail.scrollLeft;
        let stableFrames = 0;

        const tick = () => {
            const currentRail = railRef.current;
            if (!currentRail) return;

            updateScrollState();
            const currentLeft = currentRail.scrollLeft;

            if (Math.abs(currentLeft - previousLeft) < 0.25) {
                stableFrames += 1;
            } else {
                stableFrames = 0;
            }

            previousLeft = currentLeft;

            if (stableFrames >= 4) {
                settleRafRef.current = null;
                updateScrollState();
                return;
            }

            settleRafRef.current = window.requestAnimationFrame(tick);
        };

        settleRafRef.current = window.requestAnimationFrame(tick);
    }, [railRef, updateScrollState]);

    const stopHoverScroll = useCallback((immediate = false) => {
        autoScrollTargetVelocityRef.current = 0;
        setHoverEdge(null);

        if (!immediate) return;

        autoScrollVelocityRef.current = 0;
        autoScrollLastTsRef.current = null;
        if (autoScrollFrameRef.current) {
            window.cancelAnimationFrame(autoScrollFrameRef.current);
            autoScrollFrameRef.current = null;
        }
    }, []);

    const startHoverScroll = useCallback(() => {
        if (autoScrollFrameRef.current) return;

        const tick = (timestamp: number) => {
            const rail = railRef.current;
            if (!rail) {
                autoScrollFrameRef.current = null;
                autoScrollLastTsRef.current = null;
                return;
            }

            const previousTs = autoScrollLastTsRef.current ?? timestamp - 16.67;
            const dt = Math.min(32, Math.max(8, timestamp - previousTs));
            autoScrollLastTsRef.current = timestamp;

            const smoothing = 1 - Math.exp(-dt / velocitySmoothingMs);
            autoScrollVelocityRef.current +=
                (autoScrollTargetVelocityRef.current - autoScrollVelocityRef.current) * smoothing;

            const velocity = autoScrollVelocityRef.current;
            if (Math.abs(autoScrollTargetVelocityRef.current) < 0.001 && Math.abs(velocity) < 0.001) {
                autoScrollFrameRef.current = null;
                autoScrollLastTsRef.current = null;
                autoScrollVelocityRef.current = 0;
                return;
            }

            rail.scrollBy({ left: velocity * (dt / 16.67), behavior: "auto" });
            updateScrollState();
            autoScrollFrameRef.current = window.requestAnimationFrame(tick);
        };

        autoScrollFrameRef.current = window.requestAnimationFrame(tick);
    }, [railRef, updateScrollState, velocitySmoothingMs]);

    const setHoverFromProgress = useCallback(
        (direction: Direction, progress: number) => {
            const canScroll = direction === "left" ? canScrollLeft : canScrollRight;
            if (!canScroll) {
                stopHoverScroll();
                return;
            }

            const eased = Math.min(1, Math.max(0, progress)) ** 2;
            setHoverEdge(direction);
            autoScrollTargetVelocityRef.current = (baseVelocity + eased * maxVelocity) * (direction === "right" ? 1 : -1);
            startHoverScroll();
        },
        [baseVelocity, canScrollLeft, canScrollRight, maxVelocity, startHoverScroll, stopHoverScroll],
    );

    const handleEdgeMouse = useCallback(
        (direction: Direction, event: ReactMouseEvent<HTMLElement>) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const relativeX = event.clientX - bounds.left;
            const progress = direction === "left" ? 1 - relativeX / bounds.width : relativeX / bounds.width;
            setHoverFromProgress(direction, progress);
        },
        [setHoverFromProgress],
    );

    const handleContainerMouseMove = useCallback(
        (event: ReactMouseEvent<HTMLElement>) => {
            const rail = railRef.current;
            if (!rail) return;

            const rect = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const threshold = Math.min(edgeThresholdPx, rect.width * edgeThresholdRatio);

            if (x <= threshold && canScrollLeft) {
                setHoverFromProgress("left", 1 - x / threshold);
                return;
            }

            if (rect.width - x <= threshold && canScrollRight) {
                setHoverFromProgress("right", 1 - (rect.width - x) / threshold);
                return;
            }

            stopHoverScroll();
        },
        [canScrollLeft, canScrollRight, edgeThresholdPx, edgeThresholdRatio, railRef, setHoverFromProgress, stopHoverScroll],
    );

    const scrollByDirection = useCallback(
        (direction: Direction) => {
            if (triggerLockRef.current) return;
            const rail = railRef.current;
            if (!rail) return;

            const items = Array.from(rail.querySelectorAll<HTMLElement>(itemSelector));
            const currentLeft = rail.scrollLeft;
            const railStyle = window.getComputedStyle(rail);
            const paddingLeft = Number.parseFloat(railStyle.paddingLeft || "0") || 0;
            const epsilon = 2;

            const target =
                direction === "right"
                    ? items.find((item) => item.offsetLeft - paddingLeft > currentLeft + epsilon)
                    : [...items].reverse().find((item) => item.offsetLeft - paddingLeft < currentLeft - epsilon);

            const targetLeft = target
                ? target.offsetLeft - paddingLeft
                : currentLeft + (direction === "right" ? 1 : -1) * Math.max(fallbackMinStep, Math.floor(rail.clientWidth * fallbackStepRatio));

            triggerLockRef.current = true;
            window.setTimeout(() => {
                triggerLockRef.current = false;
            }, lockMs);

            rail.scrollTo({ left: targetLeft, behavior: "smooth" });
            updateScrollState();
            syncScrollStateUntilSettled();
        },
        [fallbackMinStep, fallbackStepRatio, itemSelector, lockMs, railRef, syncScrollStateUntilSettled, updateScrollState],
    );

    useEffect(() => {
        updateScrollState();
        const rail = railRef.current;
        if (!rail) return;

        rail.addEventListener("scroll", updateScrollState, { passive: true });
        window.addEventListener("resize", updateScrollState);

        let observer: ResizeObserver | null = null;
        let mutationObserver: MutationObserver | null = null;

        const observeChildren = () => {
            if (!observer) return;
            Array.from(rail.children).forEach((child) => observer?.observe(child));
        };

        if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(() => updateScrollState());
            observer.observe(rail);
            observeChildren();
        }

        if (typeof MutationObserver !== "undefined") {
            mutationObserver = new MutationObserver(() => {
                observeChildren();
                window.requestAnimationFrame(updateScrollState);
            });
            mutationObserver.observe(rail, { childList: true });
        }

        const raf = window.requestAnimationFrame(updateScrollState);

        return () => {
            rail.removeEventListener("scroll", updateScrollState);
            window.removeEventListener("resize", updateScrollState);
            window.cancelAnimationFrame(raf);
            mutationObserver?.disconnect();
            observer?.disconnect();
            if (settleRafRef.current) {
                window.cancelAnimationFrame(settleRafRef.current);
                settleRafRef.current = null;
            }
        };
    }, [railRef, updateScrollState]);

    useEffect(() => () => stopHoverScroll(true), [stopHoverScroll]);

    return {
        railRef,
        canScrollLeft,
        canScrollRight,
        hoverEdge,
        updateScrollState,
        handleEdgeMouse,
        handleContainerMouseMove,
        clearHoverScroll: stopHoverScroll,
        scrollByDirection,
    };
}
