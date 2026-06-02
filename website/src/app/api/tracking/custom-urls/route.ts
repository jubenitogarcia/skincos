import { NextResponse } from "next/server";
import { getBookingDb } from "@/lib/bookingDb";
import { getRuntimeSecret } from "@/lib/runtimeSecrets";
import {
    normalizeSiteCustomUrlInput,
    serializeSiteCustomUrl,
    type SiteCustomUrlRow,
} from "@/lib/siteCustomUrls";

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

async function readCustomUrls(limit: number) {
    const db = await getBookingDb();
    const rows = (
        await db
            .prepare(
                `SELECT
                    u.id, u.site_host, u.name, u.slug_path, u.destination_url, u.destination_host, u.destination_path,
                    u.description, u.source, u.placement, u.unit_slug, u.service_id,
                    u.utm_source, u.utm_medium, u.utm_campaign, u.utm_content, u.utm_term,
                    u.active, u.created_at_ms, u.updated_at_ms,
                    COUNT(e.id) AS click_count,
                    MAX(e.created_at_ms) AS last_click_at_ms
                 FROM site_custom_urls u
                 LEFT JOIN site_behavior_events e
                    ON e.link_url = u.destination_url
                    OR e.link_path = u.destination_path
                    OR e.utm_campaign = u.utm_campaign
                 GROUP BY u.id
                 ORDER BY u.updated_at_ms DESC
                 LIMIT ?`,
            )
            .bind(limit)
            .all<SiteCustomUrlRow>()
    ).results ?? [];
    return rows.map(serializeSiteCustomUrl);
}

export async function GET(request: Request) {
    if (!(await isAuthorized(request))) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
    return json({ ok: true, customUrls: await readCustomUrls(limit) });
}

export async function POST(request: Request) {
    if (!(await isAuthorized(request))) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    let input;
    try {
        input = normalizeSiteCustomUrlInput(await request.json().catch(() => null));
    } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "invalid_payload" }, { status: 400 });
    }
    const now = Date.now();
    const id = crypto.randomUUID();
    const db = await getBookingDb();
    await db
        .prepare(
            `INSERT INTO site_custom_urls (
                id, site_host, name, slug_path, destination_url, destination_host, destination_path,
                description, source, placement, unit_slug, service_id,
                utm_source, utm_medium, utm_campaign, utm_content, utm_term,
                active, created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            id,
            input.siteHost,
            input.name,
            input.slugPath,
            input.destinationUrl,
            input.destinationHost,
            input.destinationPath,
            input.description,
            input.source,
            input.placement,
            input.unitSlug,
            input.serviceId,
            input.utmSource,
            input.utmMedium,
            input.utmCampaign,
            input.utmContent,
            input.utmTerm,
            input.active ? 1 : 0,
            now,
            now,
        )
        .run();
    return json({ ok: true, customUrl: (await readCustomUrls(200)).find((item) => item.id === id) ?? null }, { status: 201 });
}

export async function PATCH(request: Request) {
    if (!(await isAuthorized(request))) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    let input;
    try {
        input = normalizeSiteCustomUrlInput(await request.json().catch(() => null));
    } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "invalid_payload" }, { status: 400 });
    }
    if (!input.id) return json({ ok: false, error: "id_required" }, { status: 400 });
    const db = await getBookingDb();
    await db
        .prepare(
            `UPDATE site_custom_urls
             SET site_host = ?, name = ?, slug_path = ?, destination_url = ?, destination_host = ?, destination_path = ?,
                 description = ?, source = ?, placement = ?, unit_slug = ?, service_id = ?,
                 utm_source = ?, utm_medium = ?, utm_campaign = ?, utm_content = ?, utm_term = ?,
                 active = ?, updated_at_ms = ?
             WHERE id = ?`,
        )
        .bind(
            input.siteHost,
            input.name,
            input.slugPath,
            input.destinationUrl,
            input.destinationHost,
            input.destinationPath,
            input.description,
            input.source,
            input.placement,
            input.unitSlug,
            input.serviceId,
            input.utmSource,
            input.utmMedium,
            input.utmCampaign,
            input.utmContent,
            input.utmTerm,
            input.active ? 1 : 0,
            Date.now(),
            input.id,
        )
        .run();
    return json({ ok: true, customUrl: (await readCustomUrls(200)).find((item) => item.id === input.id) ?? null });
}
