import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEBSITE_DIR = path.resolve(__dirname, "..");

const requiredJsonFiles = [
    {
        path: path.join(WEBSITE_DIR, "public", "production-snapshot", "places", "index.json"),
        label: "places index",
        validate(json) {
            return Boolean(json?.byPlaceId && Object.keys(json.byPlaceId).length > 0);
        },
    },
    {
        path: path.join(WEBSITE_DIR, "public", "production-snapshot", "place-photos", "manifest.json"),
        label: "place photo manifest",
        validate(json) {
            return Boolean(json && Object.keys(json).length > 0);
        },
    },
];

for (const file of requiredJsonFiles) {
    let text;
    try {
        text = await readFile(file.path, "utf8");
    } catch (error) {
        throw new Error(`Missing required production snapshot file (${file.label}): ${file.path}`, { cause: error });
    }

    let json;
    try {
        json = JSON.parse(text);
    } catch (error) {
        throw new Error(`Invalid JSON in production snapshot file (${file.label}): ${file.path}`, { cause: error });
    }

    if (!file.validate(json)) {
        throw new Error(`Production snapshot file is empty or incomplete (${file.label}): ${file.path}`);
    }
}

console.log("production snapshot OK");
