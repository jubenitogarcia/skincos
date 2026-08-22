import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    prepareBeautyMovementShortLinks,
    renderBeautyMovementShortLinkConflictSql,
    renderBeautyMovementShortLinkReadbackSql,
    renderBeautyMovementShortLinkSql,
    serializeBeautyMovementShortLinkCsv,
} from "../src/lib/beautyMovementShortLinks";
import type { BeautyMovementDeliveryRow } from "../src/lib/beautyMovementImport";

const WEBSITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(WEBSITE_ROOT, "..");

type ParsedArguments = {
    input: string;
    output: string;
    sql: string;
    conflicts: string;
    readback: string;
    attestation: string;
    campaign: string;
};

function valueAfter(args: string[], flag: string): string {
    const index = args.indexOf(flag);
    if (index < 0 || args.indexOf(flag, index + 1) >= 0) throw new Error(`beauty_movement_short_links_missing_${flag.slice(2)}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`beauty_movement_short_links_missing_${flag.slice(2)}`);
    return value;
}

function parseArguments(args: string[]): ParsedArguments {
    const known = new Set(["--input", "--out", "--sql", "--conflicts", "--readback", "--attestation", "--campaign"]);
    for (const arg of args) if (arg.startsWith("--") && !known.has(arg)) throw new Error("beauty_movement_short_links_unknown_argument");
    return {
        input: valueAfter(args, "--input"),
        output: valueAfter(args, "--out"),
        sql: valueAfter(args, "--sql"),
        conflicts: valueAfter(args, "--conflicts"),
        readback: valueAfter(args, "--readback"),
        attestation: valueAfter(args, "--attestation"),
        campaign: valueAfter(args, "--campaign"),
    };
}

function toWslPath(value: string): string {
    const windowsPath = /^([A-Za-z]):[\\/](.*)$/.exec(value);
    return windowsPath ? `/mnt/${windowsPath[1]!.toLowerCase()}/${windowsPath[2]!.replace(/\\/g, "/")}` : value;
}

function isWithin(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function privatePath(value: string): string {
    const converted = toWslPath(value);
    if (!path.isAbsolute(converted)) throw new Error("beauty_movement_short_links_path_must_be_absolute");
    const resolved = path.resolve(converted);
    if (isWithin(REPOSITORY_ROOT, resolved)) throw new Error("beauty_movement_short_links_path_must_be_private");
    const configuredRoot = process.env.BEAUTY_MOVEMENT_PRIVATE_RUNTIME_ROOT?.trim();
    if (configuredRoot) {
        const runnerTemp = process.env.RUNNER_TEMP?.trim();
        if (process.env.GITHUB_ACTIONS !== "true" || !runnerTemp || !path.isAbsolute(toWslPath(runnerTemp))) throw new Error("beauty_movement_short_links_private_runtime_invalid");
        const runnerRoot = path.resolve(toWslPath(runnerTemp));
        const root = path.resolve(toWslPath(configuredRoot));
        if (!isWithin(runnerRoot, root) || !isWithin(root, resolved)) throw new Error("beauty_movement_short_links_path_outside_private_runtime");
    }
    return resolved;
}

function parseCsv(input: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < input.length; index += 1) {
        const char = input[index]!;
        if (quoted) {
            if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
            else if (char === '"') quoted = false;
            else cell += char;
        } else if (char === '"' && cell.length === 0) quoted = true;
        else if (char === ",") { row.push(cell); cell = ""; }
        else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
        else cell += char;
    }
    if (quoted) throw new Error("beauty_movement_short_links_invalid_csv");
    if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
    return rows.filter((entry) => entry.some((value) => value.length > 0));
}

function readDeliveryRows(input: string): BeautyMovementDeliveryRow[] {
    const rows = parseCsv(input);
    const header = rows.shift()?.join(",");
    if (header !== "name,invite_ref,whatsapp,invite_url") throw new Error("beauty_movement_short_links_invalid_delivery_header");
    return rows.map((row) => {
        if (row.length !== 4 || row.some((value) => !value.trim())) throw new Error("beauty_movement_short_links_invalid_delivery_row");
        return { name: row[0]!, inviteRef: row[1]!, whatsapp: row[2]!, inviteUrl: row[3]! };
    });
}

async function writePrivate(filePath: string, content: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    const inputPath = privatePath(options.input);
    const outputPath = privatePath(options.output);
    const sqlPath = privatePath(options.sql);
    const conflictsPath = privatePath(options.conflicts);
    const readbackPath = privatePath(options.readback);
    const attestationPath = privatePath(options.attestation);
    const rows = readDeliveryRows(await readFile(inputPath, "utf8").catch(() => { throw new Error("beauty_movement_short_links_input_unavailable"); }));
    const plan = prepareBeautyMovementShortLinks({ rows, campaignId: options.campaign });
    await writePrivate(outputPath, serializeBeautyMovementShortLinkCsv(plan));
    await writePrivate(sqlPath, renderBeautyMovementShortLinkSql(plan));
    await writePrivate(conflictsPath, renderBeautyMovementShortLinkConflictSql(plan));
    await writePrivate(readbackPath, renderBeautyMovementShortLinkReadbackSql(plan));
    await writePrivate(attestationPath, `${JSON.stringify({ version: 1, campaignId: plan.campaignId, count: plan.links.length, mappingHash: plan.mappingHash, mappingHashes: plan.mappingHashes })}\n`);
    console.log(JSON.stringify({ mode: "beauty_movement_short_links", campaignId: plan.campaignId, count: plan.links.length, mappingHash: plan.mappingHash }));
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "beauty_movement_short_links_failed");
    process.exitCode = 1;
});
