import { NextResponse } from "next/server";
import { services } from "@/data/services";

export const dynamic = "force-dynamic";

export async function GET() {
    return NextResponse.json({ ok: true, services }, { status: 200 });
}
