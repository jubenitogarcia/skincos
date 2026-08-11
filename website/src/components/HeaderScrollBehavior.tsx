"use client";

import { useEffect } from "react";

/** Keeps the campaign header available while reclaiming vertical space during downward scroll. */
export default function HeaderScrollBehavior() {
    useEffect(() => {
        const header = document.querySelector<HTMLElement>('[data-scroll-aware-header="true"]');
        if (!header) return;

        let lastScrollY = Math.max(window.scrollY, 0);
        let frame: number | null = null;

        const revealHeader = () => {
            header.classList.remove("header--hidden");
        };

        const update = () => {
            const currentScrollY = Math.max(window.scrollY, 0);
            const delta = currentScrollY - lastScrollY;

            if (currentScrollY <= 12 || delta < -4) {
                revealHeader();
            } else if (delta > 4) {
                header.classList.add("header--hidden");
            }

            if (Math.abs(delta) > 4) lastScrollY = currentScrollY;
            frame = null;
        };

        const handleScroll = () => {
            if (frame !== null) return;
            frame = window.requestAnimationFrame(update);
        };

        const handleFocusIn = () => revealHeader();
        const handleKeyboardIntent = (event: KeyboardEvent) => {
            if (event.key === "Tab" || event.key === "Home" || event.key === "End") revealHeader();
        };

        window.addEventListener("scroll", handleScroll, { passive: true });
        header.addEventListener("focusin", handleFocusIn);
        window.addEventListener("keydown", handleKeyboardIntent, true);
        return () => {
            window.removeEventListener("scroll", handleScroll);
            header.removeEventListener("focusin", handleFocusIn);
            window.removeEventListener("keydown", handleKeyboardIntent, true);
            if (frame !== null) window.cancelAnimationFrame(frame);
            revealHeader();
        };
    }, []);

    return null;
}
