import { NextResponse } from "next/server";
import { resolveFaleConoscoDestination } from "@/lib/faleconoscoRedirect";
import { mergeCampaignParamsIntoUrl } from "@/lib/mergeCampaignParams";
import { buildWhatsappRedirectHref } from "@/lib/whatsappTracking";

export async function GET(req: Request, { params }: { params: Promise<{ unit: string }> }) {
    const { unit } = await params;
    const dest = resolveFaleConoscoDestination(unit);
    if (!dest) return new Response("Not Found", { status: 404 });
    const mergedDestination = mergeCampaignParamsIntoUrl(dest, req.url);
    const redirectUrl = buildWhatsappRedirectHref({
        rawUrl: mergedDestination,
        tracking: {
            placement: "faleconosco_route",
            unitSlug: unit,
            source: "faleconosco_route",
            pageUrl: req.url,
        },
    });
    if (!redirectUrl) return NextResponse.redirect(mergedDestination, { status: 301 });
    return NextResponse.redirect(redirectUrl, { status: 301 });
}
