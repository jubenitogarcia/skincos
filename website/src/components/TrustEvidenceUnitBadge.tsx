"use client";

import { useEffect, useMemo, useState } from "react";
import { TRUST_EVIDENCE_UNITS } from "@/data/trustEvidence";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";

type TrustEvidenceUnitBadgeProps = {
    fallbackRating: number;
    fallbackTotalReviews: number;
};

type BadgeState = {
    rating: number;
    totalReviews: number;
};

type PlaceDetailsPayload = {
    available: boolean;
    rating?: number | null;
    userRatingsTotal?: number | null;
};

function clampRating(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(5, value));
}

function buildStars(rating: number): Array<"full" | "half" | "empty"> {
    const normalized = clampRating(rating);
    const full = Math.floor(normalized);
    const hasHalf = normalized - full >= 0.35 && normalized - full < 0.8;
    const empty = 5 - full - (hasHalf ? 1 : 0);
    return [
        ...Array.from({ length: full }, () => "full" as const),
        ...(hasHalf ? (["half"] as const) : []),
        ...Array.from({ length: empty }, () => "empty" as const),
    ];
}

export default function TrustEvidenceUnitBadge({ fallbackRating, fallbackTotalReviews }: TrustEvidenceUnitBadgeProps) {
    const unit = useCurrentUnit();
    const staticUnitFallback = useMemo(
        () => TRUST_EVIDENCE_UNITS.find((item) => item.slug === unit?.slug) ?? null,
        [unit?.slug],
    );

    const [badgeState, setBadgeState] = useState<BadgeState>({
        rating: fallbackRating,
        totalReviews: fallbackTotalReviews,
    });

    useEffect(() => {
        if (!unit) {
            setBadgeState({ rating: fallbackRating, totalReviews: fallbackTotalReviews });
            return;
        }

        if (staticUnitFallback) {
            setBadgeState({
                rating: staticUnitFallback.rating,
                totalReviews: staticUnitFallback.userRatingsTotal,
            });
        }

        const placeId = (unit.placeId ?? "").trim();
        if (!placeId) return;

        const controller = new AbortController();

        async function run() {
            try {
                const url = new URL("/api/places/details", window.location.origin);
                url.searchParams.set("placeId", placeId);
                const response = await fetch(url.toString(), {
                    cache: "no-store",
                    signal: controller.signal,
                });
                if (!response.ok) return;
                const payload = (await response.json()) as PlaceDetailsPayload;
                if (!payload.available) return;

                const nextRating = typeof payload.rating === "number" && Number.isFinite(payload.rating) ? payload.rating : null;
                const nextTotal = typeof payload.userRatingsTotal === "number" && Number.isFinite(payload.userRatingsTotal) ? payload.userRatingsTotal : null;
                if (nextRating === null || nextTotal === null) return;

                setBadgeState({
                    rating: nextRating,
                    totalReviews: nextTotal,
                });
            } catch {
                // Keep the current fallback badge if the live fetch fails.
            }
        }

        void run();
        return () => controller.abort();
    }, [fallbackRating, fallbackTotalReviews, staticUnitFallback, unit]);

    const stars = buildStars(badgeState.rating);

    return (
        <article className="trustEvidenceBand__card trustEvidenceBand__card--reviews" role="listitem">
            <div className="trustEvidenceBand__stars" aria-label={`Avaliação ${badgeState.rating.toFixed(1)} de 5`}>
                {stars.map((star, index) => (
                    <span
                        key={`${star}-${index}`}
                        className={star === "empty" ? "is-empty" : star === "half" ? "is-half" : ""}
                        aria-hidden="true"
                    >
                        ★
                    </span>
                ))}
            </div>
            <div className="trustEvidenceBand__reviewsMetric">
                <strong>{badgeState.rating.toFixed(1)}</strong>
                <em>{badgeState.totalReviews} avaliações</em>
            </div>
            <span>Avaliações no Google.</span>
        </article>
    );
}
