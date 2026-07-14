import { NextResponse } from "next/server";
import { resolveFaleConoscoDestination } from "@/lib/faleconoscoRedirect";
import { mergeCampaignParamsIntoUrl } from "@/lib/mergeCampaignParams";

export async function GET(req: Request, { params }: { params: Promise<{ unit: string }> }) {
    const { unit } = await params;
    const dest = resolveFaleConoscoDestination(unit);
    if (!dest) return new Response("Not Found", { status: 404 });
    const redirectUrl = mergeCampaignParamsIntoUrl(dest, req.url);
    return NextResponse.redirect(redirectUrl, { status: 301 });
}
