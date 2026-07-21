const MAX_GBP_REPLY_BYTES = 4096;

export function normalizeGbpReviewReplyComment(value: unknown): string {
    if (typeof value !== "string") throw new Error("invalid_reply_comment");
    const comment = value.trim();
    if (!comment) throw new Error("empty_reply_comment");
    if (new TextEncoder().encode(comment).byteLength > MAX_GBP_REPLY_BYTES) {
        throw new Error("reply_comment_too_long");
    }
    return comment;
}

export function normalizeGbpReviewId(value: unknown): string {
    if (typeof value !== "string") throw new Error("invalid_review_id");
    const reviewId = value.trim();
    if (!reviewId || reviewId.length > 512 || /[\u0000-\u001F\u007F]/.test(reviewId) || reviewId.includes("/")) {
        throw new Error("invalid_review_id");
    }
    return reviewId;
}

export function normalizeGbpApprovalActor(value: unknown): string {
    if (typeof value !== "string") throw new Error("invalid_approved_by");
    const approvedBy = value.trim();
    if (!approvedBy || approvedBy.length > 160 || /[\u0000-\u001F\u007F]/.test(approvedBy)) {
        throw new Error("invalid_approved_by");
    }
    return approvedBy;
}

export function makeGbpReplyDraftId(nowMs = Date.now()): string {
    return `gbp_reply_${nowMs}_${crypto.randomUUID()}`;
}
