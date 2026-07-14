import { NextResponse } from "next/server";
import { units } from "@/data/units";
import { fetchAllGoogleGbpReviews } from "@/lib/googleGbp";
import { recordGbpReviewSyncRun, replaceUnitGbpReviews } from "@/lib/gbpReviewsDb";

export const dynamic = "force-dynamic";

const TARGET_UNIT_SLUGS = ["barrashoppingsul", "novo-hamburgo"] as const;

function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let ok = 0;
    for (let i = 0; i < a.length; i++) ok |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return ok === 0;
}

function getSyncToken(): string {
    return (process.env.GBP_DIAGNOSTICS_TOKEN ?? process.env.AGENDA_SYNC_TOKEN ?? "").trim();
}

function isAuthorized(req: Request): boolean {
    const expected = getSyncToken();
    if (!expected) return false;
    const auth = (req.headers.get("authorization") ?? "").trim();
    if (!auth.toLowerCase().startsWith("bearer ")) return false;
    const received = auth.slice("bearer ".length).trim();
    return constantTimeEqual(received, expected);
}

function makeRunId(unitSlug: string, startedAtMs: number): string {
    return `gbp_${unitSlug}_${startedAtMs}`;
}

export async function POST(req: Request) {
    if (!isAuthorized(req)) {
        return new NextResponse("Unauthorized", {
            status: 401,
            headers: { "www-authenticate": "Bearer", "cache-control": "no-store" },
        });
    }

    const targetUnits = units.filter(
        (unit) =>
            TARGET_UNIT_SLUGS.includes(unit.slug as (typeof TARGET_UNIT_SLUGS)[number]) &&
            (unit.gbpLocation ?? "").trim() &&
            (unit.placeId ?? "").trim(),
    );

    const results: Array<{
        unitSlug: string;
        ok: boolean;
        fetchedReviews: number;
        averageRating: number | null;
        totalReviewCount: number;
        error?: string;
    }> = [];

    for (const unit of targetUnits) {
        const startedAtMs = Date.now();
        const runId = makeRunId(unit.slug, startedAtMs);

        try {
            const fetched = await fetchAllGoogleGbpReviews((unit.gbpLocation ?? "").trim());
            await replaceUnitGbpReviews({
                unitSlug: unit.slug,
                placeId: (unit.placeId ?? "").trim(),
                gbpLocation: (unit.gbpLocation ?? "").trim() || null,
                locationResourceName: fetched.locationResourceName,
                averageRating: fetched.averageRating,
                totalReviews: fetched.totalReviewCount,
                reviews: fetched.reviews,
                syncedAtMs: Date.now(),
            });

            await recordGbpReviewSyncRun({
                id: runId,
                unitSlug: unit.slug,
                placeId: (unit.placeId ?? "").trim(),
                startedAtMs,
                finishedAtMs: Date.now(),
                success: true,
                fetchedReviews: fetched.reviews.length,
            });

            results.push({
                unitSlug: unit.slug,
                ok: true,
                fetchedReviews: fetched.reviews.length,
                averageRating: fetched.averageRating,
                totalReviewCount: fetched.totalReviewCount,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "sync_failed";
            await recordGbpReviewSyncRun({
                id: runId,
                unitSlug: unit.slug,
                placeId: (unit.placeId ?? "").trim(),
                startedAtMs,
                finishedAtMs: Date.now(),
                success: false,
                fetchedReviews: 0,
                error: message,
            });

            results.push({
                unitSlug: unit.slug,
                ok: false,
                fetchedReviews: 0,
                averageRating: null,
                totalReviewCount: 0,
                error: message,
            });
        }
    }

    const ok = results.every((result) => result.ok);
    return NextResponse.json(
        {
            ok,
            units: results,
        },
        {
            status: ok ? 200 : 207,
            headers: { "cache-control": "no-store", "x-gbp-sync": "reviews_db" },
        },
    );
}
