import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const WEBSITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function optionValue(args: readonly string[], flag: string): string | null {
    const positions = args.flatMap((value, index) => value === flag ? [index] : []);
    if (positions.length > 1) throw new Error(`beauty_movement_migrate_duplicate_${flag.slice(2)}`);
    const value = positions.length === 1 ? args[positions[0]! + 1] : null;
    if (positions.length === 1 && (!value || value.startsWith("--"))) {
        throw new Error(`beauty_movement_migrate_missing_${flag.slice(2)}`);
    }
    return value ?? null;
}

function parseArguments(args: readonly string[]) {
    const known = new Set(["--database", "--config", "--help"]);
    if (args.some((value) => value.startsWith("--") && !known.has(value))) {
        throw new Error("beauty_movement_migrate_unknown_argument");
    }
    const database = optionValue(args, "--database");
    if (!database || !/^[a-z0-9][a-z0-9-]{2,127}$/i.test(database)) {
        throw new Error("beauty_movement_migrate_invalid_database");
    }
    return { database, config: optionValue(args, "--config") ?? "wrangler.toml" };
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.includes("--help")) {
        console.log("Uso: npm run beauty-movement:migrate:local -- --database <d1-local> [--config <wrangler.toml>]");
        return;
    }
    const options = parseArguments(args);
    await execFileAsync(
        "npx",
        ["wrangler", "d1", "migrations", "apply", options.database, "--local", "--config", options.config],
        { cwd: WEBSITE_ROOT, maxBuffer: 2 * 1024 * 1024 },
    );

    console.log(JSON.stringify({ target: "local", database: options.database, runner: "wrangler_d1_migrations" }));
}

void main().catch(() => {
    // Do not echo Wrangler output because operator paths may be private.
    console.error("beauty_movement_migrate_local_failed");
    process.exitCode = 1;
});
