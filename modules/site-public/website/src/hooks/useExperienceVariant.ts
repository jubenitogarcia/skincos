"use client";

import { useMemo } from "react";
import { campaignParamsForEvent } from "@/lib/campaign";
import { resolveExperienceVariant } from "@/lib/experienceVariant";

export function useExperienceVariant(page: string, fallback: string) {
    return useMemo(() => {
        return resolveExperienceVariant(page, fallback, campaignParamsForEvent());
    }, [fallback, page]);
}
