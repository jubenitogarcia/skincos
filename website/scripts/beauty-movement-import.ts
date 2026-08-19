import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
    buildBeautyMovementImportSql,
    prepareBeautyMovementImport,
    serializeBeautyMovementDeliveryCsv,
    summarizeBeautyMovementImport,
    validateBeautyMovementCampaignConfig,
    validateBeautyMovementImport,
    type BeautyMovementCanonicalProcedure,
    type BeautyMovementRewardCatalogEntry,
} from "../src/lib/beautyMovementImport";
import { validateBeautyMovementRewardCatalog } from "../src/lib/beautyMovementRewards";

const execFileAsync = promisify(execFile);
const WEBSITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(WEBSITE_ROOT, "..");
const PRIVATE_RUNTIME_ROOT = path.resolve("/mnt/c/CodexRuntime/operator/admin/skincos/beauty-movement");

type ParsedArguments = {
    apply: boolean;
    dryRun: boolean;
    remote: boolean;
    local: boolean;
    input: string | null;
    rewardCatalog: string | null;
    procedureCatalog: string | null;
    campaign: string | null;
    campaignConfig: string | null;
    campaignEndsAt: string | null;
    confirmCampaign: string | null;
    outputDirectory: string | null;
    database: string | null;
    config: string;
    help: boolean;
};

function valueAfter(args: string[], flag: string): string | null {
    const matches = args.reduce<number[]>((found, item, index) => item === flag ? [...found, index] : found, []);
    if (matches.length > 1) throw new Error(`beauty_movement_duplicate_${flag.slice(2)}`);
    const index = matches[0];
    if (index === undefined) return null;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`beauty_movement_missing_${flag.slice(2)}`);
    return value;
}

function hasFlag(args: string[], flag: string): boolean {
    return args.includes(flag);
}

function parseArguments(args: string[]): ParsedArguments {
    const knownFlags = new Set([
        "--apply",
        "--dry-run",
        "--remote",
        "--local",
        "--input",
        "--reward-catalog",
        "--procedure-catalog",
        "--campaign",
        "--campaign-config",
        "--campaign-ends-at",
        "--confirm-campaign",
        "--out-dir",
        "--database",
        "--config",
        "--help",
    ]);
    for (const arg of args) {
        if (arg.startsWith("--") && !knownFlags.has(arg)) throw new Error("beauty_movement_unknown_argument");
    }
    const apply = hasFlag(args, "--apply");
    const dryRun = hasFlag(args, "--dry-run");
    if (apply && dryRun) throw new Error("beauty_movement_conflicting_mode");
    const remote = hasFlag(args, "--remote");
    const local = hasFlag(args, "--local");
    if (remote && local) throw new Error("beauty_movement_conflicting_target");
    return {
        apply,
        dryRun,
        remote,
        local,
        input: valueAfter(args, "--input"),
        rewardCatalog: valueAfter(args, "--reward-catalog"),
        procedureCatalog: valueAfter(args, "--procedure-catalog"),
        campaign: valueAfter(args, "--campaign"),
        campaignConfig: valueAfter(args, "--campaign-config"),
        campaignEndsAt: valueAfter(args, "--campaign-ends-at"),
        confirmCampaign: valueAfter(args, "--confirm-campaign"),
        outputDirectory: valueAfter(args, "--out-dir"),
        database: valueAfter(args, "--database"),
        config: valueAfter(args, "--config") ?? "wrangler.toml",
        help: hasFlag(args, "--help"),
    };
}

function isWithin(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function privateAbsolutePath(value: string, purpose: "input" | "output"): string {
    const windowsPath = /^([A-Za-z]):[\\/](.*)$/.exec(value);
    const wslVisiblePath = windowsPath
        ? `/mnt/${windowsPath[1]!.toLowerCase()}/${windowsPath[2]!.replace(/\\/g, "/")}`
        : value;
    if (!path.isAbsolute(wslVisiblePath)) throw new Error(`beauty_movement_${purpose}_must_be_absolute`);
    const resolved = path.resolve(wslVisiblePath);
    if (isWithin(REPOSITORY_ROOT, resolved) || !isWithin(PRIVATE_RUNTIME_ROOT, resolved)) {
        throw new Error(`beauty_movement_${purpose}_must_be_private`);
    }
    return resolved;
}

function parseCampaignEndsAt(value: string | null): number {
    if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
        throw new Error("beauty_movement_invalid_campaign_ends_at");
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw new Error("beauty_movement_invalid_campaign_ends_at");
    return timestamp;
}

function requireApplyArguments(options: ParsedArguments): {
    campaign: string;
    campaignConfigPath: string;
    campaignEndsAtMs: number;
    outputDirectory: string;
    database: string;
    target: "local" | "remote";
} {
    if (!options.apply) throw new Error("beauty_movement_apply_required");
    if (!options.remote && !options.local) throw new Error("beauty_movement_target_required");
    if (!options.campaign || options.confirmCampaign !== options.campaign) {
        throw new Error("beauty_movement_campaign_confirmation_required");
    }
    if (!options.campaignConfig) throw new Error("beauty_movement_campaign_config_required");
    if (!options.outputDirectory) throw new Error("beauty_movement_private_output_required");
    if (!options.database || !/^[a-z0-9][a-z0-9-]{2,127}$/i.test(options.database)) {
        throw new Error("beauty_movement_invalid_database");
    }
    return {
        campaign: options.campaign,
        campaignConfigPath: privateAbsolutePath(options.campaignConfig, "input"),
        campaignEndsAtMs: parseCampaignEndsAt(options.campaignEndsAt),
        outputDirectory: privateAbsolutePath(options.outputDirectory, "output"),
        database: options.database,
        target: options.remote ? "remote" : "local",
    };
}

function requireDryRunArguments(options: ParsedArguments): {
    campaign: string;
    campaignConfigPath: string;
    campaignEndsAtMs: number;
} {
    if (!options.dryRun) throw new Error("beauty_movement_dry_run_required");
    if (!options.campaign || !/^[a-z0-9][a-z0-9_-]{2,79}$/i.test(options.campaign)) {
        throw new Error("beauty_movement_campaign_required");
    }
    if (!options.campaignConfig) throw new Error("beauty_movement_campaign_config_required");
    return {
        campaign: options.campaign,
        campaignConfigPath: privateAbsolutePath(options.campaignConfig, "input"),
        campaignEndsAtMs: parseCampaignEndsAt(options.campaignEndsAt),
    };
}

async function readCampaignConfig(configPath: string) {
    try {
        const source = await readFile(configPath, "utf8");
        return validateBeautyMovementCampaignConfig(JSON.parse(source));
    } catch (error) {
        if (error instanceof Error && error.message === "beauty_movement_campaign_config_invalid") throw error;
        throw new Error("beauty_movement_campaign_config_invalid");
    }
}

async function readPrivateJson(filePath: string, errorCode: string): Promise<unknown> {
    try {
        return JSON.parse(await readFile(filePath, "utf8")) as unknown;
    } catch {
        throw new Error(errorCode);
    }
}

async function writePrivateFile(destination: string, contents: string): Promise<void> {
    await writeFile(destination, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

async function runD1Import(params: { database: string; config: string; sqlFile: string; target: "local" | "remote" }): Promise<void> {
    try {
        await execFileAsync(
            "npx",
            ["wrangler", "d1", "execute", params.database, `--${params.target}`, "--config", params.config, "--file", params.sqlFile],
            { cwd: WEBSITE_ROOT, maxBuffer: 2 * 1024 * 1024 },
        );
    } catch {
        // Do not surface command stdout/stderr; it may contain operational context.
        throw new Error(`beauty_movement_${params.target}_import_failed`);
    }
}

function printHelp(): void {
    console.log([
        "Uso: npm run beauty-movement:import -- --input <arquivo-privado> [--dry-run]",
        "--reward-catalog/--procedure-catalog são opcionais; use ambos apenas para compatibilidade com reward_id legado.",
        "Aplicação exige: --apply (--local | --remote) --campaign <id> --confirm-campaign <id>",
        "  --campaign-ends-at <ISO-8601> --campaign-config <json-privado> --database <d1> --out-dir <diretorio-privado>",
        "CSV, catálogos, JSON da campanha e saídas devem ficar em C:\\CodexRuntime\\operator\\admin\\skincos\\beauty-movement.",
    ].join("\n"));
}

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }
    if (!options.input) throw new Error("beauty_movement_input_required");
    const input = privateAbsolutePath(options.input, "input");
    let csv: string;
    try {
        csv = await readFile(input, "utf8");
    } catch {
        throw new Error("beauty_movement_input_unavailable");
    }

    if (Boolean(options.rewardCatalog) !== Boolean(options.procedureCatalog)) {
        throw new Error("beauty_movement_reward_catalog_pair_required");
    }
    const rewardCatalog = options.rewardCatalog
        ? await readPrivateJson(privateAbsolutePath(options.rewardCatalog, "input"), "beauty_movement_reward_catalog_unavailable")
        : [];
    const procedureCatalog = options.procedureCatalog
        ? await readPrivateJson(privateAbsolutePath(options.procedureCatalog, "input"), "beauty_movement_procedure_catalog_unavailable")
        : [];
    let validatedRewards: BeautyMovementRewardCatalogEntry[] = [];
    if (options.rewardCatalog) {
        try {
            validatedRewards = validateBeautyMovementRewardCatalog({
                catalog: rewardCatalog,
                procedureCatalog: Array.isArray(procedureCatalog) ? procedureCatalog as BeautyMovementCanonicalProcedure[] : [],
            });
        } catch {
            throw new Error("beauty_movement_reward_catalog_invalid");
        }
    }

    const validation = validateBeautyMovementImport({ csv, rewardCatalog: validatedRewards });
    if (!validation.ok) {
        // This JSON is intentionally aggregate-only: no path, contact, token or row detail.
        console.log(JSON.stringify({ mode: options.dryRun ? "dry_run" : "dry_run_default", ...summarizeBeautyMovementImport(validation) }));
        process.exitCode = 2;
        return;
    }
    if (options.dryRun) {
        const preflight = requireDryRunArguments(options);
        const campaignConfig = await readCampaignConfig(preflight.campaignConfigPath);
        if (campaignConfig.startsAtMs !== null && campaignConfig.startsAtMs > preflight.campaignEndsAtMs) {
            throw new Error("beauty_movement_campaign_start_after_end");
        }
        console.log(JSON.stringify({
            mode: "dry_run",
            preflight: "complete",
            campaignId: preflight.campaign,
            campaignEndsAtMs: preflight.campaignEndsAtMs,
            ...summarizeBeautyMovementImport(validation),
        }));
        return;
    }
    if (!options.apply) {
        // Preserve a non-writing validation mode for operators that only need
        // CSV and catalog feedback, while `--dry-run` is the complete preflight.
        console.log(JSON.stringify({ mode: "dry_run_default", ...summarizeBeautyMovementImport(validation) }));
        return;
    }

    const apply = requireApplyArguments(options);
    const campaignConfig = await readCampaignConfig(apply.campaignConfigPath);
    const tokenHmacKey = (process.env.BEAUTY_MOVEMENT_TOKEN_HMAC_KEY ?? "").trim();
    const piiKey = (process.env.BEAUTY_MOVEMENT_PII_KEY ?? "").trim();
    if (!tokenHmacKey || !piiKey) throw new Error("beauty_movement_import_keys_unavailable");

    const plan = await prepareBeautyMovementImport({
        csv,
        campaignId: apply.campaign,
        campaignConfig,
        campaignEndsAtMs: apply.campaignEndsAtMs,
        rewardCatalog: Array.isArray(rewardCatalog) ? rewardCatalog as BeautyMovementRewardCatalogEntry[] : [],
        procedureCatalog: Array.isArray(procedureCatalog) ? procedureCatalog as BeautyMovementCanonicalProcedure[] : [],
        tokenHmacKey,
        piiKey,
    });
    await mkdir(apply.outputDirectory, { recursive: true, mode: 0o700 });
    const stamp = new Date(plan.createdAtMs).toISOString().replace(/[:.]/g, "-");
    const prefix = `beauty-movement-${plan.campaignId}-${stamp}-${plan.importRunId}`;
    const sqlFile = path.join(apply.outputDirectory, `${prefix}.sql`);
    const deliveryFile = path.join(apply.outputDirectory, `${prefix}-delivery.csv`);
    const summaryFile = path.join(apply.outputDirectory, `${prefix}-summary.json`);

    await writePrivateFile(sqlFile, buildBeautyMovementImportSql(plan));
    try {
        await runD1Import({ database: apply.database, config: options.config, sqlFile, target: apply.target });
        await writePrivateFile(deliveryFile, serializeBeautyMovementDeliveryCsv(plan.deliveryRows));
        await writePrivateFile(summaryFile, JSON.stringify({
            campaignId: plan.campaignId,
            sourceRows: plan.sourceRowCount,
            acceptedRows: plan.invites.length,
            inputSha256: plan.inputSha256,
            appliedAtMs: Date.now(),
        }, null, 2));
    } catch (error) {
        // SQL is encrypted and private; retain it for restricted operator diagnosis, never echo it.
        throw error;
    }
    console.log(JSON.stringify({ mode: "applied", target: apply.target, acceptedRows: plan.invites.length, campaignId: plan.campaignId }));
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "beauty_movement_import_failed");
    process.exitCode = 1;
});
