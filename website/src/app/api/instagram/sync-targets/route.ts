import { NextResponse } from "next/server";
import { getRuntimeSecret } from "@/lib/runtimeSecrets";
import { resolveInstagramSyncTargets } from "@/lib/instagramSync";

export const dynamic = "force-dynamic";

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

export async function GET(request: Request) {
    if (!(await assertToken(request))) {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const targets = await resolveInstagramSyncTargets();
    return NextResponse.json({
        ok: true,
        count: targets.length,
        targets,
    });
}
