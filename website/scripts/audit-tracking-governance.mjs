import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const WEBSITE_SRC = path.join(ROOT, "src");
const SNAPSHOT_DIR = path.join(ROOT, "public", "production-snapshot");

const ALLOWED_WHATSAPP_FILES = new Set([
    path.join(WEBSITE_SRC, "middleware.ts"),
    path.join(WEBSITE_SRC, "app", "api", "whatsapp", "redirect", "route.ts"),
    path.join(WEBSITE_SRC, "lib", "whatsappTracking.ts"),
    path.join(WEBSITE_SRC, "lib", "whatsapp.ts"),
    path.join(WEBSITE_SRC, "lib", "bookingConfirmationView.ts"),
    path.join(WEBSITE_SRC, "lib", "faleconoscoRedirect.ts"),
    path.join(WEBSITE_SRC, "components", "BookingHeroExperience.tsx"),
]);

const ALLOWED_CANONICAL_REFERENCE_FILES = new Set([
    path.join(WEBSITE_SRC, "lib", "site-config.ts"),
]);

const ALLOWED_CROSS_DOMAIN_HOSTS = new Map([
    ["espacofacial.com.br", "franquia oficial"],
    ["app.espacofacial.com.br", "app oficial da franquia"],
    ["crm.skincos.com.br", "crm interno"],
    ["orb.skincos.com.br", "orquestração/n8n"],
    ["wa.skincos.com.br", "stack técnica de WhatsApp"],
]);

const violations = [];
const notes = [];

function walk(dir) {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walk(absolute));
        else files.push(absolute);
    }
    return files;
}

function readFile(file) {
    return fs.readFileSync(file, "utf8");
}

function relative(file) {
    return path.relative(ROOT, file);
}

function addViolation(file, message) {
    violations.push(`${relative(file)}: ${message}`);
}

function addNote(file, message) {
    notes.push(`${relative(file)}: ${message}`);
}

function auditWhatsappLinks() {
    const files = walk(WEBSITE_SRC).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
    const pattern = /https:\/\/(?:wa\.me|api\.whatsapp\.com)/gi;

    for (const file of files) {
        const content = readFile(file);
        if (!pattern.test(content)) continue;
        pattern.lastIndex = 0;

        if (!ALLOWED_WHATSAPP_FILES.has(file)) {
            addViolation(file, "contém URL direta de WhatsApp fora da allowlist first-party")
        } else {
            addNote(file, "usa URL direta de WhatsApp em ponto permitido pela trilha first-party")
        }
    }
}

function auditCanonicalWww() {
    const files = [...walk(WEBSITE_SRC), ...walk(SNAPSHOT_DIR)];
    const pattern = /www\.espacofacial\.com/gi;

    for (const file of files) {
        if (!/\.(ts|tsx|js|mjs|json|html|xml|txt)$/i.test(file)) continue;
        const content = readFile(file);
        if (pattern.test(content)) {
            if (ALLOWED_CANONICAL_REFERENCE_FILES.has(file)) {
                addNote(file, "referência a www.espacofacial.com permitida para regra de canonicalização")
            } else {
                addViolation(file, "aponta para www.espacofacial.com em conteúdo público/canônico")
            }
        }
        pattern.lastIndex = 0;
    }
}

function auditCrossDomainReferences() {
    const files = [...walk(WEBSITE_SRC), ...walk(SNAPSHOT_DIR)];
    const pattern = /\b(?:espacofacial\.com\.br|app\.espacofacial\.com\.br|crm\.skincos\.com\.br|orb\.skincos\.com\.br|wa\.skincos\.com\.br)\b/gi;

    for (const file of files) {
        if (!/\.(ts|tsx|js|mjs|json|html|xml|txt)$/i.test(file)) continue;
        const content = readFile(file);
        const matches = new Set(content.match(pattern) || []);
        if (!matches.size) continue;

        for (const host of matches) {
            if (!ALLOWED_CROSS_DOMAIN_HOSTS.has(host)) {
                addViolation(file, `referência cross-domain não prevista: ${host}`)
            } else {
                addNote(file, `referência cross-domain documentada: ${host} (${ALLOWED_CROSS_DOMAIN_HOSTS.get(host)})`)
            }
        }
    }
}

function main() {
    auditWhatsappLinks();
    auditCanonicalWww();
    auditCrossDomainReferences();

    if (notes.length > 0) {
        console.log("Notas de auditoria:")
        for (const note of notes) console.log(`- ${note}`)
        console.log("");
    }

    if (violations.length > 0) {
        console.error("Falhas de governança encontradas:")
        for (const violation of violations) console.error(`- ${violation}`)
        process.exit(1)
    }

    console.log("OK: governança de tracking/domínio sem violações.")
}

main();
