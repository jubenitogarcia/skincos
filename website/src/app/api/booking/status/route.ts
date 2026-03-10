import { NextResponse } from "next/server";
import { getBookingDb, nowMs } from "@/lib/bookingDb";
import { getServiceById } from "@/data/services";

export const dynamic = "force-dynamic";

type BookingStatusRow = {
    id: string;
    unit_slug: string;
    doctor_slug: string;
    service_id: string;
    start_at_ms: number;
    end_at_ms: number;
    status: string;
    patient_name: string;
    whatsapp: string;
    notes: string | null;
    created_at_ms: number;
    confirm_by_ms: number;
    decided_at_ms: number | null;
    decided_by: string | null;
    decision_note: string | null;
    override_conflict: number | null;
};

function json(data: unknown, init?: ResponseInit) {
    return NextResponse.json(data, init);
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
    const url = new URL(req.url);
    const id = (url.searchParams.get("id") ?? "").trim();
    if (!id) return json({ ok: false, error: "missing_id" }, { status: 400 });

    const db = await getBookingDb();
    await expireIfNeeded(db, id);

    const row = await db
        .prepare(
            "SELECT id, unit_slug, doctor_slug, service_id, start_at_ms, end_at_ms, status, patient_name, whatsapp, notes, created_at_ms, confirm_by_ms, decided_at_ms, decided_by, decision_note, override_conflict FROM booking_requests WHERE id = ?",
        )
        .bind(id)
        .first<BookingStatusRow>();

    if (!row) return json({ ok: false, error: "not_found" }, { status: 404 });

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
    );
}
