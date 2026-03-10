import { NextResponse } from "next/server";
import { getBookingDb, nowMs, clampText, sanitizeOneLine } from "@/lib/bookingDb";
import { constantTimeEqual } from "@/lib/bookingSecurity";

export const dynamic = "force-dynamic";

function json(data: unknown, init?: ResponseInit) {
    const headers = new Headers(init?.headers);
    if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
    return NextResponse.json(data, { ...init, headers });
}

type Payload = {
    secret?: string;
    id?: string;
    action?: "confirm" | "decline";
    overrideConflict?: boolean;
    decidedBy?: string;
    note?: string;
};

type BookingRow = {
    id: string;
    unit_slug: string;
    doctor_slug: string;
    start_at_ms: number;
    end_at_ms: number;
    status: string;
    confirm_by_ms: number;
};

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

function authorize(req: Request, body: Payload): string | null {
    const expected = (process.env.BOOKING_WEBHOOK_SECRET ?? "").trim();
    if (!expected) return "webhook_not_configured";

    const headerSecret = (req.headers.get("x-booking-webhook-secret") ?? "").trim();
    const bodySecret = (body.secret ?? "").trim();

    const provided = headerSecret || bodySecret;
    if (!provided || !constantTimeEqual(provided, expected)) return "unauthorized";

    return null;
}

export async function POST(req: Request) {
    let body: Payload;
    try {
        body = (await req.json()) as Payload;
    } catch {
        return json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    const authError = authorize(req, body);
    if (authError) {
        const status = authError === "unauthorized" ? 401 : 501;
        return json({ ok: false, error: authError }, { status });
    }

    const id = (body.id ?? "").trim();
    const action = body.action === "confirm" ? "confirm" : body.action === "decline" ? "decline" : null;
    const overrideConflict = !!body.overrideConflict;

    if (!id || !action) {
        return json({ ok: false, error: "missing_fields" }, { status: 400 });
    }

    const db = await getBookingDb();
    await expireIfNeeded(db, id);

    const row = await db
        .prepare(
            "SELECT id, unit_slug, doctor_slug, start_at_ms, end_at_ms, status, confirm_by_ms FROM booking_requests WHERE id = ?",
        )
        .bind(id)
        .first<BookingRow>();

    if (!row) return json({ ok: false, error: "not_found" }, { status: 404 });

    const currentStatus = (row.status ?? "").toString();
    if (currentStatus === "confirmed" || currentStatus === "declined" || currentStatus === "expired") {
        return json({ ok: false, error: "already_decided", status: currentStatus }, { status: 409 });
    }

    const now = nowMs();
    if (now > Number(row.confirm_by_ms ?? 0)) {
        return json({ ok: false, error: "expired" }, { status: 409 });
    }

    const decidedBy = clampText(sanitizeOneLine(body.decidedBy ?? ""), 60) || "webhook";
    const note = clampText(sanitizeOneLine(body.note ?? ""), 300) || null;

    if (action === "confirm") {
        const conflicts = await db
            .prepare(
                "SELECT id FROM booking_requests WHERE id != ? AND unit_slug = ? AND doctor_slug = ? AND status = 'confirmed' AND start_at_ms < ? AND end_at_ms > ? LIMIT 1",
            )
            .bind(id, row.unit_slug, row.doctor_slug, row.end_at_ms, row.start_at_ms)
            .first<{ id: string }>();

        if (conflicts && !overrideConflict) {
            await db
                .prepare("UPDATE booking_requests SET status = 'needs_approval' WHERE id = ? AND status = 'pending'")
                .bind(id)
                .run();
            return json({ ok: false, error: "conflict_requires_override" }, { status: 409 });
        }

        await db
            .prepare(
                "UPDATE booking_requests SET status = 'confirmed', decided_at_ms = ?, decided_by = ?, decision_note = ?, override_conflict = ? WHERE id = ?",
            )
            .bind(now, decidedBy, note, overrideConflict ? 1 : 0, id)
            .run();

        return json({ ok: true, id, status: "confirmed" }, { status: 200 });
    }

    await db
        .prepare(
            "UPDATE booking_requests SET status = 'declined', decided_at_ms = ?, decided_by = ?, decision_note = ? WHERE id = ?",
        )
        .bind(now, decidedBy, note, id)
        .run();

    return json({ ok: true, id, status: "declined" }, { status: 200 });
}
