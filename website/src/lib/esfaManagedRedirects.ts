import {
    buildEsfaRedirectLabel,
    listEsfaRedirects,
    normalizeEsfaRedirectPath,
} from "@/lib/esfaRedirects";
import {
    normalizeSiteCustomUrlInput,
    type NormalizedSiteCustomUrlInput,
    type SiteCustomUrlRow,
} from "@/lib/siteCustomUrls";

export const ESFA_SITE_HOST = "esfa.co";
export const ESFA_MIGRATED_SOURCE = "cloudflare_worker_migrated";

type ManagedUrlIdentity =
    | Pick<SiteCustomUrlRow, "site_host" | "slug_path">
    | { siteHost: string; slugPath: string };

export type EsfaManagedUrlSeed = NormalizedSiteCustomUrlInput & {
    id: string;
    createdAtMs: number;
    updatedAtMs: number;
};

function fnv1a(input: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function inferPlacement(slugPath: string, destinationHost: string | null): string {
    const normalizedPath = normalizeEsfaRedirectPath(slugPath);
    const host = (destinationHost ?? "").toLowerCase();
    if (host === "api.whatsapp.com" || host === "wa.me" || host === "chat.whatsapp.com") return "whatsapp";
    if (host === "www.google.com") return "maps";
    if (host === "www.facebook.com" || host === "www.instagram.com") return "social";
    if (host === "payment-link-v3.stone.com.br") return "payment";
    if (host === "auto.bsbank.com.br") return "campaign";
    if (
        host === "espacofacial.com" ||
        host === "www.espacofacial.com" ||
        host === "espacofacial.com.br" ||
        host === "www.espacofacial.com.br" ||
        host === "app.espacofacial.com.br"
    ) {
        return normalizedPath.startsWith("/campanhas/") ? "campaign" : "internal";
    }
    return "campaign";
}

function inferUnitSlug(slugPath: string): string | null {
    const normalizedPath = normalizeEsfaRedirectPath(slugPath);
    if (normalizedPath === "/bss" || normalizedPath.startsWith("/bss/")) return "barrashoppingsul";
    if (normalizedPath === "/nh" || normalizedPath.startsWith("/nh/")) return "novo-hamburgo";
    return null;
}

export function buildEsfaManagedRedirectSeed(params: {
    slugPath: string;
    destinationUrl: string;
    now?: number;
}): EsfaManagedUrlSeed {
    const normalizedSlugPath = normalizeEsfaRedirectPath(params.slugPath);
    const now = params.now ?? Date.now();
    const normalized = normalizeSiteCustomUrlInput({
        siteHost: ESFA_SITE_HOST,
        name: buildEsfaRedirectLabel(normalizedSlugPath),
        slugPath: normalizedSlugPath,
        destinationUrl: params.destinationUrl,
        description: "Migrado do catálogo esfa.co",
        source: ESFA_MIGRATED_SOURCE,
        placement: inferPlacement(normalizedSlugPath, null),
        unitSlug: inferUnitSlug(normalizedSlugPath),
        active: true,
    });
    return {
        ...normalized,
        id: `esfa_${fnv1a(`${ESFA_SITE_HOST}|${normalizedSlugPath}`)}`,
        placement: inferPlacement(normalizedSlugPath, normalized.destinationHost),
        unitSlug: inferUnitSlug(normalizedSlugPath),
        createdAtMs: now,
        updatedAtMs: now,
    };
}

export function listEsfaManagedRedirectSeeds(now = Date.now()): EsfaManagedUrlSeed[] {
    return listEsfaRedirects().map((entry) =>
        buildEsfaManagedRedirectSeed({
            slugPath: entry.slugPath,
            destinationUrl: entry.destinationUrl,
            now,
        }),
    );
}

export function listEsfaFallbackRedirects(identities: ManagedUrlIdentity[]) {
    const migratedPaths = new Set(
        identities
            .filter((item) => (("site_host" in item ? item.site_host : item.siteHost) || "").toLowerCase() === ESFA_SITE_HOST)
            .map((item) => normalizeEsfaRedirectPath("slug_path" in item ? item.slug_path : item.slugPath)),
    );
    return listEsfaRedirects({ excludePaths: migratedPaths });
}
