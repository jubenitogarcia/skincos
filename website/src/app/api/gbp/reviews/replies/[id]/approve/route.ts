import { NextResponse } from "next/server";
import { approveGbpReviewReplyDraft } from "@/lib/gbpReviewsDb";
import { normalizeGbpApprovalActor } from "@/lib/gbpReviewReplies";
import { isAuthorizedGbpReplyRequest, unauthorizedGbpReplyResponse } from "@/lib/gbpReplySecurity";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    if (!isAuthorizedGbpReplyRequest(request)) return unauthorizedGbpReplyResponse();
    try {
        const { id } = await params;
        const body = (await request.json()) as { approvedBy?: unknown };
        const draft = await approveGbpReviewReplyDraft({
            id: id.trim(),
            approvedBy: normalizeGbpApprovalActor(body.approvedBy),
            approvedAtMs: Date.now(),
        });
        return NextResponse.json({ draft }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
        const message = error instanceof Error ? error.message : "reply_draft_approve_failed";
        return NextResponse.json({ error: message }, { status: 400, headers: { "cache-control": "no-store" } });
    }
}
