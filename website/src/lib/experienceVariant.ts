export type ExperienceResolution = {
    variant: string;
    source: "default" | "query" | "campaign" | "session";
};

export function sanitizeExperienceVariant(value: string): string {
    const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return cleaned || "default";
}

export function resolveExperienceVariant(
    page: string,
    fallback: string,
    campaignParams: Record<string, string> = {},
): ExperienceResolution {
    if (typeof window === "undefined") {
        return { variant: sanitizeExperienceVariant(fallback), source: "default" };
    }

    const storageKey = `ef_experience_variant:${page}`;

    try {
        const params = new URLSearchParams(window.location.search);
        const explicitVariant = params.get("ef_variant") ?? params.get("variant");
        if (explicitVariant && explicitVariant.trim()) {
            const variant = sanitizeExperienceVariant(explicitVariant);
            window.sessionStorage.setItem(storageKey, variant);
            return { variant, source: "query" };
        }
    } catch {
        // noop
    }

    const utmContent = typeof campaignParams.utm_content === "string" ? campaignParams.utm_content : "";
    if (utmContent.trim()) {
        const variant = `campaign-${sanitizeExperienceVariant(utmContent)}`;
        try {
            window.sessionStorage.setItem(storageKey, variant);
        } catch {
            // noop
        }
        return { variant, source: "campaign" };
    }

    try {
        const storedVariant = window.sessionStorage.getItem(storageKey);
        if (storedVariant && storedVariant.trim()) {
            return { variant: sanitizeExperienceVariant(storedVariant), source: "session" };
        }
    } catch {
        // noop
    }

    const variant = sanitizeExperienceVariant(fallback);
    try {
        window.sessionStorage.setItem(storageKey, variant);
    } catch {
        // noop
    }
    return { variant, source: "default" };
}
