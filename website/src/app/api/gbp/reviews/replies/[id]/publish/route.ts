import { NextResponse } from "next/server";
import { recordGbpReviewReplyPublishResult, reserveGbpReviewReplyDraftForPublish } from "@/lib/gbpReviewsDb";
import { publishGoogleGbpReviewReply } from "@/lib/googleGbp";
import { isAuthorizedGbpReplyRequest, unauthorizedGbpReplyResponse } from "@/lib/gbpReplySecurity";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    if (!isAuthorizedGbpReplyRequest(request)) return unauthorizedGbpReplyResponse();
    const { id } = await params;
    const nowMs = Date.now();
    try {
        const draft = await reserveGbpReviewReplyDraftForPublish(id.trim(), nowMs);
        try {
            const reply = await publishGoogleGbpReviewReply({
                locationResourceName: draft.locationResourceName,
                reviewId: draft.reviewId,
                comment: draft.comment,
            });
            const published = await recordGbpReviewReplyPublishResult({
                id: draft.id,
                publishedAtMs: Date.now(),
                googleReplyUpdateMs: reply.updateTimeMs,
            });
            return NextResponse.json({ draft: published, reply }, { headers: { "cache-control": "no-store" } });
        } catch (error) {
            const message = error instanceof Error ? error.message : "review_reply_publish_failed";
            const failed = await recordGbpReviewReplyPublishResult({ id: draft.id, publishedAtMs: Date.now(), googleReplyUpdateMs: null, error: message });
            return NextResponse.json({ draft: failed, error: message }, { status: 502, headers: { "cache-control": "no-store" } });
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "reply_draft_publish_failed";
        return NextResponse.json({ error: message }, { status: 400, headers: { "cache-control": "no-store" } });
    }
}
