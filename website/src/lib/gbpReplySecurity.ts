import { constantTimeEqual } from "@/lib/bookingSecurity";

function getReplyToken(): string {
    return (process.env.GBP_REPLIES_TOKEN ?? process.env.GBP_DIAGNOSTICS_TOKEN ?? "").trim();
}

export function isAuthorizedGbpReplyRequest(request: Request): boolean {
    const expected = getReplyToken();
    if (!expected) return false;

    const authorization = (request.headers.get("authorization") ?? "").trim();
    if (!authorization.toLowerCase().startsWith("bearer ")) return false;
    const received = authorization.slice("bearer ".length).trim();
    return Boolean(received) && constantTimeEqual(received, expected);
}

export function unauthorizedGbpReplyResponse(): Response {
    return new Response("Unauthorized", {
        status: 401,
        headers: { "www-authenticate": "Bearer", "cache-control": "no-store" },
    });
}
