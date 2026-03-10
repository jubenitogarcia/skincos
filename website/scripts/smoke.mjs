import fs from "node:fs";

const baseUrl = (process.env.SMOKE_BASE_URL ?? "https://espacofacial.com").replace(/\/$/, "");

function normalizeEnvValue(value) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}

function readEnvValueFromFiles(key, files = [".env.local", ".dev.vars"]) {
    for (const file of files) {
        if (!fs.existsSync(file)) continue;
        const content = fs.readFileSync(file, "utf8");
        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const idx = trimmed.indexOf("=");
            if (idx <= 0) continue;
            const k = trimmed.slice(0, idx).trim();
            if (k !== key) continue;
            const value = normalizeEnvValue(trimmed.slice(idx + 1));
            if (value) return value;
        }
    }
    return "";
}

function firstNonEmpty(...values) {
    for (const value of values) {
        const normalized = normalizeEnvValue(value);
        if (normalized) return normalized;
    }
    return "";
}

async function fetchHead(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
        method: "HEAD",
        redirect: options.redirect ?? "manual",
    });
    return res;
}

async function fetchText(path) {
    const res = await fetch(`${baseUrl}${path}`, { redirect: "follow" });
    const text = await res.text();
    return { res, text };
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function run() {
    console.log(`Smoke base URL: ${baseUrl}`);

    const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl);
    const agendaToken = firstNonEmpty(
        process.env.SMOKE_AGENDA_TOKEN,
        process.env.AGENDA_SYNC_TOKEN,
        readEnvValueFromFiles("SMOKE_AGENDA_TOKEN"),
        readEnvValueFromFiles("AGENDA_SYNC_TOKEN"),
    );
    const agendaUnit = (process.env.SMOKE_AGENDA_UNIT ?? "barrashoppingsul").trim();
    const requireAgendaCheck = /^(1|true|yes)$/i.test((process.env.SMOKE_REQUIRE_AGENDA ?? "").trim());
    const skipAgendaCheck = /^(1|true|yes)$/i.test((process.env.SMOKE_SKIP_AGENDA ?? "").trim());

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const yyyy = String(tomorrow.getFullYear());
    const mm = String(tomorrow.getMonth() + 1).padStart(2, "0");
    const dd = String(tomorrow.getDate()).padStart(2, "0");
    const tomorrowKey = `${yyyy}-${mm}-${dd}`;
    const agendaFrom = (process.env.SMOKE_AGENDA_FROM ?? tomorrowKey).trim();
    const agendaTo = (process.env.SMOKE_AGENDA_TO ?? tomorrowKey).trim();

    // Core pages
    for (const path of ["/", "/unidades", "/doutores", "/sobre", "/termos", "/privacidade", "/agendamento"]) {
        const res = await fetchHead(path, { redirect: "follow" });
        assert(res.status === 200, `${path} expected 200, got ${res.status}`);
    }

    // Booking APIs (read-only)
    {
        const { res, text } = await fetchText("/api/booking/services");
        assert(res.status === 200, `/api/booking/services expected 200, got ${res.status}`);
        assert(/\"ok\"\s*:\s*true/.test(text), `/api/booking/services should return ok:true`);
    }
    {
        const unit = "barrashoppingsul";
        const doctor = "smoke";
        const service = "botox";
        const durationMinutes = 30;
        const url = `/api/booking/slots?unit=${encodeURIComponent(unit)}&doctor=${encodeURIComponent(doctor)}&service=${encodeURIComponent(service)}&durationMinutes=${durationMinutes}&date=${encodeURIComponent(tomorrowKey)}`;
        const { res, text } = await fetchText(url);
        if (isLocal && res.status >= 500) {
            console.warn(`WARN: skipping booking slots check on localhost (got ${res.status})`);
        } else {
            assert(res.status === 200, `${url} expected 200, got ${res.status}`);
            assert(/\"ok\"\s*:\s*true/.test(text), `${url} should return ok:true`);
        }
    }

    if (skipAgendaCheck) {
        console.warn("WARN: SMOKE_SKIP_AGENDA=1; skipping /api/agenda check");
    } else if (agendaToken) {
        const url = `/api/agenda?unit_slug=${encodeURIComponent(agendaUnit)}&date_from=${encodeURIComponent(agendaFrom)}&date_to=${encodeURIComponent(agendaTo)}`;
        const res = await fetch(`${baseUrl}${url}`, {
            headers: { "x-agenda-sync-token": agendaToken },
        });
        const text = await res.text();
        assert(res.status === 200, `${url} expected 200, got ${res.status}`);
        assert(/\"ok\"\s*:\s*true/.test(text), `${url} should return ok:true`);
    } else {
        const message = "SMOKE_AGENDA_TOKEN (or AGENDA_SYNC_TOKEN) not set; skipping /api/agenda check";
        if (requireAgendaCheck) {
            throw new Error(message);
        }
        console.warn(`WARN: ${message}`);
    }

    // 404 (some edge adapters return 200 for the not-found document; verify via body markers)
    {
        const { res, text } = await fetchText("/nao-existe");
        assert([200, 404].includes(res.status), `/nao-existe expected 200 or 404, got ${res.status}`);
        assert(/Página não encontrada|404|Not Found/i.test(text), `/nao-existe should render a not-found page`);
    }

    // Robots
    {
        const { res, text } = await fetchText("/robots.txt");
        assert(res.status === 200, `/robots.txt expected 200, got ${res.status}`);
        assert(/Sitemap:/i.test(text), `/robots.txt should include Sitemap:`);
    }

    // Sitemap
    {
        const { res, text } = await fetchText("/sitemap.xml");
        assert(res.status === 200, `/sitemap.xml expected 200, got ${res.status}`);
        assert(/<urlset/.test(text), `/sitemap.xml should contain <urlset`);
    }

    // Redirect endpoints (must be redirects)
    for (const path of [
        "/barrashoppingsul/faleconosco",
        "/novohamburgo/faleconosco",
        "/barrashoppingsul/faleconsco",
        "/novohamburgo/faleconsco",
    ]) {
        const res = await fetchHead(path, { redirect: "manual" });
        assert([301, 302, 307, 308].includes(res.status), `${path} expected redirect, got ${res.status}`);
        const loc = res.headers.get("location");
        assert(loc && /^https:\/\//.test(loc), `${path} expected https Location, got ${loc}`);
    }

    // Header markers (ensure we're not serving an older deployment)
    {
        const { res, text } = await fetchText("/");
        assert(res.status === 200, `/ expected 200, got ${res.status}`);
        assert(text.includes('href="/#sobre-nos"'), `Home HTML should include header link to /#sobre-nos`);
        assert(text.includes('aria-label="Instagram"'), `Home HTML should include Instagram button (aria-label)`);
    }

    console.log("OK: smoke checks passed");
}

run().catch((err) => {
    console.error("Smoke FAILED:", err?.message ?? err);
    process.exit(1);
});
