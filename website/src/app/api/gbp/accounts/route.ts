import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type TokenCache = {
    accessToken: string;
    expiresAtMs: number;
};

let tokenCache: TokenCache | null = null;

function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let ok = 0;
    for (let i = 0; i < a.length; i++) ok |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return ok === 0;
}

function getDiagnosticsToken(): string {
    return (process.env.GBP_DIAGNOSTICS_TOKEN ?? "").trim();
}

function requireDiagnosticsAuth(req: Request): boolean {
    const expected = getDiagnosticsToken();
    if (!expected) return false;

    const auth = (req.headers.get("authorization") ?? "").trim();
    if (!auth.toLowerCase().startsWith("bearer ")) return false;
    const received = auth.slice("bearer ".length).trim();
    return constantTimeEqual(received, expected);
}

async function getAccessToken(): Promise<string> {
    const clientId = (process.env.GOOGLE_GBP_CLIENT_ID ?? "").trim();
    const clientSecret = (process.env.GOOGLE_GBP_CLIENT_SECRET ?? "").trim();
    const refreshToken = (process.env.GOOGLE_GBP_REFRESH_TOKEN ?? "").trim();

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error("missing_gbp_oauth_config");
    }

    const now = Date.now();
    if (tokenCache && tokenCache.expiresAtMs - 30_000 > now) {
        return tokenCache.accessToken;
    }

    const body = new URLSearchParams();
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
    body.set("refresh_token", refreshToken);
    body.set("grant_type", "refresh_token");

    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`oauth_refresh_failed:${res.status}:${txt.slice(0, 600)}`);
    }

    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    const accessToken = (json.access_token ?? "").trim();
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 300;

    if (!accessToken) {
        throw new Error("missing_access_token");
    }

    tokenCache = {
        accessToken,
        expiresAtMs: now + expiresIn * 1000,
    };

    return accessToken;
}

export async function GET(req: Request) {
    const token = getDiagnosticsToken();
    if (!token) {
        return new NextResponse("Not Found", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
    }

    if (!requireDiagnosticsAuth(req)) {
        return new NextResponse("Unauthorized", {
            status: 401,
            headers: { "www-authenticate": "Bearer", "cache-control": "no-store" },
        });
    }

    try {
        const accessToken = await getAccessToken();
        const res = await fetch("https://mybusiness.googleapis.com/v4/accounts", {
            headers: { authorization: `Bearer ${accessToken}` },
        });

        const body = await res.text().catch(() => "");
        if (!res.ok) {
            return NextResponse.json(
                {
                    ok: false,
                    status: res.status,
                    body: body.slice(0, 2000),
                },
                { status: 502, headers: { "cache-control": "no-store" } },
            );
        }

        const json = JSON.parse(body) as { accounts?: Array<{ name?: string; accountName?: string; type?: string }> };
        const accounts = (json.accounts ?? []).map((a) => ({
            name: (a.name ?? "").trim(),
            accountName: (a.accountName ?? "").trim(),
            type: (a.type ?? "").trim(),
        }));

        return NextResponse.json(
            {
                ok: true,
                count: accounts.length,
                accounts,
            },
            { headers: { "cache-control": "no-store" } },
        );
    } catch (e) {
        return NextResponse.json(
            {
                ok: false,
                error: e instanceof Error ? e.message : "exception",
            },
            { status: 500, headers: { "cache-control": "no-store" } },
        );
    }
}
