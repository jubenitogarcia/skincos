"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const TARGET_HASHES = new Set(["#doutores"]);

function getHeaderOffsetPx(): number {
    const header = document.querySelector(".header") as HTMLElement | null;
    if (!header) return 0;
    const rect = header.getBoundingClientRect();
    return Math.max(0, Math.ceil(rect.height));
}

function scrollToHash(hash: string): boolean {
    const targetId = decodeURIComponent(hash.replace(/^#/, ""));
    if (!targetId) return false;

    const target = document.getElementById(targetId);
    if (!target) return false;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = Math.max(0, window.scrollY + target.getBoundingClientRect().top - getHeaderOffsetPx());
    window.scrollTo({
        top,
        behavior: reduceMotion ? "auto" : "smooth",
    });

    return true;
}

export default function HomeHashScroller() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const searchKey = searchParams.toString();

    useEffect(() => {
        if (pathname !== "/") return;

        const hash = window.location.hash;
        if (!TARGET_HASHES.has(hash)) return;

        let attempts = 0;
        const maxAttempts = 8;

        const interval = window.setInterval(() => {
            attempts += 1;
            if (scrollToHash(hash) || attempts >= maxAttempts) {
                window.clearInterval(interval);
            }
        }, 120);

        // Immediate first try for cases where the section is already mounted.
        if (scrollToHash(hash)) window.clearInterval(interval);

        return () => {
            window.clearInterval(interval);
        };
    }, [pathname, searchKey]);

    return null;
}
