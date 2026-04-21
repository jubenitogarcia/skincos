"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { trackMetaPageView } from "@/lib/metaBrowser";

export default function MetaPageTracker() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const lastTrackedRef = useRef<string | null>(null);

    useEffect(() => {
        const search = searchParams?.toString() ?? "";
        const dedupeKey = `${pathname ?? ""}?${search}`;
        if (!pathname || lastTrackedRef.current === dedupeKey) return;

        const payload = {
            page_path: pathname,
            page_query: search || undefined,
        };
        const tracked = trackMetaPageView(payload);
        if (tracked) {
            lastTrackedRef.current = dedupeKey;
            return;
        }

        const timer = window.setTimeout(() => {
            if (trackMetaPageView(payload)) {
                lastTrackedRef.current = dedupeKey;
            }
        }, 250);
        return () => window.clearTimeout(timer);
    }, [pathname, searchParams]);

    return null;
}
