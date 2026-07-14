import { NextResponse } from "next/server";
import { getBookingDb } from "@/lib/bookingDb";
import { getRuntimeSecret } from "@/lib/runtimeSecrets";
import {
    DEFAULT_SITE_HOST,
    defaultSiteConnection,
    normalizeSiteConnectionInput,
    serializeSiteConnection,
    type SiteConnectionRow,
} from "@/lib/siteConnections";

export const dynamic = "force-dynamic";

function json(data: unknown, init?: ResponseInit) {
    return NextResponse.json(data, {
        headers: { "cache-control": "no-store" },
        ...init,
    });
}

function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function readToken(request: Request): string {
    const auth = (request.headers.get("authorization") ?? "").trim();
    if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
    return (request.headers.get("x-tracking-dashboard-token") ?? "").trim();
}

async function isAuthorized(request: Request): Promise<boolean> {
    const expected = await getRuntimeSecret("TRACKING_DASHBOARD_TOKEN");
    if (process.env.NODE_ENV === "production" && !expected) return false;
    if (!expected) return true;
    return constantTimeEqual(readToken(request), expected);
}

async function readConnections(limit: number) {
    const db = await getBookingDb();
    const rows = (
        await db
            .prepare(
                `SELECT
                    c.id, c.site_host, c.name, c.status_label, c.status_tone, c.source,
                    c.active, c.created_at_ms, c.updated_at_ms,
                    COUNT(e.id) AS event_count,
                    MAX(e.created_at_ms) AS last_event_at_ms
                 FROM site_connections c
                 LEFT JOIN site_behavior_events e
                    ON lower(e.page_host) = c.site_host
                    OR lower(e.page_host) = ('www.' || c.site_host)
                 GROUP BY c.id
                 ORDER BY c.updated_at_ms DESC
                 LIMIT ?`,
            )
            .bind(limit)
            .all<SiteConnectionRow>()
    ).results ?? [];

    const serialized = rows.map(serializeSiteConnection);
    if (!serialized.some((site) => site.siteHost === DEFAULT_SITE_HOST)) {
        serialized.unshift(defaultSiteConnection());
    }
    return serialized;
}

export async function GET(request: Request) {
    if (!(await isAuthorized(request))) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
    return json({ ok: true, siteConnections: await readConnections(limit) });
}

export async function POST(request: Request) {
    if (!(await isAuthorized(request))) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    let input;
    try {
        input = normalizeSiteConnectionInput(await request.json().catch(() => null));
    } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "invalid_payload" }, { status: 400 });
    }

    const now = Date.now();
    const id = crypto.randomUUID();
    const db = await getBookingDb();
    await db
        .prepare(
            `INSERT INTO site_connections (
                id, site_host, name, status_label, status_tone, source, active, created_at_ms, updated_at_ms
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(site_host) DO UPDATE SET
                name = excluded.name,
                status_label = excluded.status_label,
                status_tone = excluded.status_tone,
                source = excluded.source,
                active = excluded.active,
                updated_at_ms = excluded.updated_at_ms`,
        )
        .bind(
            id,
            input.siteHost,
            input.name,
            input.statusLabel,
            input.statusTone,
            input.source,
            input.active ? 1 : 0,
            now,
            now,
        )
        .run();

    return json({
        ok: true,
        siteConnection: (await readConnections(200)).find((item) => item.siteHost === input.siteHost) ?? null,
    }, { status: 201 });
}

export async function PATCH(request: Request) {
    if (!(await isAuthorized(request))) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    let input;
    try {
        input = normalizeSiteConnectionInput(await request.json().catch(() => null));
    } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "invalid_payload" }, { status: 400 });
    }
    if (!input.id) return json({ ok: false, error: "id_required" }, { status: 400 });

    const db = await getBookingDb();
    await db
        .prepare(
            `UPDATE site_connections
             SET site_host = ?, name = ?, status_label = ?, status_tone = ?, source = ?, active = ?, updated_at_ms = ?
             WHERE id = ?`,
        )
        .bind(
            input.siteHost,
            input.name,
            input.statusLabel,
            input.statusTone,
            input.source,
            input.active ? 1 : 0,
            Date.now(),
            input.id,
        )
        .run();

    return json({
        ok: true,
        siteConnection: (await readConnections(200)).find((item) => item.id === input.id) ?? null,
    });
}
