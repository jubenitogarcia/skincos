import barraShoppingSulReviews from "../../tmp/manual-reviews/barrashoppingsul.manual-google-reviews.json";
import novoHamburgoReviews from "../../tmp/manual-reviews/novo-hamburgo.manual-google-reviews.json";
import { units } from "@/data/units";

type ManualReviewRecord = {
    id: string;
    name: string;
    rating: number | null;
    timeText: string;
    text: string;
};

type ManualReviewFile = {
    unitSlug: string;
    exportedAt?: string;
    summary?: {
        average?: number;
        totalReviews?: number;
    };
    reviews: ManualReviewRecord[];
};

export type ManualGbpReviewPayload = {
    reviewId: string;
    authorName: string;
    profilePhotoUrl: null;
    rating: number | null;
    text: string;
    relativeTimeDescription: string;
    time: number | null;
};

export type ManualGbpUnitReviews = {
    summary: {
        unitSlug: string;
        placeId: string;
        averageRating: number | null;
        totalReviews: number;
        reviewsSynced: number;
        syncedAtMs: number;
    };
    reviews: ManualGbpReviewPayload[];
    nextPageToken: string | null;
};

const MANUAL_REVIEW_FILES = [barraShoppingSulReviews, novoHamburgoReviews] as ManualReviewFile[];

function toNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function getExportedAtMs(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveUnitSlugByPlaceId(placeId: string): string | null {
    const normalized = (placeId ?? "").trim();
    if (!normalized) return null;
    const unit = units.find((entry) => (entry.placeId ?? "").trim() === normalized);
    return unit?.slug ?? null;
}

function computeAverageFromReviews(reviews: ManualReviewRecord[]): number | null {
    const rated = reviews.filter((review) => typeof review.rating === "number");
    if (!rated.length) return null;
    const total = rated.reduce((sum, review) => sum + (review.rating ?? 0), 0);
    return total / rated.length;
}

export function getManualGbpUnitReviews(params: { placeId: string; limit: number; offset?: number }): ManualGbpUnitReviews | null {
    const unitSlug = resolveUnitSlugByPlaceId(params.placeId);
    if (!unitSlug) return null;

    const file = MANUAL_REVIEW_FILES.find((entry) => entry.unitSlug === unitSlug);
    if (!file) return null;

    const offset = Math.max(0, Math.floor(params.offset ?? 0));
    const limit = Math.max(1, Math.floor(params.limit));
    const exportedAtMs = getExportedAtMs(file.exportedAt, Date.UTC(2026, 3, 1));
    const totalReviews = file.reviews.length;
    const averageRating = toNumber(file.summary?.average) ?? computeAverageFromReviews(file.reviews);
    const sliced = file.reviews.slice(offset, offset + limit);
    const nextOffset = offset + sliced.length;

    return {
        summary: {
            unitSlug,
            placeId: params.placeId,
            averageRating,
            totalReviews,
            reviewsSynced: totalReviews,
            syncedAtMs: exportedAtMs,
        },
        reviews: sliced.map((review, index) => ({
            reviewId: review.id,
            authorName: review.name,
            profilePhotoUrl: null,
            rating: typeof review.rating === "number" ? review.rating : null,
            text: review.text ?? "",
            relativeTimeDescription: review.timeText ?? "",
            time: exportedAtMs - (offset + index) * 1000,
        })),
        nextPageToken: nextOffset < totalReviews ? String(nextOffset) : null,
    };
}
