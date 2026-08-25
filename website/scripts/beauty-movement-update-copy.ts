import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
    buildBeautyMovementCampaignDescriptionUpdateSql,
    normalizeBeautyMovementCampaignDescription,
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
    restore: boolean;
    campaign: string | null;
    campaignConfig: string | null;
    campaignEndsAt: string | null;
    confirmCampaign: string | null;
    expectedState: string | null;
    applySummary: string | null;
    normalizedDescriptionOutput: string | null;
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
        "--restore",
        "--campaign",
        "--campaign-config",
        "--campaign-ends-at",
        "--confirm-campaign",
        "--expected-state",
        "--apply-summary",
        "--normalized-description-out",
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
    if (args.includes("--restore") && !apply) throw new Error("beauty_movement_restore_apply_required");
    return {
        apply,
        dryRun,
        remote: args.includes("--remote"),
        restore: args.includes("--restore"),
        campaign: valueAfter(args, "--campaign"),
        campaignConfig: valueAfter(args, "--campaign-config"),
        campaignEndsAt: valueAfter(args, "--campaign-ends-at"),
        confirmCampaign: valueAfter(args, "--confirm-campaign"),
        expectedState: valueAfter(args, "--expected-state"),
        applySummary: valueAfter(args, "--apply-summary"),
        normalizedDescriptionOutput: valueAfter(args, "--normalized-description-out"),
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

type CampaignState = {
    id: string;
    status: string;
    endsAtMs: number;
    description: string;
    updatedAtMs: number;
};

function d1RowFromFile(fileContents: string): Record<string, unknown> {
    try {
        const row = JSON.parse(fileContents)?.[0]?.results?.[0];
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error();
        return row as Record<string, unknown>;
    } catch {
        throw new Error("beauty_movement_campaign_state_invalid");
    }
}

async function readCampaignState(statePath: string, expectedCampaignId: string, expectedEndsAtMs: number): Promise<CampaignState> {
    const row = d1RowFromFile(await readFile(statePath, "utf8"));
    const description = normalizeBeautyMovementCampaignDescription(typeof row.description === "string" ? row.description : undefined);
    const endsAtMs = Number(row.ends_at_ms);
    const updatedAtMs = Number(row.updated_at_ms);
    if (
        row.id !== expectedCampaignId ||
        row.status !== "active" ||
        endsAtMs !== expectedEndsAtMs ||
        endsAtMs <= Date.now() ||
        !description ||
        row.description !== description ||
        !Number.isSafeInteger(updatedAtMs) ||
        updatedAtMs <= 0
    ) {
        throw new Error("beauty_movement_campaign_state_invalid");
    }
    return { id: expectedCampaignId, status: "active", endsAtMs, description, updatedAtMs };
}

async function readApplySummary(summaryPath: string): Promise<{ mode: "pending" | "applied"; updatedAtMs: number }> {
    try {
        const value = JSON.parse(await readFile(summaryPath, "utf8"));
        const updatedAtMs = Number(value?.updatedAtMs);
        if (!["pending", "applied"].includes(value?.mode) || !Number.isSafeInteger(updatedAtMs) || updatedAtMs <= 0) throw new Error();
        return { mode: value.mode, updatedAtMs };
    } catch {
        throw new Error("beauty_movement_campaign_apply_summary_invalid");
    }
}

async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
    await writeFile(filePath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "w" });
}

function classifyD1UpdateFailure(error: unknown): string {
    if (!error || typeof error !== "object") return "unknown";
    const record = error as Record<string, unknown>;
    if (record.code === "ENOENT") return "command_missing";
    const stderr = typeof record.stderr === "string" ? record.stderr.toLowerCase() : "";
    if (stderr.includes("unauthorized") || stderr.includes("forbidden") || stderr.includes("authentication")) return "authorization";
    if (stderr.includes("database") || stderr.includes("d1") || stderr.includes("sql")) return "remote_rejected";
    return "command_failed";
}

function failD1Update(diagnostic: string): never {
    console.error(`beauty_movement_campaign_copy_update_diagnostic:${diagnostic}`);
    throw new Error("beauty_movement_campaign_copy_update_failed");
}

async function runD1Update(params: { database: string; config: string; sqlFile: string }): Promise<number> {
    let result: Awaited<ReturnType<typeof execFileAsync>>;
    try {
        result = await execFileAsync(
            "npx",
            ["--yes", "wrangler@4.112.0", "d1", "execute", params.database, "--remote", "--config", params.config, "--file", params.sqlFile, "--json"],
            { cwd: WEBSITE_ROOT, maxBuffer: 2 * 1024 * 1024 },
        );
    } catch (error) {
        return failD1Update(classifyD1UpdateFailure(error));
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(result.stdout.toString("utf8"));
    } catch {
        return failD1Update("response_invalid");
    }
    const payload = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || (payload as { success?: unknown }).success !== true) {
        return failD1Update("response_rejected");
    }
    // Wrangler's --file JSON does not expose a stable affected-row count.
    // The SQL CAS predicate plus the post-write readback prove the single
    // logical update; metadata is intentionally treated as advisory.
    return 1;
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
        if (options.restore || options.expectedState || options.applySummary) throw new Error("beauty_movement_dry_run_state_arguments_invalid");
        if (options.normalizedDescriptionOutput) {
            const normalizedPath = privateAbsolutePath(options.normalizedDescriptionOutput, "output");
            await writePrivateJson(normalizedPath, { description: campaignConfig.description });
        }
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
    if (!options.expectedState) throw new Error("beauty_movement_campaign_expected_state_required");
    if (options.normalizedDescriptionOutput) throw new Error("beauty_movement_apply_normalized_output_invalid");
    const outputDirectory = privateAbsolutePath(options.outputDirectory, "output");
    const expectedStatePath = privateAbsolutePath(options.expectedState, "input");
    const expectedState = await readCampaignState(expectedStatePath, options.campaign, campaignEndsAtMs);
    const applySummaryPath = options.applySummary ? privateAbsolutePath(options.applySummary, "output") : null;
    if (!options.restore && !applySummaryPath) throw new Error("beauty_movement_apply_summary_required");
    if (options.restore && !applySummaryPath) throw new Error("beauty_movement_restore_summary_required");
    const applySummary = options.restore ? await readApplySummary(applySummaryPath!) : null;
    await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    const sqlFile = path.join(outputDirectory, `campaign-copy-${Date.now()}.sql`);
    const updatedAtMs = Date.now();
    const description = options.restore ? expectedState.description : campaignConfig.description;
    const expectedDescription = options.restore ? campaignConfig.description : expectedState.description;
    const expectedUpdatedAtMs = options.restore ? applySummary!.updatedAtMs : expectedState.updatedAtMs;
    const sql = buildBeautyMovementCampaignDescriptionUpdateSql({
        campaignId: options.campaign,
        description,
        campaignEndsAtMs,
        expectedDescription,
        expectedUpdatedAtMs,
        updatedAtMs,
    });
    await writeFile(sqlFile, sql, { encoding: "utf8", mode: 0o600, flag: "wx" });
    if (applySummaryPath) {
        await writePrivateJson(applySummaryPath, { mode: "pending", updatedAtMs });
    }
    const changedRows = await runD1Update({ database: options.database, config: options.config, sqlFile });
    if (applySummaryPath) {
        await writePrivateJson(applySummaryPath, { mode: "applied", updatedAtMs, changedRows });
    }
    console.log(JSON.stringify({
        mode: options.restore ? "restored" : "applied",
        target: "remote",
        campaignId: options.campaign,
        descriptionLength: description.length,
        updatedAtMs,
        changedRows,
    }));
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "beauty_movement_campaign_copy_update_failed");
    process.exitCode = 1;
});
