import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
    decryptBeautyMovementPersonalData,
    type BeautyMovementEncryptedPersonalData,
} from "../src/lib/beautyMovementSecurity";

const execFileAsync = promisify(execFile);
const WEBSITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(WEBSITE_ROOT, "..");
const PRIVATE_RUNTIME_ROOT = path.resolve("/mnt/c/CodexRuntime/operator/admin/skincos/beauty-movement");

type Args = {
    database: string;
    campaign: string;
    outputDirectory: string;
    config: string;
    target: "local" | "remote";
};

type ReportRow = {
    contact_mask: string;
    personal_data_version: number;
    personal_data_ciphertext: string;
    personal_data_iv: string;
    invite_status: string;
    benefit_status: string;
    reward_id: string | null;
    outcome_key: string | null;
    outcome_snapshot_json: string | null;
    reward_type: string | null;
    procedure_name: string | null;
    discount_kind: string | null;
    discount_value: number | null;
    discount_currency: string | null;
    display_text: string | null;
    validity: string | null;
    rules: string | null;
    terms_version: string | null;
    velocity_benefit: string;
    confirmed_at_ms: number | null;
    expires_at_ms: number;
    campaign_status: string;
    campaign_ends_at_ms: number;
};

type PersonalData = { name?: string; whatsapp?: string; email?: string | null };

function valueAfter(argv: string[], flag: string): string | null {
    const positions = argv.flatMap((value, index) => value === flag ? [index] : []);
    if (positions.length !== 1) return null;
    const value = argv[positions[0]! + 1];
    return value && !value.startsWith("--") ? value : null;
}

function isWithin(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function privateOutputPath(value: string): string {
    const windowsPath = /^([A-Za-z]):[\\/](.*)$/.exec(value);
    const visible = windowsPath
        ? `/mnt/${windowsPath[1]!.toLowerCase()}/${windowsPath[2]!.replace(/\\/g, "/")}`
        : value;
    if (!path.isAbsolute(visible)) throw new Error("beauty_movement_report_output_must_be_absolute");
    const resolved = path.resolve(visible);
    if (isWithin(REPOSITORY_ROOT, resolved) || !isWithin(PRIVATE_RUNTIME_ROOT, resolved)) {
        throw new Error("beauty_movement_report_output_must_be_private");
    }
    return resolved;
}

function parseArgs(argv: string[]): Args {
    const known = new Set(["--local", "--remote", "--database", "--campaign", "--confirm-campaign", "--out-dir", "--config", "--help"]);
    if (argv.some((value) => value.startsWith("--") && !known.has(value))) throw new Error("beauty_movement_report_unknown_argument");
    const remote = argv.includes("--remote");
    const local = argv.includes("--local");
    if (remote === local) throw new Error("beauty_movement_report_target_required");
    const database = valueAfter(argv, "--database");
    const campaign = valueAfter(argv, "--campaign");
    const confirmCampaign = valueAfter(argv, "--confirm-campaign");
    const outputDirectory = valueAfter(argv, "--out-dir");
    if (!database || !/^[a-z0-9][a-z0-9-]{2,127}$/i.test(database)) throw new Error("beauty_movement_report_invalid_database");
    if (!campaign || !/^[a-z0-9][a-z0-9_-]{2,79}$/i.test(campaign) || confirmCampaign !== campaign) {
        throw new Error("beauty_movement_report_campaign_confirmation_required");
    }
    if (!outputDirectory) throw new Error("beauty_movement_report_private_output_required");
    return {
        database,
        campaign,
        outputDirectory: privateOutputPath(outputDirectory),
        config: valueAfter(argv, "--config") ?? "wrangler.toml",
        target: remote ? "remote" : "local",
    };
}

function printHelp(): void {
    console.log([
        "Uso: npm run beauty-movement:report -- (--local | --remote) --database <d1> --campaign <id>",
        "  --confirm-campaign <id> --out-dir <diretorio-privado> [--config <wrangler.toml>]",
        "O relatório escreve contatos operacionais em CSV privado; use --local somente com dados sintéticos.",
    ].join("\n"));
}

function csvCell(value: string | number | null | undefined): string {
    const text = value === null || value === undefined ? "" : String(value);
    const formulaSafe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${formulaSafe.replace(/"/g, '""')}"`;
}

async function queryRows(args: Args): Promise<ReportRow[]> {
    const sql = [
        "SELECT i.contact_mask, i.personal_data_version, i.personal_data_ciphertext, i.personal_data_iv,",
        "i.invite_status, i.benefit_status, i.reward_id, i.outcome_key, i.outcome_snapshot_json, i.velocity_benefit, i.confirmed_at_ms, i.expires_at_ms,",
        "r.reward_type, r.procedure_name, r.discount_kind, r.discount_value, r.discount_currency,",
        "r.display_text, r.validity, r.rules, r.terms_version,",
        "c.status AS campaign_status, c.ends_at_ms AS campaign_ends_at_ms",
        "FROM bm_invites i INNER JOIN bm_campaigns c ON c.id = i.campaign_id",
        "LEFT JOIN bm_rewards r ON r.campaign_id = i.campaign_id AND r.reward_id = i.reward_id",
        `WHERE i.campaign_id = '${args.campaign.replace(/'/g, "''")}' AND i.confirmed_at_ms IS NOT NULL`,
        "ORDER BY i.confirmed_at_ms DESC, i.updated_at_ms DESC",
    ].join(" ");
    try {
        const { stdout } = await execFileAsync(
            "npx",
            ["wrangler", "d1", "execute", args.database, `--${args.target}`, "--json", "--config", args.config, "--command", sql],
            { cwd: WEBSITE_ROOT, maxBuffer: 4 * 1024 * 1024 },
        );
        const parsed = JSON.parse(stdout) as Array<{ results?: ReportRow[] }> | { results?: ReportRow[] };
        const first = Array.isArray(parsed) ? parsed[0] : parsed;
        return Array.isArray(first?.results) ? first.results : [];
    } catch {
        throw new Error("beauty_movement_report_query_failed");
    }
}

async function main() {
    const argv = process.argv.slice(2);
    if (argv.includes("--help")) {
        printHelp();
        return;
    }
    const args = parseArgs(argv);
    const piiKey = (process.env.BEAUTY_MOVEMENT_PII_KEY ?? "").trim();
    if (!piiKey) throw new Error("beauty_movement_report_pii_key_unavailable");
    const rows = await queryRows(args);

    const output = [
        "name,whatsapp,email,contact_mask,confirmed_at_ms,invite_status,outcome_key,outcome_snapshot_json,reward_id,reward_type,procedure_name,discount_kind,discount_value,discount_currency,display_text,validity,rules,terms_version,velocity_benefit,expires_at_ms,campaign_status,campaign_ends_at_ms",
    ];
    for (const row of rows) {
        const personal = await decryptBeautyMovementPersonalData<PersonalData>({
            version: row.personal_data_version as 1,
            ciphertext: row.personal_data_ciphertext,
            iv: row.personal_data_iv,
        } satisfies BeautyMovementEncryptedPersonalData, piiKey);
        output.push([
            personal.name ?? "",
            personal.whatsapp ?? "",
            personal.email ?? "",
            row.contact_mask,
            row.confirmed_at_ms,
            row.invite_status,
            row.outcome_key,
            row.outcome_snapshot_json,
            row.reward_id,
            row.reward_type,
            row.procedure_name,
            row.discount_kind,
            row.discount_value,
            row.discount_currency,
            row.display_text,
            row.validity,
            row.rules,
            row.terms_version,
            row.velocity_benefit,
            row.expires_at_ms,
            row.campaign_status,
            row.campaign_ends_at_ms,
        ].map(csvCell).join(","));
    }

    await mkdir(args.outputDirectory, { recursive: true, mode: 0o700 });
    const fileName = `beauty-movement-${args.campaign}-report-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    const outputPath = path.join(args.outputDirectory, fileName);
    await writeFile(outputPath, `${output.join("\n")}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ target: args.target, campaignId: args.campaign, rows: rows.length, confirmed: rows.length }));
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "beauty_movement_report_failed");
    process.exitCode = 1;
});
