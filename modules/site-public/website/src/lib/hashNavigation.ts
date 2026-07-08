"use client";

const HEADER_SELECTOR = ".header";
let activeScrollAnimationFrame: number | null = null;

export type ResolvedHashHref = {
    hash: string;
    href: string;
    pathname: string;
    search: string;
};

export function resolveInternalHashHref(href: string): ResolvedHashHref | null {
    if (typeof window === "undefined") return null;

    try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin || !url.hash) return null;

        return {
            hash: url.hash,
            href: `${url.pathname}${url.search}${url.hash}`,
            pathname: url.pathname,
            search: url.search,
        };
    } catch {
        return null;
    }
}

export function getHeaderOffsetPx(): number {
    if (typeof document === "undefined") return 0;

    const header = document.querySelector(HEADER_SELECTOR) as HTMLElement | null;
    if (!header) return 0;

    const rect = header.getBoundingClientRect();
    return Math.max(0, Math.ceil(rect.height));
}

function stopActiveScrollAnimation() {
    if (activeScrollAnimationFrame === null) return;
    window.cancelAnimationFrame(activeScrollAnimationFrame);
    activeScrollAnimationFrame = null;
}

function animateWindowScrollTo(top: number) {
    stopActiveScrollAnimation();

    const startTop = window.scrollY;
    const delta = top - startTop;
    if (Math.abs(delta) <= 1) {
        window.scrollTo({ top, behavior: "auto" });
        return;
    }

    const durationMs = Math.min(360, Math.max(220, Math.abs(delta) * 0.12));
    let startTime = 0;

    const step = (timestamp: number) => {
        if (!startTime) startTime = timestamp;
        const progress = Math.min(1, (timestamp - startTime) / durationMs);
        const eased = 1 - Math.pow(1 - progress, 3);
        window.scrollTo({ top: startTop + delta * eased, behavior: "auto" });

        if (progress < 1) {
            activeScrollAnimationFrame = window.requestAnimationFrame(step);
            return;
        }

        activeScrollAnimationFrame = null;
    };

    activeScrollAnimationFrame = window.requestAnimationFrame(step);
}

export function alignHashTarget(hash: string, behavior: ScrollBehavior, tolerancePx = 2): { found: boolean; aligned: boolean } {
    if (typeof window === "undefined" || typeof document === "undefined") {
        return { found: false, aligned: false };
    }

    const targetId = decodeURIComponent(hash.replace(/^#/, ""));
    if (!targetId) return { found: false, aligned: false };

    const target = document.getElementById(targetId);
    if (!target) return { found: false, aligned: false };

    const headerOffsetPx = getHeaderOffsetPx();
    const delta = target.getBoundingClientRect().top - headerOffsetPx;
    const aligned = Math.abs(delta) <= tolerancePx;

    if (!aligned) {
        const top = Math.max(0, window.scrollY + delta);
        if (behavior === "smooth") {
            animateWindowScrollTo(top);
        } else if (activeScrollAnimationFrame === null) {
            window.scrollTo({ top, behavior: "auto" });
        }
    }

    return { found: true, aligned };
}
