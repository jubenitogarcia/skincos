import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
    ESFA_MIGRATED_SOURCE,
    ESFA_SITE_HOST,
    listEsfaManagedRedirectSeeds,
    type EsfaManagedUrlSeed,
} from "../src/lib/esfaManagedRedirects";

const execFileAsync = promisify(execFile);
const DATABASE_NAME = "espacofacial-booking";
const WEBSITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type ExistingRedirectRow = {
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
};

type MigrationPlan = {
    inserts: EsfaManagedUrlSeed[];
    updates: Array<{ existing: ExistingRedirectRow; seed: EsfaManagedUrlSeed }>;
    skips: Array<{ existing: ExistingRedirectRow; seed: EsfaManagedUrlSeed }>;
    conflicts: Array<{ existing: ExistingRedirectRow; seed: EsfaManagedUrlSeed }>;
};

function hasFlag(flag: string): boolean {
    return process.argv.includes(flag);
}

function sqlString(value: string | null): string {
    if (value === null) return "NULL";
    return `'${value.replace(/'/g, "''")}'`;
}

function canonicalUrl(value: string): string {
    return new URL(value).toString();
}

function extractRows(payload: unknown): ExistingRedirectRow[] {
    if (Array.isArray(payload)) {
        for (const item of payload) {
            const rows = extractRows(item);
            if (rows.length) return rows;
        }
        return [];
    }
    if (!payload || typeof payload !== "object") return [];
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.results)) return record.results as ExistingRedirectRow[];
    if (record.result) return extractRows(record.result);
    if (Array.isArray(record.rows)) return record.rows as ExistingRedirectRow[];
    if (Array.isArray(record.data)) return record.data as ExistingRedirectRow[];
    return [];
}

async function runWranglerJson(query: string, remote: boolean): Promise<unknown> {
    const args = [
        "wrangler",
        "d1",
        "execute",
        DATABASE_NAME,
        "--json",
        "--command",
        query,
    ];
    args.push(remote ? "--remote" : "--local");
    const { stdout } = await execFileAsync("npx", args, {
        cwd: WEBSITE_ROOT,
        maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(stdout);
}

async function readExistingRows(remote: boolean): Promise<ExistingRedirectRow[]> {
    const payload = await runWranglerJson(
        `SELECT
            id, site_host, name, slug_path, destination_url, destination_host, destination_path,
            description, source, placement, unit_slug, service_id,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            active, created_at_ms, updated_at_ms
         FROM site_custom_urls
         WHERE site_host = '${ESFA_SITE_HOST}'
         ORDER BY slug_path ASC;`,
        remote,
    );
    return extractRows(payload);
}

function seedMatchesExisting(existing: ExistingRedirectRow, seed: EsfaManagedUrlSeed): boolean {
    return (
        existing.id === seed.id &&
        existing.site_host === seed.siteHost &&
        existing.name === seed.name &&
        existing.slug_path === seed.slugPath &&
        canonicalUrl(existing.destination_url) === canonicalUrl(seed.destinationUrl) &&
        (existing.destination_host ?? null) === (seed.destinationHost ?? null) &&
        (existing.destination_path ?? null) === (seed.destinationPath ?? null) &&
        (existing.description ?? null) === (seed.description ?? null) &&
        existing.source === seed.source &&
        (existing.placement ?? null) === (seed.placement ?? null) &&
        (existing.unit_slug ?? null) === (seed.unitSlug ?? null) &&
        (existing.service_id ?? null) === (seed.serviceId ?? null) &&
        (existing.utm_source ?? null) === (seed.utmSource ?? null) &&
        (existing.utm_medium ?? null) === (seed.utmMedium ?? null) &&
        (existing.utm_campaign ?? null) === (seed.utmCampaign ?? null) &&
        (existing.utm_content ?? null) === (seed.utmContent ?? null) &&
        (existing.utm_term ?? null) === (seed.utmTerm ?? null) &&
        existing.active === (seed.active ? 1 : 0)
    );
}

function buildPlan(existingRows: ExistingRedirectRow[], seeds: EsfaManagedUrlSeed[]): MigrationPlan {
    const existingBySlug = new Map(existingRows.map((row) => [row.slug_path, row]));
    const plan: MigrationPlan = {
        inserts: [],
        updates: [],
        skips: [],
        conflicts: [],
    };

    for (const seed of seeds) {
        const existing = existingBySlug.get(seed.slugPath);
        if (!existing) {
            plan.inserts.push(seed);
            continue;
        }
        if (canonicalUrl(existing.destination_url) !== canonicalUrl(seed.destinationUrl)) {
            if (existing.source === ESFA_MIGRATED_SOURCE) {
                plan.updates.push({ existing, seed });
                continue;
            }
            plan.conflicts.push({ existing, seed });
            continue;
        }
        if (seedMatchesExisting(existing, seed)) {
            plan.skips.push({ existing, seed });
            continue;
        }
        plan.updates.push({ existing, seed });
    }

    return plan;
}

function renderInsert(seed: EsfaManagedUrlSeed): string {
    return `INSERT INTO site_custom_urls (
id, site_host, name, slug_path, destination_url, destination_host, destination_path,
description, source, placement, unit_slug, service_id,
utm_source, utm_medium, utm_campaign, utm_content, utm_term,
active, created_at_ms, updated_at_ms
) VALUES (
${sqlString(seed.id)}, ${sqlString(seed.siteHost)}, ${sqlString(seed.name)}, ${sqlString(seed.slugPath)}, ${sqlString(seed.destinationUrl)}, ${sqlString(seed.destinationHost)}, ${sqlString(seed.destinationPath)},
${sqlString(seed.description)}, ${sqlString(seed.source)}, ${sqlString(seed.placement)}, ${sqlString(seed.unitSlug)}, ${sqlString(seed.serviceId)},
${sqlString(seed.utmSource)}, ${sqlString(seed.utmMedium)}, ${sqlString(seed.utmCampaign)}, ${sqlString(seed.utmContent)}, ${sqlString(seed.utmTerm)},
${seed.active ? 1 : 0}, ${seed.createdAtMs}, ${seed.updatedAtMs}
);`;
}

function renderUpdate(entry: { existing: ExistingRedirectRow; seed: EsfaManagedUrlSeed }): string {
    const { existing, seed } = entry;
    return `UPDATE site_custom_urls
SET id = ${sqlString(seed.id)},
    name = ${sqlString(seed.name)},
    destination_url = ${sqlString(seed.destinationUrl)},
    destination_host = ${sqlString(seed.destinationHost)},
    destination_path = ${sqlString(seed.destinationPath)},
    description = ${sqlString(seed.description)},
    source = ${sqlString(seed.source)},
    placement = ${sqlString(seed.placement)},
    unit_slug = ${sqlString(seed.unitSlug)},
    service_id = ${sqlString(seed.serviceId)},
    utm_source = ${sqlString(seed.utmSource)},
    utm_medium = ${sqlString(seed.utmMedium)},
    utm_campaign = ${sqlString(seed.utmCampaign)},
    utm_content = ${sqlString(seed.utmContent)},
    utm_term = ${sqlString(seed.utmTerm)},
    active = ${seed.active ? 1 : 0},
    updated_at_ms = ${seed.updatedAtMs}
WHERE site_host = ${sqlString(existing.site_host)}
  AND slug_path = ${sqlString(existing.slug_path)};`;
}

function printSummary(plan: MigrationPlan, seedCount: number) {
    console.log(`total_catalogo=${seedCount}`);
    console.log(`inserts=${plan.inserts.length}`);
    console.log(`updates=${plan.updates.length}`);
    console.log(`skips=${plan.skips.length}`);
    console.log(`conflicts=${plan.conflicts.length}`);
    if (plan.conflicts.length) {
        console.log("conflict_details=");
        for (const conflict of plan.conflicts.slice(0, 20)) {
            console.log(
                `${conflict.seed.slugPath} => atual=${conflict.existing.destination_url} :: catalogo=${conflict.seed.destinationUrl}`,
            );
        }
        if (plan.conflicts.length > 20) {
            console.log(`... +${plan.conflicts.length - 20} conflitos adicionais`);
        }
    }
}

async function applyPlan(plan: MigrationPlan, remote: boolean) {
    if (!plan.inserts.length && !plan.updates.length) return;
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "skincos-esfa-migrate-"));
    const sqlFile = path.join(tempDir, "migrate-esfa-redirects.sql");
    const statements = [...plan.inserts.map(renderInsert), ...plan.updates.map(renderUpdate)];
    await writeFile(sqlFile, `${statements.join("\n")}\n`, "utf8");
    try {
        await execFileAsync(
            "npx",
            [
                "wrangler",
                "d1",
                "execute",
                DATABASE_NAME,
                "--file",
                sqlFile,
                remote ? "--remote" : "--local",
            ],
            {
                cwd: WEBSITE_ROOT,
                maxBuffer: 8 * 1024 * 1024,
            },
        );
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
}

async function main() {
    const apply = hasFlag("--apply");
    const remote = hasFlag("--remote") || !hasFlag("--local");
    const now = Date.now();
    const seeds = listEsfaManagedRedirectSeeds(now);
    const existingRows = await readExistingRows(remote);
    const plan = buildPlan(existingRows, seeds);
    printSummary(plan, seeds.length);
    if (!apply) return;
    if (plan.conflicts.length) {
        process.exitCode = 2;
        return;
    }
    await applyPlan(plan, remote);
    const refreshedRows = await readExistingRows(remote);
    console.log(`final_rows=${refreshedRows.length}`);
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
