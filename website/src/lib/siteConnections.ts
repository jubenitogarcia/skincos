import { clampText, sanitizeOneLine } from "@/lib/bookingDb";

export const DEFAULT_SITE_HOST = "espacofacial.com";

export type SiteConnectionRow = {
    id: string;
    site_host: string;
    name: string;
    status_label: string | null;
    status_tone: string;
    source: string;
    active: number;
    created_at_ms: number;
    updated_at_ms: number;
    event_count?: number;
    last_event_at_ms?: number | null;
};

export type NormalizedSiteConnectionInput = {
    id?: string;
    siteHost: string;
    name: string;
    statusLabel: string | null;
    statusTone: "success" | "warning" | "danger" | "neutral";
    source: string;
    active: boolean;
};

function textOrNull(value: unknown, max = 160): string | null {
    if (typeof value !== "string") return null;
    const normalized = sanitizeOneLine(value);
    return normalized ? clampText(normalized, max) : null;
}

function normalizeRawHost(value: unknown): string | null {
    const raw = textOrNull(value, 253)?.toLowerCase();
    if (!raw) return null;
    const withoutProtocol = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const withoutWww = withoutProtocol.replace(/^www\./, "");
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(withoutWww)) {
        return null;
    }
    return withoutWww;
}

export function normalizeSiteHost(value: unknown): string {
    const host = normalizeRawHost(value);
    if (!host) throw new Error("invalid_site_host");
    return host;
}

export function normalizeOptionalSiteHost(value: unknown): string | null {
    if (value == null || value === "") return null;
    const host = normalizeRawHost(value);
    return host || null;
}

export function siteHostVariants(siteHost: string): string[] {
    const normalized = normalizeSiteHost(siteHost);
    return normalized.startsWith("www.") ? [normalized] : [normalized, `www.${normalized}`];
}

export function normalizeSiteConnectionInput(raw: unknown): NormalizedSiteConnectionInput {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_payload");
    const body = raw as Record<string, unknown>;
    const siteHost = normalizeSiteHost(body.siteHost ?? body.site_host);
    const statusTone = textOrNull(body.statusTone ?? body.status_tone, 40);
    const allowedTone = statusTone === "warning" || statusTone === "danger" || statusTone === "neutral" ? statusTone : "success";
    return {
        id: textOrNull(body.id, 100) ?? undefined,
        siteHost,
        name: textOrNull(body.name, 180) ?? siteHost,
        statusLabel: textOrNull(body.statusLabel ?? body.status_label, 120) ?? "Conexão ativa",
        statusTone: allowedTone,
        source: textOrNull(body.source, 80) ?? "crm",
        active: body.active !== false,
    };
}

export function defaultSiteConnection() {
    return {
        id: DEFAULT_SITE_HOST,
        siteHost: DEFAULT_SITE_HOST,
        name: DEFAULT_SITE_HOST,
        host: DEFAULT_SITE_HOST,
        statusLabel: "Domínio principal",
        statusTone: "success" as const,
        source: "system",
        active: true,
        createdAtMs: 0,
        updatedAtMs: 0,
        eventCount: 0,
        lastEventAtMs: null as number | null,
    };
}

export function serializeSiteConnection(row: SiteConnectionRow) {
    return {
        id: row.id,
        siteHost: row.site_host,
        name: row.name,
        host: row.site_host,
        statusLabel: row.status_label,
        statusTone: row.status_tone,
        source: row.source,
        active: row.active === 1,
        createdAtMs: row.created_at_ms,
        updatedAtMs: row.updated_at_ms,
        eventCount: Number(row.event_count ?? 0),
        lastEventAtMs: row.last_event_at_ms ?? null,
    };
}
