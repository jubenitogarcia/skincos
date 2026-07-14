import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEBSITE_DIR = path.resolve(__dirname, "..");
const ROOT_DIR = path.resolve(WEBSITE_DIR, "..");
const DEV_SNAPSHOT_DIR = path.join(WEBSITE_DIR, "dev-data", "production-snapshot");
const PUBLIC_SNAPSHOT_DIR = path.join(WEBSITE_DIR, "public", "production-snapshot");
const BASE_URL = (process.env.ONLINE_SITE_BASE_URL ?? "https://espacofacial.com").replace(/\/+$/, "");
const TIME_ZONE = "America/Sao_Paulo";
const AGENDA_PAGE_SIZE = 500;
const DEFAULT_AGENDA_DAYS = 31;
const UNITS = ["barrashoppingsul", "novo-hamburgo"];
const PLACE_TARGETS = [
    {
        slug: "barrashoppingsul",
        placeId: "ChIJZdhuMFx5GZURql2Gm6xa8LU",
        query: "Espaço Facial, BarraShoppingSul, Av. Diário de Notícias, 300, RS, Brasil",
    },
    {
        slug: "novo-hamburgo",
        placeId: "ChIJhaCsZ9RDGZURe9I0bpIb-CM",
        query: "Espaço Facial, Novo Hamburgo, Av. Doutor Maurício Cardoso, 1126, RS, Brasil",
    },
];

function normalizeUnitKey(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
}

function unitLabelFromSlug(slug) {
    const key = normalizeUnitKey(slug);
    if (key === "barrashoppingsul") return "BarraShoppingSul";
    if (key === "novohamburgo") return "Novo Hamburgo";
    return slug;
}

function slugFromMember(member) {
    const handle = String(member?.instagramHandle ?? "").trim();
    if (handle) return handle.toLowerCase().replace(/^@/, "");
    return String(member?.name ?? "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .slice(0, 50);
}

function normalizeOneLine(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
    return normalizeOneLine(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120);
}

function computeAppointmentId({ unitSlug, dateKey, timeKey, client, tipo, profissional }) {
    return [
        normalizeKey(unitSlug),
        normalizeKey(dateKey),
        normalizeKey(timeKey),
        normalizeKey(client),
        normalizeKey(tipo),
        normalizeKey(profissional),
    ].join("|");
}

function sqlString(value) {
    if (value === null || value === undefined || value === "") return "NULL";
    return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
    if (value === null || value === undefined || value === "") return "NULL";
    const num = Number(value);
    return Number.isFinite(num) ? String(Math.trunc(num)) : "NULL";
}

function formatDateKeyInTimeZone(date) {
    const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    return fmt.format(date);
}

function addDays(dateKey, days) {
    const [y, m, d] = dateKey.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
    return formatDateKeyInTimeZone(date);
}

function resolveRange() {
    const today = formatDateKeyInTimeZone(new Date());
    const dateFrom = (process.env.AGENDA_FROM ?? today).trim();
    const daysRaw = Number(process.env.AGENDA_DAYS ?? DEFAULT_AGENDA_DAYS);
    const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(DEFAULT_AGENDA_DAYS, Math.trunc(daysRaw))) : DEFAULT_AGENDA_DAYS;
    const dateTo = (process.env.AGENDA_TO ?? addDays(dateFrom, days - 1)).trim();
    return { dateFrom, dateTo, days };
}

async function readAgendaToken() {
    const direct = String(process.env.SMOKE_AGENDA_TOKEN ?? process.env.AGENDA_SYNC_TOKEN ?? "").trim();
    if (direct) return direct;

    for (const candidate of [path.join(WEBSITE_DIR, ".env.local"), path.join(WEBSITE_DIR, ".dev.vars")]) {
        try {
            const text = await readFile(candidate, "utf8");
            const match = text.match(/(?:SMOKE_AGENDA_TOKEN|AGENDA_SYNC_TOKEN)\s*=\s*['"]?([^'"\n]+)['"]?/);
            if (match?.[1]?.trim()) return match[1].trim();
        } catch {
            // ignore
        }
    }
    return "";
}

async function fetchJson(url, init = {}) {
    const response = await fetch(url, init);
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        throw new Error(`Resposta inválida de ${url}: ${text.slice(0, 280)}`);
    }
    if (!response.ok) {
        throw new Error(`Falha em ${url}: HTTP ${response.status} ${JSON.stringify(json).slice(0, 240)}`);
    }
    return json;
}

async function fetchBinary(url, init = {}) {
    const response = await fetch(url, init);
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Falha binária em ${url}: HTTP ${response.status} ${text.slice(0, 160)}`);
    }

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, contentType };
}

async function fetchAllAgenda({ baseUrl, token, unitSlug, dateFrom, dateTo }) {
    const appointments = [];
    let page = 1;

    while (true) {
        const url = new URL(`${baseUrl}/api/agenda`);
        url.searchParams.set("unit_slug", unitSlug);
        url.searchParams.set("date_from", dateFrom);
        url.searchParams.set("date_to", dateTo);
        url.searchParams.set("page_size", String(AGENDA_PAGE_SIZE));
        url.searchParams.set("page", String(page));
        url.searchParams.set("include_pii", "true");

        const json = await fetchJson(url.toString(), {
            headers: { "x-agenda-sync-token": token },
        });

        if (json?.ok !== true || !Array.isArray(json?.appointments)) {
            throw new Error(`Payload inesperado em /api/agenda para ${unitSlug}, página ${page}`);
        }

        appointments.push(...json.appointments);
        if (!json.has_more) break;
        page += 1;
    }

    return appointments;
}

async function fetchSlotsProbe({ baseUrl, unitSlug, doctorSlug, date }) {
    const url = new URL(`${baseUrl}/api/booking/slots`);
    url.searchParams.set("unit", unitSlug);
    url.searchParams.set("doctor", doctorSlug);
    url.searchParams.set("service", "botox");
    url.searchParams.set("durationMinutes", "30");
    url.searchParams.set("date", date);
    return fetchJson(url.toString());
}

function buildAgendaSql(appointments) {
    const lines = [
        "PRAGMA foreign_keys = OFF;",
        "CREATE TABLE IF NOT EXISTS agenda_appointments (",
        "  appointment_id TEXT PRIMARY KEY,",
        "  unit_slug TEXT NOT NULL,",
        "  date_key TEXT NOT NULL,",
        "  time_key TEXT NOT NULL,",
        "  client TEXT NOT NULL,",
        "  tipo TEXT NOT NULL,",
        "  profissional TEXT NOT NULL,",
        "  telefone TEXT,",
        "  cpf TEXT,",
        "  source TEXT,",
        "  service TEXT,",
        "  notes TEXT,",
        "  status TEXT,",
        "  duration_min INTEGER,",
        "  created_at_ms INTEGER NOT NULL,",
        "  updated_at_ms INTEGER NOT NULL,",
        "  last_seen_at_ms INTEGER NOT NULL,",
        "  removed_at_ms INTEGER",
        ");",
        "CREATE INDEX IF NOT EXISTS idx_agenda_unit_date_time ON agenda_appointments(unit_slug, date_key, time_key);",
        "CREATE TABLE IF NOT EXISTS agenda_changes (",
        "  id TEXT PRIMARY KEY,",
        "  unit_slug TEXT NOT NULL,",
        "  change_type TEXT NOT NULL,",
        "  appointment_id TEXT,",
        "  date_key TEXT,",
        "  time_key TEXT,",
        "  client TEXT,",
        "  tipo TEXT,",
        "  profissional TEXT,",
        "  created_at_ms INTEGER NOT NULL",
        ");",
        "CREATE INDEX IF NOT EXISTS idx_agenda_changes_unit_time ON agenda_changes(unit_slug, created_at_ms);",
        "DELETE FROM agenda_changes;",
        "DELETE FROM agenda_appointments;",
    ];

    const now = Date.now();
    for (const item of appointments) {
        const unitSlug = normalizeOneLine(item.unit_slug);
        const dateKey = normalizeOneLine(item.date_key);
        const timeKey = normalizeOneLine(item.time_key);
        const client = normalizeOneLine(item.client) || "[snapshot]";
        const tipo = normalizeOneLine(item.tipo) || "[desconhecido]";
        const profissional = normalizeOneLine(item.profissional) || "[desconhecido]";
        const appointmentId = computeAppointmentId({
            unitSlug,
            dateKey,
            timeKey,
            client,
            tipo,
            profissional,
        });

        lines.push(
            `INSERT INTO agenda_appointments (` +
                `appointment_id, unit_slug, date_key, time_key, client, tipo, profissional, telefone, cpf, source, service, notes, status, duration_min, created_at_ms, updated_at_ms, last_seen_at_ms, removed_at_ms` +
            `) VALUES (` +
                [
                    sqlString(appointmentId),
                    sqlString(unitSlug),
                    sqlString(dateKey),
                    sqlString(timeKey),
                    sqlString(client),
                    sqlString(tipo),
                    sqlString(profissional),
                    sqlString(normalizeOneLine(item.telefone)),
                    sqlString(normalizeOneLine(item.cpf)),
                    sqlString("online_snapshot"),
                    sqlString(normalizeOneLine(item.service)),
                    sqlString(normalizeOneLine(item.notes)),
                    sqlString(normalizeOneLine(item.status)),
                    sqlNumber(item.duration_min ?? 30),
                    String(now),
                    String(now),
                    String(now),
                    "NULL",
                ].join(", ") +
            `);`
        );
    }

    return lines.join("\n");
}

function buildEscalaSql({ members, scheduleEntries, closedDays }) {
    const lines = [
        "PRAGMA foreign_keys = OFF;",
        "CREATE TABLE IF NOT EXISTS professionals (name TEXT NOT NULL, status TEXT, role TEXT, nickname TEXT, instagram TEXT, units_json TEXT);",
        "CREATE TABLE IF NOT EXISTS schedule_entries (unit TEXT NOT NULL, date TEXT NOT NULL, professional_name TEXT NOT NULL);",
        "CREATE TABLE IF NOT EXISTS closed_days (unit TEXT NOT NULL, date TEXT NOT NULL);",
        "CREATE TABLE IF NOT EXISTS holidays (unit TEXT NOT NULL, date TEXT NOT NULL);",
        "DELETE FROM professionals;",
        "DELETE FROM schedule_entries;",
        "DELETE FROM closed_days;",
        "DELETE FROM holidays;",
    ];

    for (const member of members) {
        lines.push(
            `INSERT INTO professionals (name, status, role, nickname, instagram, units_json) VALUES (` +
                [
                    sqlString(normalizeOneLine(member.name)),
                    sqlString("Ativo"),
                    sqlString(Array.isArray(member.roles) && member.roles.length ? member.roles.join(", ") : normalizeOneLine(member.role)),
                    sqlString(normalizeOneLine(member.nickname)),
                    sqlString(normalizeOneLine(member.instagramHandle)),
                    sqlString(JSON.stringify(Array.isArray(member.units) ? member.units : [])),
                ].join(", ") +
            `);`
        );
    }

    for (const entry of scheduleEntries) {
        lines.push(
            `INSERT INTO schedule_entries (unit, date, professional_name) VALUES (${sqlString(entry.unit)}, ${sqlString(entry.date)}, ${sqlString(entry.professional_name)});`
        );
    }

    for (const entry of closedDays) {
        lines.push(
            `INSERT INTO closed_days (unit, date) VALUES (${sqlString(entry.unit)}, ${sqlString(entry.date)});`
        );
    }

    return lines.join("\n");
}

function runWranglerD1Execute(databaseName, sqlFile) {
    execFileSync(
        "npx",
        ["wrangler", "d1", "execute", databaseName, "--local", "--file", sqlFile],
        { cwd: WEBSITE_DIR, stdio: "inherit" },
    );
}

function extensionFromContentType(contentType) {
    const normalized = String(contentType ?? "").toLowerCase();
    if (normalized.includes("image/png")) return "png";
    if (normalized.includes("image/webp")) return "webp";
    if (normalized.includes("image/gif")) return "gif";
    if (normalized.includes("image/avif")) return "avif";
    return "jpg";
}

function shortHash(value) {
    return createHash("sha1").update(String(value ?? "")).digest("hex").slice(0, 12);
}

async function writeJson(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(value, null, 2));
}

async function buildPlacesSnapshot() {
    const placesDir = path.join(PUBLIC_SNAPSHOT_DIR, "places");
    const photosDir = path.join(PUBLIC_SNAPSHOT_DIR, "place-photos");
    const placeIndex = { byPlaceId: {}, byQuery: {} };
    const photoManifest = {};
    const summary = [];

    for (const target of PLACE_TARGETS) {
        console.log(`Baixando snapshot público de Places para ${target.slug}...`);
        const url = new URL(`${BASE_URL}/api/places/details`);
        url.searchParams.set("placeId", target.placeId);
        const payload = await fetchJson(url.toString());

        if (payload?.available !== true) {
            throw new Error(`Places indisponível para ${target.slug}: ${JSON.stringify(payload).slice(0, 240)}`);
        }

        const relativeJsonPath = `places/${target.slug}.json`;
        await writeJson(path.join(PUBLIC_SNAPSHOT_DIR, relativeJsonPath), payload);

        placeIndex.byPlaceId[target.placeId] = relativeJsonPath;
        placeIndex.byQuery[normalizeKey(target.query)] = relativeJsonPath;
        if (payload?.placeId) placeIndex.byPlaceId[String(payload.placeId)] = relativeJsonPath;

        const photos = Array.isArray(payload.photos) ? payload.photos : [];
        summary.push({
            slug: target.slug,
            placeId: payload.placeId ?? target.placeId,
            photos: photos.length,
            reviews: Array.isArray(payload.reviews) ? payload.reviews.length : 0,
        });

        for (const photo of photos) {
            const photoReference = normalizeOneLine(photo.photoReference);
            if (!photoReference || photoManifest[photoReference]) continue;

            const photoUrl = new URL(`${BASE_URL}/api/places/photo`);
            photoUrl.searchParams.set("ref", photoReference);
            photoUrl.searchParams.set("maxwidth", "1600");

            const { buffer, contentType } = await fetchBinary(photoUrl.toString());
            const ext = extensionFromContentType(contentType);
            const relativePhotoPath = `place-photos/${target.slug}-${shortHash(photoReference)}.${ext}`;

            await mkdir(photosDir, { recursive: true });
            await writeFile(path.join(PUBLIC_SNAPSHOT_DIR, relativePhotoPath), buffer);
            photoManifest[photoReference] = {
                path: relativePhotoPath,
                contentType,
            };
        }
    }

    await mkdir(placesDir, { recursive: true });
    await mkdir(photosDir, { recursive: true });
    await writeJson(path.join(placesDir, "index.json"), placeIndex);
    await writeJson(path.join(photosDir, "manifest.json"), photoManifest);

    return {
        summary,
        uniquePhotoCount: Object.keys(photoManifest).length,
    };
}

async function main() {
    const { dateFrom, dateTo, days } = resolveRange();
    const agendaToken = await readAgendaToken();

    if (!agendaToken) {
        throw new Error("AGENDA_SYNC_TOKEN não encontrado. Configure em .env.local, .dev.vars ou variável de ambiente.");
    }

    console.log("");
    console.log("Sincronizando snapshot online da Espaço Facial");
    console.log(`Base: ${BASE_URL}`);
    console.log(`Janela de agenda: ${dateFrom} -> ${dateTo} (${days} dias)`);
    console.log("");

    await rm(DEV_SNAPSHOT_DIR, { recursive: true, force: true });
    await rm(PUBLIC_SNAPSHOT_DIR, { recursive: true, force: true });
    await mkdir(DEV_SNAPSHOT_DIR, { recursive: true });
    await mkdir(PUBLIC_SNAPSHOT_DIR, { recursive: true });

    const team = await fetchJson(`${BASE_URL}/api/equipe`);
    const services = await fetchJson(`${BASE_URL}/api/booking/services`);

    if (team?.ok !== true || !Array.isArray(team?.members)) {
        throw new Error("Payload inesperado em /api/equipe");
    }
    if (services?.ok !== true || !Array.isArray(services?.services)) {
        throw new Error("Payload inesperado em /api/booking/services");
    }

    const agendaByUnit = {};
    for (const unit of UNITS) {
        console.log(`Baixando agenda online de ${unit}...`);
        agendaByUnit[unit] = await fetchAllAgenda({
            baseUrl: BASE_URL,
            token: agendaToken,
            unitSlug: unit,
            dateFrom,
            dateTo,
        });
    }

    const membersByUnit = new Map();
    for (const unit of UNITS) {
        const labelKey = normalizeUnitKey(unitLabelFromSlug(unit));
        membersByUnit.set(
            unit,
            team.members.filter((member) =>
                Array.isArray(member.units) &&
                member.units.some((value) => normalizeUnitKey(value) === labelKey),
            ),
        );
    }

    const scheduleEntriesMap = new Map();
    for (const [unit, appointments] of Object.entries(agendaByUnit)) {
        for (const item of appointments) {
            const professionalName = normalizeOneLine(item.profissional);
            const dateKey = normalizeOneLine(item.date_key);
            if (!professionalName || !dateKey) continue;
            scheduleEntriesMap.set(`${unit}|${dateKey}|${professionalName}`, {
                unit: unitLabelFromSlug(unit),
                date: dateKey,
                professional_name: professionalName,
            });
        }
    }

    const closedDaysMap = new Map();
    const probeSummary = [];
    for (const unit of UNITS) {
        const unitMembers = membersByUnit.get(unit) ?? [];
        for (let offset = 0; offset < days; offset += 1) {
            const date = addDays(dateFrom, offset);
            const anyProbe = await fetchSlotsProbe({ baseUrl: BASE_URL, unitSlug: unit, doctorSlug: "any", date });
            const slots = Array.isArray(anyProbe?.slots) ? anyProbe.slots : [];
            const unavailableReasons = Array.from(new Set(slots.filter((slot) => !slot.available).map((slot) => slot.reason).filter(Boolean)));
            const hasAvailable = slots.some((slot) => slot.available);

            if (!hasAvailable && unavailableReasons.length === 1 && unavailableReasons[0] === "closed_day") {
                closedDaysMap.set(`${unit}|${date}`, { unit: unitLabelFromSlug(unit), date });
                probeSummary.push({ unit, date, mode: "any", result: "closed_day" });
                continue;
            }

            const hasScheduleEntries = Array.from(scheduleEntriesMap.values()).some((entry) =>
                normalizeUnitKey(entry.unit) === normalizeUnitKey(unitLabelFromSlug(unit)) && entry.date === date,
            );
            if (hasScheduleEntries) {
                probeSummary.push({ unit, date, mode: "any", result: hasAvailable ? "has_availability" : unavailableReasons.join(",") || "agenda_only" });
                continue;
            }

            if (!hasAvailable && unavailableReasons.length === 1 && unavailableReasons[0] === "doctor_off") {
                probeSummary.push({ unit, date, mode: "any", result: "doctor_off" });
                continue;
            }

            for (const member of unitMembers) {
                const doctorSlug = slugFromMember(member);
                const doctorProbe = await fetchSlotsProbe({ baseUrl: BASE_URL, unitSlug: unit, doctorSlug, date });
                const doctorSlots = Array.isArray(doctorProbe?.slots) ? doctorProbe.slots : [];
                const doctorReasons = Array.from(new Set(doctorSlots.filter((slot) => !slot.available).map((slot) => slot.reason).filter(Boolean)));
                const doctorHasAvailability = doctorSlots.some((slot) => slot.available);
                const isDoctorOff = !doctorHasAvailability && doctorReasons.length === 1 && (doctorReasons[0] === "doctor_off" || doctorReasons[0] === "closed_day");

                probeSummary.push({
                    unit,
                    date,
                    mode: "doctor",
                    doctor: normalizeOneLine(member.name),
                    slug: doctorSlug,
                    result: isDoctorOff ? doctorReasons[0] : doctorHasAvailability ? "has_availability" : doctorReasons.join(",") || "active",
                });

                if (isDoctorOff) continue;

                scheduleEntriesMap.set(`${unit}|${date}|${normalizeOneLine(member.name)}`, {
                    unit: unitLabelFromSlug(unit),
                    date,
                    professional_name: normalizeOneLine(member.name),
                });
            }
        }
    }

    const placesSnapshot = await buildPlacesSnapshot();
    const metadata = {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        range: { dateFrom, dateTo, days },
        counts: {
            teamMembers: team.members.length,
            services: services.services.length,
            agendaAppointments: Object.values(agendaByUnit).reduce((sum, list) => sum + list.length, 0),
            scheduleEntries: scheduleEntriesMap.size,
            closedDays: closedDaysMap.size,
            placesUnits: placesSnapshot.summary.length,
            placePhotos: placesSnapshot.uniquePhotoCount,
        },
    };

    await writeJson(path.join(DEV_SNAPSHOT_DIR, "metadata.json"), metadata);
    await writeJson(path.join(DEV_SNAPSHOT_DIR, "team-directory.json"), team);
    await writeJson(path.join(DEV_SNAPSHOT_DIR, "services.json"), services);
    await writeJson(path.join(DEV_SNAPSHOT_DIR, "agenda.json"), agendaByUnit);
    await writeJson(path.join(DEV_SNAPSHOT_DIR, "schedule-probe-summary.json"), probeSummary);
    await writeJson(path.join(DEV_SNAPSHOT_DIR, "places-summary.json"), placesSnapshot.summary);
    await writeJson(path.join(PUBLIC_SNAPSHOT_DIR, "metadata.json"), {
        generatedAt: metadata.generatedAt,
        baseUrl: metadata.baseUrl,
        places: placesSnapshot.summary,
        placePhotos: placesSnapshot.uniquePhotoCount,
    });

    const agendaSqlFile = path.join(DEV_SNAPSHOT_DIR, "booking-db-import.sql");
    const escalaSqlFile = path.join(DEV_SNAPSHOT_DIR, "escala-db-import.sql");

    await writeFile(
        agendaSqlFile,
        buildAgendaSql(Object.values(agendaByUnit).flat()),
    );
    await writeFile(
        escalaSqlFile,
        buildEscalaSql({
            members: team.members,
            scheduleEntries: Array.from(scheduleEntriesMap.values()),
            closedDays: Array.from(closedDaysMap.values()),
        }),
    );

    console.log("");
    console.log("Hidratando D1 local do preview...");
    runWranglerD1Execute("espacofacial-booking", agendaSqlFile);
    runWranglerD1Execute("skincos-escala", escalaSqlFile);

    await rm(agendaSqlFile, { force: true });
    await rm(escalaSqlFile, { force: true });

    console.log("");
    console.log("Snapshot online sincronizado com sucesso.");
    console.log(`Dados locais: ${path.relative(ROOT_DIR, DEV_SNAPSHOT_DIR)}`);
    console.log(`Assets públicos do snapshot: ${path.relative(ROOT_DIR, PUBLIC_SNAPSHOT_DIR)}`);
    console.log("Use `npm --prefix website run preview:snapshot` para testar o espelho local com D1 e Places snapshotados.");
}

main().catch((error) => {
    console.error("");
    console.error("Falha ao sincronizar snapshot online.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
