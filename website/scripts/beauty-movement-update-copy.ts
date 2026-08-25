import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
    buildBeautyMovementCampaignDescriptionUpdateSql,
    validateBeautyMovementCampaignConfig,
} from "../src/lib/beautyMovementImport";

const execFileAsync = promisify(execFile);
const WEBSITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(WEBSITE_ROOT, "..");
const PRIVATE_RUNTIME_ROOT = path.resolve("/mnt/c/CodexRuntime/operator/admin/skincos/beauty-movement");

type ParsedArguments = {
    apply: boolean;
    dryRun: boolean;
    remote: boolean;
    campaign: string | null;
    campaignConfig: string | null;
    campaignEndsAt: string | null;
    confirmCampaign: string | null;
    outputDirectory: string | null;
    database: string | null;
    config: string;
};

function valueAfter(args: string[], flag: string): string | null {
    const index = args.indexOf(flag);
    if (index < 0) return null;
    if (args.indexOf(flag, index + 1) >= 0) throw new Error(`beauty_movement_duplicate_${flag.slice(2)}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`beauty_movement_missing_${flag.slice(2)}`);
    return value;
}

function parseArguments(args: string[]): ParsedArguments {
    const knownFlags = new Set([
        "--apply",
        "--dry-run",
        "--remote",
        "--campaign",
        "--campaign-config",
        "--campaign-ends-at",
        "--confirm-campaign",
        "--out-dir",
        "--database",
        "--config",
    ]);
    for (const arg of args) {
        if (arg.startsWith("--") && !knownFlags.has(arg)) throw new Error("beauty_movement_unknown_argument");
    }
    const apply = args.includes("--apply");
    const dryRun = args.includes("--dry-run");
    if (apply === dryRun) throw new Error("beauty_movement_copy_mode_required");
    if (args.includes("--remote") && !apply) throw new Error("beauty_movement_remote_apply_required");
    return {
        apply,
        dryRun,
        remote: args.includes("--remote"),
        campaign: valueAfter(args, "--campaign"),
        campaignConfig: valueAfter(args, "--campaign-config"),
        campaignEndsAt: valueAfter(args, "--campaign-ends-at"),
        confirmCampaign: valueAfter(args, "--confirm-campaign"),
        outputDirectory: valueAfter(args, "--out-dir"),
        database: valueAfter(args, "--database"),
        config: valueAfter(args, "--config") ?? "wrangler.toml",
    };
}

function isWithin(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function privateRuntimeRoots(): readonly string[] {
    const configuredRoot = process.env.BEAUTY_MOVEMENT_PRIVATE_RUNTIME_ROOT?.trim();
    if (!configuredRoot) return [PRIVATE_RUNTIME_ROOT];
    const runnerTemp = process.env.RUNNER_TEMP?.trim();
    if (
        process.env.GITHUB_ACTIONS !== "true" ||
        !path.isAbsolute(configuredRoot) ||
        !runnerTemp ||
        !path.isAbsolute(runnerTemp) ||
        !isWithin(path.resolve(runnerTemp), path.resolve(configuredRoot))
    ) {
        throw new Error("beauty_movement_private_runtime_root_invalid");
    }
    return [PRIVATE_RUNTIME_ROOT, path.resolve(configuredRoot)];
}

function privateAbsolutePath(value: string, purpose: "input" | "output"): string {
    const windowsPath = /^([A-Za-z]):[\\/](.*)$/.exec(value);
    const wslVisiblePath = windowsPath
        ? `/mnt/${windowsPath[1]!.toLowerCase()}/${windowsPath[2]!.replace(/\\/g, "/")}`
        : value;
    if (!path.isAbsolute(wslVisiblePath)) throw new Error(`beauty_movement_${purpose}_must_be_absolute`);
    const resolved = path.resolve(wslVisiblePath);
    if (isWithin(REPOSITORY_ROOT, resolved) || !privateRuntimeRoots().some((root) => isWithin(root, resolved))) {
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

async function readCampaignConfig(configPath: string) {
    try {
        return validateBeautyMovementCampaignConfig(JSON.parse(await readFile(configPath, "utf8")));
    } catch (error) {
        if (error instanceof Error && error.message === "beauty_movement_campaign_config_invalid") throw error;
        throw new Error("beauty_movement_campaign_config_invalid");
    }
}

async function runD1Update(params: { database: string; config: string; sqlFile: string }): Promise<void> {
    try {
        await execFileAsync(
            "npx",
            ["--yes", "wrangler@4.112.0", "d1", "execute", params.database, "--remote", "--config", params.config, "--file", params.sqlFile],
            { cwd: WEBSITE_ROOT, maxBuffer: 2 * 1024 * 1024 },
        );
    } catch {
        throw new Error("beauty_movement_campaign_copy_update_failed");
    }
}

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    if (!options.campaign || options.confirmCampaign !== options.campaign) {
        throw new Error("beauty_movement_campaign_confirmation_required");
    }
    if (!options.campaignConfig) throw new Error("beauty_movement_campaign_config_required");
    const campaignEndsAtMs = parseCampaignEndsAt(options.campaignEndsAt);
    const campaignConfigPath = privateAbsolutePath(options.campaignConfig, "input");
    const campaignConfig = await readCampaignConfig(campaignConfigPath);

    if (options.dryRun) {
        console.log(JSON.stringify({
            mode: "dry_run",
            preflight: "complete",
            campaignId: options.campaign,
            campaignEndsAtMs,
            descriptionLength: campaignConfig.description.length,
        }));
        return;
    }

    if (!options.remote || !options.database || !/^[a-z0-9][a-z0-9-]{2,127}$/i.test(options.database)) {
        throw new Error("beauty_movement_remote_database_required");
    }
    if (!options.outputDirectory) throw new Error("beauty_movement_private_output_required");
    const outputDirectory = privateAbsolutePath(options.outputDirectory, "output");
    await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    const sqlFile = path.join(outputDirectory, `campaign-copy-${Date.now()}.sql`);
    const sql = buildBeautyMovementCampaignDescriptionUpdateSql({
        campaignId: options.campaign,
        description: campaignConfig.description,
        campaignEndsAtMs,
    });
    await writeFile(sqlFile, sql, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await runD1Update({ database: options.database, config: options.config, sqlFile });
    console.log(JSON.stringify({
        mode: "applied",
        target: "remote",
        campaignId: options.campaign,
        descriptionLength: campaignConfig.description.length,
    }));
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "beauty_movement_campaign_copy_update_failed");
    process.exitCode = 1;
});
