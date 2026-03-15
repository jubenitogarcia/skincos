import { NextResponse } from "next/server";
import { getRuntimeSecret } from "@/lib/runtimeSecrets";
import {
    INSTAGRAM_SYNC_TTL_MS,
    isInstagramProfileStale,
    normalizeInstagramHandleInput,
    resolveDoctorInstagramHandles,
    syncInstagramHandlesBatch,
} from "@/lib/instagramSync";

export const dynamic = "force-dynamic";

type SyncPayload = {
    handles?: string[];
    includeStories?: boolean;
    force?: boolean;
    maxFeedItems?: number;
    concurrency?: number;
    source?: string;
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
    const results = await syncInstagramHandlesBatch({
        handles: targetHandles,
        includeStories,
        maxFeedItems,
        source,
        concurrency,
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
            source,
        },
        results,
    });
}
