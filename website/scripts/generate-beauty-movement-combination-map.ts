import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { formatBeautyMovementCombinationMapMarkdown } from "../src/lib/beautyMovementOutcomes";

const output = resolve(process.cwd(), "docs/beauty-movement-combination-map.md");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, formatBeautyMovementCombinationMapMarkdown(), "utf8");
console.log(output);
