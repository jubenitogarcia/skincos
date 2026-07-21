import { NextResponse } from "next/server";
import { createGbpReviewReplyDraft } from "@/lib/gbpReviewsDb";
import { makeGbpReplyDraftId, normalizeGbpReviewId, normalizeGbpReviewReplyComment } from "@/lib/gbpReviewReplies";
import { isAuthorizedGbpReplyRequest, unauthorizedGbpReplyResponse } from "@/lib/gbpReplySecurity";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    if (!isAuthorizedGbpReplyRequest(request)) return unauthorizedGbpReplyResponse();
    try {
        const body = (await request.json()) as { reviewId?: unknown; comment?: unknown };
        const draft = await createGbpReviewReplyDraft({
            id: makeGbpReplyDraftId(),
            reviewId: normalizeGbpReviewId(body.reviewId),
            comment: normalizeGbpReviewReplyComment(body.comment),
            createdAtMs: Date.now(),
        });
        return NextResponse.json({ draft }, { status: 201, headers: { "cache-control": "no-store" } });
    } catch (error) {
        const message = error instanceof Error ? error.message : "reply_draft_create_failed";
        return NextResponse.json({ error: message }, { status: 400, headers: { "cache-control": "no-store" } });
    }
}
