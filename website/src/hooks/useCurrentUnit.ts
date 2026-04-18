"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { units, type Unit } from "@/data/units";
import { normalizeUnitSlug } from "@/lib/unitRoutes";
import { getStoredUnitSlug, setStoredUnitSlug } from "@/lib/unitSelection";

function findUnitBySlug(slug: string | null | undefined): Unit | null {
    if (!slug) return null;
    return units.find((u) => u.slug === slug) ?? null;
}

function findUnitBySlugOrAlias(slug: string | null | undefined): Unit | null {
    if (!slug) return null;
    return (
        units.find((u) => u.slug === slug) ??
        units.find((u) => normalizeUnitSlug(u.slug) === normalizeUnitSlug(slug)) ??
        null
    );
}

export function useCurrentUnit(): Unit | null {
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const slugFromPath = useMemo(() => {
        if (!pathname) return null;
        const parts = pathname.split("/").filter(Boolean);
        if (parts.length === 0) return null;
        if (parts[0] === "unidades") return parts[1] ?? null;
        return parts[0] ?? null;
    }, [pathname]);

    const unitFromPath = useMemo(() => findUnitBySlugOrAlias(slugFromPath), [slugFromPath]);
    const slugFromQuery = useMemo(() => searchParams?.get("unit") ?? null, [searchParams]);
    const unitFromQuery = useMemo(() => findUnitBySlugOrAlias(slugFromQuery), [slugFromQuery]);

    const [storedSlug, setStoredSlug] = useState<string | null>(() => getStoredUnitSlug());

    useEffect(() => {
        if (typeof window === "undefined") return;
        setStoredSlug(getStoredUnitSlug());
    }, [pathname, searchParams]);

    useEffect(() => {
        function onUnitChange(e: Event) {
            const ce = e as CustomEvent<{ slug?: string }>;
            const next = ce?.detail?.slug ?? getStoredUnitSlug();
            setStoredSlug(next ?? null);
        }

        window.addEventListener("ef:unit-change", onUnitChange);
        return () => window.removeEventListener("ef:unit-change", onUnitChange);
    }, []);

    const unitFromStorage = useMemo(() => findUnitBySlug(storedSlug), [storedSlug]);

    const unit = unitFromPath ?? unitFromQuery ?? unitFromStorage;

    useEffect(() => {
        const activeSlug = unitFromPath?.slug ?? unitFromQuery?.slug ?? null;
        if (activeSlug) setStoredUnitSlug(activeSlug);
    }, [unitFromPath?.slug, unitFromQuery?.slug]);

    return unit;
}
