import { NextResponse } from "next/server";
import { fetchActiveInjectorsResult } from "@/lib/injectorsDirectory";

export async function GET() {
    try {
        const result = await fetchActiveInjectorsResult();
        return NextResponse.json(result, { status: 200 });
    } catch {
        return NextResponse.json({ ok: false, members: [], error: { code: "exception" } }, { status: 200 });
    }
}
