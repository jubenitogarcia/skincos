import { NextResponse } from "next/server";
import {
    ingestInstagramHandleSnapshot,
    normalizeInstagramHandleInput,
    type InstagramExternalMediaInput,
    type InstagramExternalProfileInput,
} from "@/lib/instagramSync";
import { getRuntimeSecret } from "@/lib/runtimeSecrets";

export const dynamic = "force-dynamic";

type IngestPayload = {
    handle?: string;
    source?: string;
    profile?: InstagramExternalProfileInput;
    items?: InstagramExternalMediaInput[];
};

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

export async function POST(request: Request) {
    if (!(await assertToken(request))) {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    let payload: IngestPayload = {};
    try {
        payload = ((await request.json()) ?? {}) as IngestPayload;
    } catch {
        payload = {};
    }

    const handle = normalizeInstagramHandleInput(payload.handle ?? "");
    if (!handle) {
        return NextResponse.json({ ok: false, error: "invalid_handle" }, { status: 400 });
    }

    const result = await ingestInstagramHandleSnapshot(
        handle,
        {
            profile: payload.profile ?? {},
            items: Array.isArray(payload.items) ? payload.items : [],
        },
        {
            source: typeof payload.source === "string" && payload.source.trim()
                ? payload.source.trim().slice(0, 80)
                : "api_instagram_ingest",
        },
    );

    return NextResponse.json({
        ok: result.ok,
        result,
    });
}
