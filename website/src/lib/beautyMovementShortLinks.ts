import { createHash } from "node:crypto";

import type { BeautyMovementDeliveryRow } from "./beautyMovementImport";

export const BEAUTY_MOVEMENT_SHORT_LINK_SOURCE = "beauty_movement_short_links_v1" as const;
export const BEAUTY_MOVEMENT_CANONICAL_PATH = "/BelezaEmMovimento" as const;
export const BEAUTY_MOVEMENT_SHORT_LINK_HOST = "esfa.co" as const;

export type BeautyMovementShortLink = {
    id: string;
    name: string;
    inviteRef: string;
    whatsapp: string;
    token: string;
    shortUrl: string;
    slugPath: string;
    normalizedSlugPath: string;
    destinationUrl: string;
    destinationHost: string;
    destinationPath: string;
    description: string;
    source: typeof BEAUTY_MOVEMENT_SHORT_LINK_SOURCE;
    placement: string;
    active: true;
};

export type BeautyMovementShortLinkPlan = {
    campaignId: string;
    createdAtMs: number;
    links: BeautyMovementShortLink[];
    mappingHash: string;
    mappingHashes: Record<string, string>;
};

function sqlString(value: string | null): string {
    return value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`;
}

function csvCell(value: string): string {
    const formulaSafe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${formulaSafe.replace(/"/g, '""')}"`;
}

function assertCampaignId(value: string): string {
    const campaignId = value.trim();
    if (!/^[a-z0-9][a-z0-9_-]{2,79}$/i.test(campaignId)) throw new Error("beauty_movement_short_links_invalid_campaign_id");
    return campaignId;
}

function readInviteToken(inviteUrl: string): string {
    let parsed: URL;
    try {
        parsed = new URL(inviteUrl);
    } catch {
        throw new Error("beauty_movement_short_links_invalid_invite_url");
    }
    const pathname = parsed.pathname.toLowerCase();
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "espacofacial.com" || (pathname !== BEAUTY_MOVEMENT_CANONICAL_PATH.toLowerCase() && pathname !== "/beleza-em-movimento") || parsed.search) {
        throw new Error("beauty_movement_short_links_noncanonical_invite_url");
    }
    const token = parsed.hash.startsWith("#c=") ? parsed.hash.slice(3) : "";
    if (!/^[A-Za-z0-9_-]{40,180}$/.test(token)) throw new Error("beauty_movement_short_links_invalid_token");
    return token;
}

function mappingDigest(entries: readonly BeautyMovementShortLink[]): string {
    const material = entries
        .map((entry) => `${entry.normalizedSlugPath}\t${entry.destinationUrl}`)
        .sort()
        .join("\n");
    return createHash("sha256").update(material, "utf8").digest("hex");
}

function destinationHash(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

export function prepareBeautyMovementShortLinks(params: {
    rows: readonly BeautyMovementDeliveryRow[];
    campaignId: string;
    createdAtMs?: number;
}): BeautyMovementShortLinkPlan {
    const campaignId = assertCampaignId(params.campaignId);
    const createdAtMs = params.createdAtMs ?? Date.now();
    if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) throw new Error("beauty_movement_short_links_invalid_timestamp");
    if (params.rows.length < 1) throw new Error("beauty_movement_short_links_empty_delivery");

    const links: BeautyMovementShortLink[] = [];
    const suffixes = new Map<string, number>();
    for (const row of params.rows) {
        const token = readInviteToken(row.inviteUrl);
        const suffix = token.slice(-5);
        const normalizedSuffix = suffix.toLowerCase();
        const previous = suffixes.get(normalizedSuffix);
        if (previous !== undefined) throw new Error(`beauty_movement_short_links_suffix_collision_${previous}`);
        suffixes.set(normalizedSuffix, links.length + 1);

        const slugPath = `/${suffix}${BEAUTY_MOVEMENT_CANONICAL_PATH}`;
        const normalizedSlugPath = `/${normalizedSuffix}${BEAUTY_MOVEMENT_CANONICAL_PATH.toLowerCase()}`;
        const destinationUrl = `https://espacofacial.com${BEAUTY_MOVEMENT_CANONICAL_PATH}#c=${token}`;
        const tokenIdentity = createHash("sha256").update(token, "utf8").digest("hex").slice(0, 32);
        links.push({
            // Keep identity independent from the short suffix. A stale/manual row
            // can reserve an old primary key without being overwritten, while the
            // token-derived digest remains stable for future idempotent syncs.
            id: `beauty-movement-short-v3-${campaignId}-${tokenIdentity}`,
            name: `Cartas da Beleza - ${suffix}`,
            inviteRef: row.inviteRef,
            whatsapp: row.whatsapp,
            token,
            shortUrl: `https://${BEAUTY_MOVEMENT_SHORT_LINK_HOST}${slugPath}`,
            slugPath,
            normalizedSlugPath,
            destinationUrl,
            destinationHost: "espacofacial.com",
            destinationPath: `${BEAUTY_MOVEMENT_CANONICAL_PATH}#c=${token}`,
            description: "Atalho personalizado da campanha Cartas da Beleza em Movimento.",
            source: BEAUTY_MOVEMENT_SHORT_LINK_SOURCE,
            placement: "beauty-movement",
            active: true,
        });
    }

    return {
        campaignId,
        createdAtMs,
        links,
        mappingHash: mappingDigest(links),
        mappingHashes: Object.fromEntries(links.map((link) => [link.normalizedSlugPath, destinationHash(link.destinationUrl)])),
    };
}

export function serializeBeautyMovementShortLinkCsv(plan: BeautyMovementShortLinkPlan): string {
    const output = ["name,invite_ref,whatsapp,invite_url"];
    for (const link of plan.links) output.push([link.name, link.inviteRef, link.whatsapp, link.shortUrl].map(csvCell).join(","));
    return `${output.join("\n")}\n`;
}

export function renderBeautyMovementShortLinkSql(plan: BeautyMovementShortLinkPlan): string {
    // Wrangler's remote D1 command rejects explicit transaction control
    // statements. Each INSERT remains idempotent through its unique slug
    // constraint and ON CONFLICT DO NOTHING clause.
    const statements: string[] = [];
    for (const link of plan.links) {
        statements.push(`INSERT INTO site_custom_urls (
id, site_host, name, slug_path, destination_url, destination_host, destination_path,
description, source, placement, unit_slug, service_id,
utm_source, utm_medium, utm_campaign, utm_content, utm_term,
active, created_at_ms, updated_at_ms
) VALUES (
${sqlString(link.id)}, ${sqlString(BEAUTY_MOVEMENT_SHORT_LINK_HOST)}, ${sqlString(link.name)}, ${sqlString(link.normalizedSlugPath)}, ${sqlString(link.destinationUrl)}, ${sqlString(link.destinationHost)}, ${sqlString(link.destinationPath)},
${sqlString(link.description)}, ${sqlString(link.source)}, ${sqlString(link.placement)}, NULL, NULL,
NULL, NULL, ${sqlString(plan.campaignId)}, NULL, NULL,
1, ${plan.createdAtMs}, ${plan.createdAtMs}
) ON CONFLICT(site_host, slug_path) DO NOTHING;`);
    }
    return `${statements.join("\n\n")}\n`;
}

export function renderBeautyMovementShortLinkRollbackSql(plan: BeautyMovementShortLinkPlan): string {
    // A rollback deactivates only the exact token-derived mappings created for
    // this plan. It deliberately does not delete history, and it refuses to
    // touch a partial or drifted set.
    const predicates = plan.links.map((link) => [
        `id = ${sqlString(link.id)}`,
        `site_host = ${sqlString(BEAUTY_MOVEMENT_SHORT_LINK_HOST)}`,
        `slug_path = ${sqlString(link.normalizedSlugPath)}`,
        `destination_url = ${sqlString(link.destinationUrl)}`,
        `source = ${sqlString(link.source)}`,
        `placement = ${sqlString(link.placement)}`,
        `utm_campaign = ${sqlString(plan.campaignId)}`,
        "active = 1",
    ].join(" AND "));
    const exactSet = predicates.map((predicate) => `(${predicate})`).join(" OR ");
    return `UPDATE site_custom_urls
SET active = 0,
    updated_at_ms = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE site_host = ${sqlString(BEAUTY_MOVEMENT_SHORT_LINK_HOST)}
  AND (SELECT COUNT(*) FROM site_custom_urls WHERE site_host = ${sqlString(BEAUTY_MOVEMENT_SHORT_LINK_HOST)} AND (${exactSet})) = ${plan.links.length}
  AND (${exactSet});\n`;
}

export function renderBeautyMovementShortLinkConflictSql(plan: BeautyMovementShortLinkPlan): string {
    const slugs = plan.links.map((link) => sqlString(link.normalizedSlugPath)).join(", ");
    return `SELECT id, site_host, slug_path, destination_url, source, active
FROM site_custom_urls
WHERE site_host = ${sqlString(BEAUTY_MOVEMENT_SHORT_LINK_HOST)} AND slug_path IN (${slugs});\n`;
}

export function renderBeautyMovementShortLinkReadbackSql(plan: BeautyMovementShortLinkPlan): string {
    const slugs = plan.links.map((link) => sqlString(link.normalizedSlugPath)).join(", ");
    return `SELECT id, site_host, slug_path, destination_url, source, active
FROM site_custom_urls
WHERE site_host = ${sqlString(BEAUTY_MOVEMENT_SHORT_LINK_HOST)} AND slug_path IN (${slugs});\n`;
}

export function shortLinkMappingHash(entries: readonly Pick<BeautyMovementShortLink, "normalizedSlugPath" | "destinationUrl">[]): string {
    const material = entries.map((entry) => `${entry.normalizedSlugPath}\t${entry.destinationUrl}`).sort().join("\n");
    return createHash("sha256").update(material, "utf8").digest("hex");
}
