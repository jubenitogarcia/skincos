"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { units, type Unit } from "@/data/units";
import { getStoredUnitSlug, setStoredUnitSlug } from "@/lib/unitSelection";

function findUnitBySlug(slug: string | null | undefined): Unit | null {
    if (!slug) return null;
    return units.find((u) => u.slug === slug) ?? null;
}

function normalizeSlug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findUnitBySlugOrAlias(slug: string | null | undefined): Unit | null {
    if (!slug) return null;
    return (
        units.find((u) => u.slug === slug) ??
        units.find((u) => normalizeSlug(u.slug) === normalizeSlug(slug)) ??
        null
    );
}

export function useCurrentUnit(): Unit | null {
    const pathname = usePathname();

    const slugFromPath = useMemo(() => {
        if (!pathname) return null;
        const parts = pathname.split("/").filter(Boolean);
        if (parts.length === 0) return null;
        if (parts[0] === "unidades") return parts[1] ?? null;
        return parts[0] ?? null;
    }, [pathname]);

    const unitFromPath = useMemo(() => findUnitBySlugOrAlias(slugFromPath), [slugFromPath]);

    const [storedSlug, setStoredSlug] = useState<string | null>(null);

    useEffect(() => {
        if (typeof window === "undefined") return;
        setStoredSlug(getStoredUnitSlug());
    }, [pathname]);

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

    const unit = unitFromPath ?? unitFromStorage;

    useEffect(() => {
        if (unitFromPath?.slug) setStoredUnitSlug(unitFromPath.slug);
    }, [unitFromPath?.slug]);

    return unit;
}
