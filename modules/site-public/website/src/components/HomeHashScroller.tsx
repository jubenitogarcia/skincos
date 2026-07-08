"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { alignHashTarget } from "@/lib/hashNavigation";

const ALIGNMENT_TOLERANCE_PX = 2;

export default function HomeHashScroller() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const searchKey = searchParams.toString();
    const [hash, setHash] = useState(() => (typeof window === "undefined" ? "" : window.location.hash));

    useEffect(() => {
        const syncHash = () => {
            setHash(window.location.hash);
        };

        syncHash();
        window.addEventListener("hashchange", syncHash);
        return () => {
            window.removeEventListener("hashchange", syncHash);
        };
    }, []);

    useEffect(() => {
        setHash(window.location.hash);
    }, [pathname, searchKey]);

    useLayoutEffect(() => {
        if (!hash) return;

        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        let attempts = 0;
        let alignedChecks = 0;
        const maxAttempts = 18;

        const interval = window.setInterval(() => {
            attempts += 1;
            const result = alignHashTarget(hash, reduceMotion || attempts > 1 ? "auto" : "smooth", ALIGNMENT_TOLERANCE_PX);
            alignedChecks = result.aligned ? alignedChecks + 1 : 0;
            if ((result.found && alignedChecks >= 2) || attempts >= maxAttempts) {
                window.clearInterval(interval);
            }
        }, 120);

        const initial = alignHashTarget(hash, reduceMotion ? "auto" : "smooth", ALIGNMENT_TOLERANCE_PX);
        alignedChecks = initial.aligned ? 1 : 0;
        if (initial.found && initial.aligned) {
            const settleTimer = window.setTimeout(() => {
                const settled = alignHashTarget(hash, "auto", ALIGNMENT_TOLERANCE_PX);
                if (settled.found && settled.aligned) {
                    window.clearInterval(interval);
                }
            }, 180);

            return () => {
                window.clearInterval(interval);
                window.clearTimeout(settleTimer);
            };
        }

        return () => {
            window.clearInterval(interval);
        };
    }, [hash, pathname, searchKey]);

    return null;
}
