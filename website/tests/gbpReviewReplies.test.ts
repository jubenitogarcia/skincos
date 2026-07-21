import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGbpApprovalActor, normalizeGbpReviewId, normalizeGbpReviewReplyComment } from "../src/lib/gbpReviewReplies";

test("normalizes a reply without changing its content", () => {
    assert.equal(normalizeGbpReviewReplyComment("  Obrigada pela sua avaliação!  "), "Obrigada pela sua avaliação!");
});

test("rejects empty, oversized, and non-string replies", () => {
    assert.throws(() => normalizeGbpReviewReplyComment("  "), /empty_reply_comment/);
    assert.throws(() => normalizeGbpReviewReplyComment("a".repeat(4097)), /reply_comment_too_long/);
    assert.throws(() => normalizeGbpReviewReplyComment(null), /invalid_reply_comment/);
});

test("rejects review ids that can alter the Google API path", () => {
    assert.equal(normalizeGbpReviewId("review_123"), "review_123");
    assert.throws(() => normalizeGbpReviewId("review/123"), /invalid_review_id/);
    assert.throws(() => normalizeGbpReviewId("review\nother"), /invalid_review_id/);
});

test("requires a named approver", () => {
    assert.equal(normalizeGbpApprovalActor("Gerência NH"), "Gerência NH");
    assert.throws(() => normalizeGbpApprovalActor(""), /invalid_approved_by/);
});
