"use client";

import { useEffect } from "react";
import { setStoredUnitSlug } from "@/lib/unitSelection";

export default function UnitSelectionSync({ slug }: { slug: string }) {
    useEffect(() => {
        setStoredUnitSlug(slug);
    }, [slug]);

    return null;
}
