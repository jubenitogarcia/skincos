import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type HealthStatus = {
    ok: boolean;
    at: string;
    checks: {
        hasOauthConfig: boolean;
        refreshExchangeOk: boolean;
        myBusinessApiOk: boolean;
        locationProbeOk: boolean;
    };
    details: {
        error?: string;
        myBusinessApiStatus?: number;
        myBusinessApiBody?: string | null;
        locationProbeStatus?: number;
        locationProbeBody?: string | null;
        resolvedLocation?: string;
    };
};

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

function parseLocationId(input: string): string | null {
    const raw = (input ?? "").trim();
    if (!raw) return null;
    if (raw.startsWith("accounts/")) return null;
    if (raw.startsWith("locations/")) {
        const id = raw.slice("locations/".length).trim();
        return id || null;
    }
    if (/^\d+$/.test(raw)) return raw;
    return null;
}

async function listAccountIds(accessToken: string): Promise<string[]> {
    const res = await fetch("https://mybusiness.googleapis.com/v4/accounts", {
        headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { accounts?: Array<{ name?: string }> };
    const ids = (json.accounts ?? [])
        .map((a) => (a?.name ?? "").trim())
        .filter((name) => name.startsWith("accounts/"))
        .map((name) => name.slice("accounts/".length))
        .map((id) => id.trim())
        .filter(Boolean);
    return Array.from(new Set(ids)).slice(0, 20);
}

async function discoverLocationResourceName(accessToken: string, locationId: string): Promise<string> {
    const accountIds = await listAccountIds(accessToken);
    for (const accountId of accountIds) {
        const candidate = `accounts/${accountId}/locations/${locationId}`;
        const probe = await fetch(`https://mybusiness.googleapis.com/v4/${candidate}`, {
            headers: { authorization: `Bearer ${accessToken}` },
        });
        if (probe.ok) return candidate;
    }
    throw new Error("location_not_found");
}

export async function GET(req: Request) {
    // Disable in production unless explicitly enabled via GBP_DIAGNOSTICS_TOKEN.
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

    const { searchParams } = new URL(req.url);
    const locationParam = (searchParams.get("location") ?? "").trim();
    const locationId = parseLocationId(locationParam);

    const status: HealthStatus = {
        ok: false,
        at: new Date().toISOString(),
        checks: {
            hasOauthConfig: Boolean(
                (process.env.GOOGLE_GBP_CLIENT_ID ?? "").trim() &&
                (process.env.GOOGLE_GBP_CLIENT_SECRET ?? "").trim() &&
                (process.env.GOOGLE_GBP_REFRESH_TOKEN ?? "").trim(),
            ),
            refreshExchangeOk: false,
            myBusinessApiOk: false,
            locationProbeOk: false,
        },
        details: {},
    };

    try {
        const accessToken = await getAccessToken();
        status.checks.refreshExchangeOk = true;

        const accountsRes = await fetch("https://mybusiness.googleapis.com/v4/accounts", {
            headers: { authorization: `Bearer ${accessToken}` },
        });

        if (accountsRes.ok) {
            status.checks.myBusinessApiOk = true;
        } else {
            status.details.myBusinessApiStatus = accountsRes.status;
            status.details.myBusinessApiBody = await accountsRes.text().catch(() => null);
        }

        if (locationId) {
            const resolved = await discoverLocationResourceName(accessToken, locationId);
            status.details.resolvedLocation = resolved;

            const probe = await fetch(`https://mybusiness.googleapis.com/v4/${resolved}/reviews?pageSize=1`, {
                headers: { authorization: `Bearer ${accessToken}` },
            });
            if (probe.ok) {
                status.checks.locationProbeOk = true;
            } else {
                status.details.locationProbeStatus = probe.status;
                status.details.locationProbeBody = await probe.text().catch(() => null);
            }
        }

        status.ok = status.checks.hasOauthConfig && status.checks.refreshExchangeOk && status.checks.myBusinessApiOk;
    } catch (e) {
        status.details.error = e instanceof Error ? e.message : "exception";
        status.ok = false;
    }

    return NextResponse.json(status, {
        status: status.ok ? 200 : 503,
        headers: { "cache-control": "no-store", "x-gbp": "health" },
    });
}
