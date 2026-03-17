import { NextResponse } from "next/server";
import { getBookingDb, nowMs } from "@/lib/bookingDb";
import { getServiceById } from "@/data/services";
import { verifyBookingStatusToken } from "@/lib/bookingSecurity";
import { readBookingStatusAuth } from "./auth";

export const dynamic = "force-dynamic";

type BookingStatusRow = {
    id: string;
    unit_slug: string;
    doctor_slug: string;
    service_id: string;
    start_at_ms: number;
    end_at_ms: number;
    status: string;
    confirm_by_ms: number;
};

function json(data: unknown, init?: ResponseInit, noStore = false) {
    const response = NextResponse.json(data, init);
    if (noStore) {
        response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
        response.headers.set("Pragma", "no-cache");
        response.headers.set("Expires", "0");
    }
    return response;
}

async function expireIfNeeded(db: Awaited<ReturnType<typeof getBookingDb>>, id: string) {
    const row = await db
        .prepare("SELECT id, status, confirm_by_ms FROM booking_requests WHERE id = ?")
        .bind(id)
        .first<{ id: string; status: string; confirm_by_ms: number }>();

    if (!row) return;

    const status = (row.status ?? "").toString();
    if (status !== "pending" && status !== "needs_approval") return;

    const now = nowMs();
    if (now <= Number(row.confirm_by_ms)) return;

    await db
        .prepare(
            "UPDATE booking_requests SET status = 'expired', decided_at_ms = ?, decision_note = COALESCE(decision_note, 'auto_expired') WHERE id = ? AND (status = 'pending' OR status = 'needs_approval')",
        )
        .bind(now, id)
        .run();
}

export async function GET(req: Request) {
    const auth = readBookingStatusAuth(req);
    if (!auth.ok) return json({ ok: false, error: auth.error }, { status: auth.status });

    const secret = (process.env.BOOKING_STATUS_SECRET ?? process.env.BOOKING_DECISION_SECRET ?? "").trim();
    if (!secret) {
        return json({ ok: false, error: "status_unavailable" }, { status: 503 }, true);
    }

    const verification = await verifyBookingStatusToken({
        secret,
        id: auth.id,
        token: auth.token,
        nowMs: nowMs(),
    });
    if (!verification.ok) {
        return json({ ok: false, error: verification.error }, { status: 403 }, true);
    }

    const db = await getBookingDb();
    await expireIfNeeded(db, auth.id);

    const row = await db
        .prepare(
            "SELECT id, unit_slug, doctor_slug, service_id, start_at_ms, end_at_ms, status, confirm_by_ms FROM booking_requests WHERE id = ?",
        )
        .bind(auth.id)
        .first<BookingStatusRow>();

    if (!row) return json({ ok: false, error: "not_found" }, { status: 404 }, true);

    const service = getServiceById((row.service_id ?? "").toString());
    const durationMinutes = Math.max(0, Math.round((Number(row.end_at_ms) - Number(row.start_at_ms)) / 60_000));

    return json(
        {
            ok: true,
            booking: {
                ...row,
                durationMinutes,
                service: service ? { id: service.id, name: service.name } : null,
            },
        },
        { status: 200 },
        true,
    );
}
