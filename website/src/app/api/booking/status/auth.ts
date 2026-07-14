type BookingStatusAuth =
    | { ok: true; id: string; token: string }
    | { ok: false; status: number; error: string };

function readAuthorizationToken(req: Request) {
    const direct = (req.headers.get("x-booking-status-token") ?? "").trim();
    if (direct) return direct;

    const authorization = (req.headers.get("authorization") ?? "").trim();
    const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
    return bearerMatch?.[1]?.trim() ?? "";
}

export function readBookingStatusAuth(req: Request): BookingStatusAuth {
    const url = new URL(req.url);
    const id = (url.searchParams.get("id") ?? "").trim();
    if (!id) return { ok: false, status: 400, error: "missing_id" };

    if (url.searchParams.has("token")) {
        return { ok: false, status: 400, error: "token_in_query_forbidden" };
    }

    const token = readAuthorizationToken(req);
    if (!token) return { ok: false, status: 400, error: "missing_token" };

    return { ok: true, id, token };
}
