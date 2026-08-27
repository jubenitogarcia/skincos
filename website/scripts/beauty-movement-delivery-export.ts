import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    prepareBeautyMovementImport,
    serializeBeautyMovementDeliveryCsv,
    validateBeautyMovementCampaignConfig,
} from "../src/lib/beautyMovementImport";
import type {
    BeautyMovementCanonicalProcedure,
    BeautyMovementRewardCatalogEntry,
} from "../src/lib/beautyMovementRewards";

const WEBSITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(WEBSITE_ROOT, "..");

type ParsedArguments = {
    input: string;
    campaign: string;
    campaignConfig: string;
    campaignEndsAt: string;
    output: string;
    attestation: string;
    rewardCatalog: string | null;
    procedureCatalog: string | null;
};

function valueAfter(args: string[], flag: string): string {
    const index = args.indexOf(flag);
    if (index < 0) throw new Error(`beauty_movement_missing_${flag.slice(2)}`);
    if (args.indexOf(flag, index + 1) >= 0) throw new Error(`beauty_movement_duplicate_${flag.slice(2)}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`beauty_movement_missing_${flag.slice(2)}`);
    return value;
}

function parseArguments(args: string[]): ParsedArguments {
    const known = new Set([
        "--input",
        "--campaign",
        "--campaign-config",
        "--campaign-ends-at",
        "--out",
        "--attestation",
        "--reward-catalog",
        "--procedure-catalog",
    ]);
    for (const arg of args) {
        if (arg.startsWith("--") && !known.has(arg)) throw new Error("beauty_movement_unknown_argument");
    }
    return {
        input: valueAfter(args, "--input"),
        campaign: valueAfter(args, "--campaign"),
        campaignConfig: valueAfter(args, "--campaign-config"),
        campaignEndsAt: valueAfter(args, "--campaign-ends-at"),
        output: valueAfter(args, "--out"),
        attestation: valueAfter(args, "--attestation"),
        rewardCatalog: args.includes("--reward-catalog") ? valueAfter(args, "--reward-catalog") : null,
        procedureCatalog: args.includes("--procedure-catalog") ? valueAfter(args, "--procedure-catalog") : null,
    };
}

function toWslPath(value: string): string {
    const windowsPath = /^([A-Za-z]):[\\/](.*)$/.exec(value);
    return windowsPath
        ? `/mnt/${windowsPath[1]!.toLowerCase()}/${windowsPath[2]!.replace(/\\/g, "/")}`
        : value;
}

function isWithin(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function privatePath(value: string, purpose: "input" | "output"): string {
    const converted = toWslPath(value);
    if (!path.isAbsolute(converted)) throw new Error(`beauty_movement_${purpose}_must_be_absolute`);
    const resolved = path.resolve(converted);
    if (isWithin(REPOSITORY_ROOT, resolved)) throw new Error(`beauty_movement_${purpose}_must_be_private`);

    const configuredRoot = process.env.BEAUTY_MOVEMENT_PRIVATE_RUNTIME_ROOT?.trim();
    if (configuredRoot) {
        const runnerTemp = process.env.RUNNER_TEMP?.trim();
        if (process.env.GITHUB_ACTIONS !== "true" || !runnerTemp || !path.isAbsolute(toWslPath(runnerTemp))) {
            throw new Error("beauty_movement_private_runtime_root_invalid");
        }
        const runnerRoot = path.resolve(toWslPath(runnerTemp));
        const root = path.resolve(toWslPath(configuredRoot));
        if (!isWithin(runnerRoot, root)) throw new Error("beauty_movement_private_runtime_root_invalid");
        if (!isWithin(root, resolved)) throw new Error(`beauty_movement_${purpose}_outside_private_runtime`);
    }
    return resolved;
}

function parseCampaignEndsAt(value: string): number {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
        throw new Error("beauty_movement_invalid_campaign_ends_at");
    }
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error("beauty_movement_invalid_campaign_ends_at");
    return parsed;
}

function sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

async function readJson(filePath: string): Promise<unknown> {
    try {
        return JSON.parse(await readFile(filePath, "utf8")) as unknown;
    } catch {
        throw new Error("beauty_movement_campaign_config_unavailable");
    }
}

async function readOptionalJson<T>(filePath: string | null, unavailableCode: string): Promise<T[] | undefined> {
    if (!filePath) return undefined;
    const value = await readJson(filePath);
    if (!Array.isArray(value)) throw new Error(unavailableCode);
    return value as T[];
}

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    const inputPath = privatePath(options.input, "input");
    const campaignConfigPath = privatePath(options.campaignConfig, "input");
    const outputPath = privatePath(options.output, "output");
    const attestationPath = privatePath(options.attestation, "output");
    if ((options.rewardCatalog && !options.procedureCatalog) || (!options.rewardCatalog && options.procedureCatalog)) {
        throw new Error("beauty_movement_reward_catalog_pair_required");
    }
    const rewardCatalogPath = options.rewardCatalog ? privatePath(options.rewardCatalog, "input") : null;
    const procedureCatalogPath = options.procedureCatalog ? privatePath(options.procedureCatalog, "input") : null;
    const csv = await readFile(inputPath, "utf8").catch(() => {
        throw new Error("beauty_movement_input_unavailable");
    });
    const campaignConfig = validateBeautyMovementCampaignConfig(await readJson(campaignConfigPath));
    const rewardCatalog = await readOptionalJson<BeautyMovementRewardCatalogEntry>(rewardCatalogPath, "beauty_movement_reward_catalog_unavailable");
    const procedureCatalog = await readOptionalJson<BeautyMovementCanonicalProcedure>(procedureCatalogPath, "beauty_movement_procedure_catalog_unavailable");
    const tokenHmacKey = (process.env.BEAUTY_MOVEMENT_TOKEN_HMAC_KEY ?? "").trim();
    const piiKey = (process.env.BEAUTY_MOVEMENT_PII_KEY ?? "").trim();
    if (!tokenHmacKey || !piiKey) throw new Error("beauty_movement_export_keys_unavailable");

    const campaignEndsAtMs = parseCampaignEndsAt(options.campaignEndsAt);
    const plan = await prepareBeautyMovementImport({
        csv,
        campaignId: options.campaign,
        campaignConfig,
        campaignEndsAtMs,
        rewardCatalog,
        procedureCatalog,
        tokenHmacKey,
        piiKey,
    });
    if (plan.deliveryRows.length !== plan.invites.length || plan.deliveryRows.length < 1) {
        throw new Error("beauty_movement_delivery_row_count_invalid");
    }

    const deliveryCsv = serializeBeautyMovementDeliveryCsv(plan.deliveryRows);
    await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    try {
        // wx prevents a rerun from silently replacing a previously handed-off
        // list. The file contains personal data and invite tokens, so keep it
        // private even on a runner with a shared filesystem.
        await writeFile(outputPath, deliveryCsv, { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch {
        throw new Error("beauty_movement_delivery_output_unavailable");
    }
    try {
        // The attestation is runner-private and is consumed only by the
        // read-only D1 comparison. It contains hashes, never raw token values.
        await writeFile(attestationPath, `${JSON.stringify({
            version: 1,
            campaignId: plan.campaignId,
            inputSha256: plan.inputSha256,
            inviteTokenHmacs: plan.invites.map((invite) => invite.inviteTokenHmac).sort(),
            inviteTokenHmacByRef: Object.fromEntries(plan.invites
                .map((invite) => [invite.inviteRef, invite.inviteTokenHmac])
                .sort(([left], [right]) => left.localeCompare(right))),
        })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch {
        throw new Error("beauty_movement_delivery_attestation_unavailable");
    }

    // This is the only stdout contract. It is intentionally aggregate-only:
    // never print names, phone numbers, invite URLs, or token material.
    console.log(JSON.stringify({
        mode: "delivery_export",
        campaignId: plan.campaignId,
        sourceRows: plan.sourceRowCount,
        acceptedRows: plan.invites.length,
        inputSha256: plan.inputSha256,
        outputSha256: sha256(deliveryCsv),
        outputBytes: Buffer.byteLength(deliveryCsv, "utf8"),
    }));
}

void main().catch((error) => {
    // Error codes are deliberately generic and contain no input values.
    console.error(error instanceof Error ? error.message : "beauty_movement_delivery_export_failed");
    process.exitCode = 1;
});
