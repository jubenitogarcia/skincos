"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import { campaignParamsForEvent } from "@/lib/campaign";
import { persistExperienceContext } from "@/lib/experienceContext";
import { resolveExperienceVariant } from "@/lib/experienceVariant";

type ExperienceTrackerProps = {
    page: string;
    experience: string;
    variant: string;
};

export default function ExperienceTracker({ page, experience, variant }: ExperienceTrackerProps) {
    useEffect(() => {
        const resolved = resolveExperienceVariant(page, variant, campaignParamsForEvent());
        persistExperienceContext({
            page,
            experience,
            variant: resolved.variant,
            variantSource: resolved.source,
        });

        trackEvent("landing_experience_view", {
            page,
            experience,
            variant: resolved.variant,
            variantSource: resolved.source,
            experienceKey: `${page}:${experience}`,
        });
    }, [experience, page, variant]);

    return null;
}
