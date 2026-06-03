import { clampText, sanitizeOneLine, slugify } from "@/lib/bookingDb";
import { DEFAULT_SITE_HOST, normalizeOptionalSiteHost } from "@/lib/siteConnections";

export type SiteCustomUrlRow = {
    id: string;
    site_host: string;
    name: string;
    slug_path: string;
    destination_url: string;
    destination_host: string | null;
    destination_path: string | null;
    description: string | null;
    source: string;
    placement: string | null;
    unit_slug: string | null;
    service_id: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    active: number;
    created_at_ms: number;
    updated_at_ms: number;
    click_count?: number;
    last_click_at_ms?: number | null;
};

export type NormalizedSiteCustomUrlInput = {
    id?: string;
    siteHost: string;
    name: string;
    slugPath: string;
    destinationUrl: string;
    destinationHost: string | null;
    destinationPath: string | null;
    description: string | null;
    source: string;
    placement: string | null;
    unitSlug: string | null;
    serviceId: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
    active: boolean;
};

const ALLOWED_DESTINATION_HOSTS = new Set([
    "espacofacial.com",
    "www.espacofacial.com",
    "app.espacofacial.com.br",
    "espacofacial.com.br",
    "www.espacofacial.com.br",
    "api.whatsapp.com",
    "wa.me",
    "wa.skincos.com.br",
]);

function textOrNull(value: unknown, max = 160): string | null {
    if (typeof value !== "string") return null;
    const normalized = sanitizeOneLine(value);
    return normalized ? clampText(normalized, max) : null;
}

function canonicalHost(value: unknown): string {
    return normalizeOptionalSiteHost(value) ?? DEFAULT_SITE_HOST;
}

function normalizeSlugPath(value: unknown, fallbackName: string): string {
    const raw = textOrNull(value, 180);
    if (raw) {
        const path = raw.startsWith("/") ? raw : `/${raw}`;
        const clean = path
            .replace(/\/{2,}/g, "/")
            .replace(/\s+/g, "-")
            .replace(/[?#].*$/, "")
            .toLowerCase();
        if (/^\/[a-z0-9][a-z0-9._/-]{1,178}$/.test(clean) && !clean.startsWith("/api/")) return clean;
    }
    const fallback = slugify(fallbackName || "campanha");
    return `/campanhas/${fallback || "link"}`;
}

function normalizeDestinationUrl(value: unknown): { url: string; host: string | null; path: string | null } {
    const raw = textOrNull(value, 1200);
    if (!raw) throw new Error("destination_url_required");
    let parsed: URL;
    try {
        parsed = new URL(raw, "https://espacofacial.com");
    } catch {
        throw new Error("invalid_destination_url");
    }
    if (parsed.protocol !== "https:") throw new Error("destination_url_must_be_https");
    const host = parsed.hostname.toLowerCase();
    if (!ALLOWED_DESTINATION_HOSTS.has(host)) throw new Error("destination_host_not_allowed");
    return {
        url: parsed.toString(),
        host,
        path: `${parsed.pathname}${parsed.search}${parsed.hash}`,
    };
}

function readUtm(body: Record<string, unknown>, camelKey: string, snakeKey: string): string | null {
    return textOrNull(body[camelKey] ?? body[snakeKey], 160);
}

function mergeUtmIntoDestination(destinationUrl: string, input: NormalizedSiteCustomUrlInput): string {
    const url = new URL(destinationUrl);
    const params: Array<[string, string | null]> = [
        ["utm_source", input.utmSource],
        ["utm_medium", input.utmMedium],
        ["utm_campaign", input.utmCampaign],
        ["utm_content", input.utmContent],
        ["utm_term", input.utmTerm],
    ];
    for (const [key, value] of params) {
        if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
    }
    return url.toString();
}

export function normalizeSiteCustomUrlInput(raw: unknown): NormalizedSiteCustomUrlInput {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_payload");
    const body = raw as Record<string, unknown>;
    const name = textOrNull(body.name, 180);
    if (!name) throw new Error("name_required");
    const destination = normalizeDestinationUrl(body.destinationUrl ?? body.destination_url);
    const input: NormalizedSiteCustomUrlInput = {
        id: textOrNull(body.id, 100) ?? undefined,
        siteHost: canonicalHost(body.siteHost ?? body.site_host),
        name,
        slugPath: normalizeSlugPath(body.slugPath ?? body.slug_path, name),
        destinationUrl: destination.url,
        destinationHost: destination.host,
        destinationPath: destination.path,
        description: textOrNull(body.description, 500),
        source: textOrNull(body.source, 80) ?? "manual",
        placement: textOrNull(body.placement, 120),
        unitSlug: textOrNull(body.unitSlug ?? body.unit_slug, 120),
        serviceId: textOrNull(body.serviceId ?? body.service_id, 120),
        utmSource: readUtm(body, "utmSource", "utm_source"),
        utmMedium: readUtm(body, "utmMedium", "utm_medium"),
        utmCampaign: readUtm(body, "utmCampaign", "utm_campaign"),
        utmContent: readUtm(body, "utmContent", "utm_content"),
        utmTerm: readUtm(body, "utmTerm", "utm_term"),
        active: body.active !== false,
    };
    input.destinationUrl = mergeUtmIntoDestination(input.destinationUrl, input);
    const merged = normalizeDestinationUrl(input.destinationUrl);
    input.destinationHost = merged.host;
    input.destinationPath = merged.path;
    return input;
}

export function serializeSiteCustomUrl(row: SiteCustomUrlRow) {
    return {
        id: row.id,
        siteHost: row.site_host,
        name: row.name,
        slugPath: row.slug_path,
        publicUrl: `https://${row.site_host}${row.slug_path}`,
        destinationUrl: row.destination_url,
        destinationHost: row.destination_host,
        destinationPath: row.destination_path,
        description: row.description,
        source: row.source,
        placement: row.placement,
        unitSlug: row.unit_slug,
        serviceId: row.service_id,
        utmSource: row.utm_source,
        utmMedium: row.utm_medium,
        utmCampaign: row.utm_campaign,
        utmContent: row.utm_content,
        utmTerm: row.utm_term,
        active: row.active === 1,
        createdAtMs: row.created_at_ms,
        updatedAtMs: row.updated_at_ms,
        clickCount: Number(row.click_count ?? 0),
        lastClickAtMs: row.last_click_at_ms ?? null,
    };
}
