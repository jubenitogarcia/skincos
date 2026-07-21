import { NextResponse } from "next/server";
import { createGoogleGbpOAuthAuthorization } from "@/lib/gbpOAuthAuthorization";
import { createGoogleGbpAuthorizationUrl } from "@/lib/googleGbp";
import { isAuthorizedGbpReplyRequest, unauthorizedGbpReplyResponse } from "@/lib/gbpReplySecurity";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    if (!isAuthorizedGbpReplyRequest(request)) return unauthorizedGbpReplyResponse();
    try {
        const authorization = await createGoogleGbpOAuthAuthorization();
        const redirectUri = new URL("/api/gbp/oauth/callback", request.url).toString();
        const authorizeUrl = createGoogleGbpAuthorizationUrl({ state: authorization.state, redirectUri });
        return NextResponse.json(
            { authorizationId: authorization.id, authorizeUrl, expiresInSeconds: 600 },
            { status: 201, headers: { "cache-control": "no-store" } },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "gbp_oauth_authorization_create_failed";
        return NextResponse.json({ error: message }, { status: 400, headers: { "cache-control": "no-store" } });
    }
}
