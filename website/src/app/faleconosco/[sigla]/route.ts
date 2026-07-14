import { NextResponse } from "next/server";
import { resolveFaleConoscoDestination } from "@/lib/faleconoscoRedirect";
import { mergeCampaignParamsIntoUrl } from "@/lib/mergeCampaignParams";
import { buildWhatsappRedirectHref } from "@/lib/whatsappTracking";

export async function GET(req: Request, { params }: { params: Promise<{ sigla: string }> }) {
    const { sigla } = await params;
    const dest = resolveFaleConoscoDestination(sigla);
    if (!dest) return new Response("Not Found", { status: 404 });
    const mergedDestination = mergeCampaignParamsIntoUrl(dest, req.url);
    const redirectUrl = buildWhatsappRedirectHref({
        rawUrl: mergedDestination,
        tracking: {
            placement: "faleconosco_route",
            unitSlug: sigla,
            source: "faleconosco_route",
            pageUrl: req.url,
        },
    });
    if (!redirectUrl) return NextResponse.redirect(mergedDestination, { status: 301 });
    return NextResponse.redirect(new URL(redirectUrl, req.url), { status: 301 });
}
