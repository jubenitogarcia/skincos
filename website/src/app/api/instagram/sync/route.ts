import { NextResponse } from "next/server";
import { getRuntimeSecret } from "@/lib/runtimeSecrets";
import {
    INSTAGRAM_SYNC_TTL_MS,
    isInstagramProfileStale,
    normalizeInstagramHandleInput,
    resolveDoctorInstagramHandles,
    type SyncHandleResult,
    syncInstagramHandlesBatch,
} from "@/lib/instagramSync";

export const dynamic = "force-dynamic";

type SyncPayload = {
    handles?: string[];
    includeStories?: boolean;
    force?: boolean;
    maxFeedItems?: number;
    concurrency?: number;
    maxHandleRetries?: number;
    retryDelayMs?: number;
    source?: string;
};

type SyncHandleResultWithAttempts = SyncHandleResult & {
    attempts: number;
};

function json(data: unknown, init?: ResponseInit) {
    return NextResponse.json(data, init);
}

function readToken(request: Request): string {
    const auth = (request.headers.get("authorization") ?? "").trim();
    if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
    return (request.headers.get("x-instagram-sync-token") ?? "").trim();
}

async function assertToken(request: Request): Promise<boolean> {
    const secret = await getRuntimeSecret("INSTAGRAM_SYNC_TOKEN");
    if (process.env.NODE_ENV === "production" && !secret) return false;
    if (!secret) return true;
    return readToken(request) === secret;
}

function normalizeBool(value: unknown, defaultValue: boolean): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const v = value.trim().toLowerCase();
        if (v === "1" || v === "true" || v === "yes") return true;
        if (v === "0" || v === "false" || v === "no") return false;
    }
    return defaultValue;
}

function normalizePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const out = Math.floor(n);
    return Math.min(max, Math.max(min, out));
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
    if (!(await assertToken(request))) {
        return json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    let payload: SyncPayload = {};
    try {
        payload = ((await request.json()) ?? {}) as SyncPayload;
    } catch {
        payload = {};
    }

    const includeStories = normalizeBool(payload.includeStories, true);
    const force = normalizeBool(payload.force, false);
    const maxFeedItems = normalizePositiveInt(payload.maxFeedItems, 72, 9, 120);
    const concurrency = normalizePositiveInt(payload.concurrency, 3, 1, 8);
    const maxHandleRetries = normalizePositiveInt(payload.maxHandleRetries, 2, 0, 4);
    const retryDelayMs = normalizePositiveInt(payload.retryDelayMs, 1200, 250, 10000);
    const source = typeof payload.source === "string" && payload.source.trim() ? payload.source.trim().slice(0, 80) : "api_instagram_sync";

    const requestedHandles = Array.isArray(payload.handles)
        ? payload.handles.map((h) => normalizeInstagramHandleInput(String(h ?? ""))).filter(Boolean)
        : [];

    const discoveredHandles = requestedHandles.length ? requestedHandles : await resolveDoctorInstagramHandles();
    const uniqueHandles = [...new Set(discoveredHandles)].sort();

    if (!uniqueHandles.length) {
        return json({
            ok: false,
            error: "no_handles_found",
        }, { status: 400 });
    }

    const targetHandles: string[] = [];
    if (force) {
        targetHandles.push(...uniqueHandles);
    } else {
        for (const handle of uniqueHandles) {
            const stale = await isInstagramProfileStale(handle, INSTAGRAM_SYNC_TTL_MS);
            if (stale) targetHandles.push(handle);
        }
    }

    if (!targetHandles.length) {
        return json({
            ok: true,
            message: "up_to_date",
            discoveredHandles: uniqueHandles.length,
            scheduledHandles: 0,
            staleTtlMs: INSTAGRAM_SYNC_TTL_MS,
            results: [],
        });
    }

    const startedAtMs = Date.now();
    const resultsByHandle = new Map<string, SyncHandleResult>();
    const attemptsByHandle = new Map<string, number>();
    const batchSummaries: Array<{
        attempt: number;
        handles: string[];
        successCount: number;
        failureCount: number;
    }> = [];

    let pendingHandles = [...targetHandles];
    for (let attempt = 1; attempt <= maxHandleRetries + 1; attempt++) {
        if (!pendingHandles.length) break;

        const batchResults = await syncInstagramHandlesBatch({
            handles: pendingHandles,
            includeStories,
            maxFeedItems,
            source: `${source}:attempt_${attempt}`,
            concurrency,
        });

        const failed: string[] = [];
        let successCount = 0;
        for (const result of batchResults) {
            attemptsByHandle.set(result.handle, (attemptsByHandle.get(result.handle) ?? 0) + 1);
            const previous = resultsByHandle.get(result.handle);
            if (!previous || result.ok || !previous.ok) {
                resultsByHandle.set(result.handle, result);
            }
            if (result.ok) successCount += 1;
            else failed.push(result.handle);
        }

        batchSummaries.push({
            attempt,
            handles: pendingHandles,
            successCount,
            failureCount: failed.length,
        });

        if (!failed.length) break;
        pendingHandles = [...new Set(failed)];
        if (attempt <= maxHandleRetries) {
            await sleep(retryDelayMs * attempt);
        }
    }

    const results: SyncHandleResultWithAttempts[] = targetHandles.map((handle) => {
        const result = resultsByHandle.get(handle) ?? {
            handle,
            ok: false,
            userId: null,
            fetchedItems: 0,
            fetchedStories: 0,
            upsertedItems: 0,
            error: "sync_not_executed",
        };
        return {
            ...result,
            attempts: attemptsByHandle.get(handle) ?? 0,
        };
    });

    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;

    return json({
        ok: true,
        startedAtMs,
        finishedAtMs: Date.now(),
        discoveredHandles: uniqueHandles.length,
        scheduledHandles: targetHandles.length,
        syncedHandles: results.length,
        successCount: okCount,
        failureCount: failCount,
        staleTtlMs: INSTAGRAM_SYNC_TTL_MS,
        options: {
            includeStories,
            force,
            maxFeedItems,
            concurrency,
            maxHandleRetries,
            retryDelayMs,
            source,
        },
        retrySummary: batchSummaries,
        results,
    });
}
