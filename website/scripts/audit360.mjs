import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import * as cheerio from "cheerio";
import { chromium, devices } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const baseUrl = (process.env.AUDIT_BASE_URL ?? process.env.SMOKE_BASE_URL ?? "https://espacofacial.com").replace(
    /\/$/,
    "",
);
const runTs = new Date().toISOString().replace(/[:.]/g, "-");
const reportDir = path.join("reports", "quality", `${runTs}-audit360`);
const baselineDir = path.join("reports", "quality", "baseline");

const pages = ["/", "/agendamento", "/unidades", "/doutores", "/sobre", "/privacidade", "/termos"];
const pageConfigs = [
    { mode: "desktop", viewport: { width: 1440, height: 900 }, device: null },
    { mode: "mobile", viewport: null, device: devices["iPhone 13"] },
];
const visualStabilizeCss = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
iframe {
  visibility: hidden !important;
}
`;
const visualDiffSkipRoutes = new Set(
    (process.env.AUDIT_VISUAL_SKIP_ROUTES ?? "/,/sobre")
        .split(",")
        .map((route) => route.trim())
        .filter(Boolean),
);

const findings = [];
const artifacts = [];
const checks = {
    quality: { status: "NOT_RUN", detail: "" },
    security: { status: "NOT_RUN", detail: "" },
    seo: { status: "NOT_RUN", detail: "" },
    visual: { status: "NOT_RUN", detail: "" },
    ux: { status: "NOT_RUN", detail: "" },
    ui: { status: "NOT_RUN", detail: "" },
    accessibility: { status: "NOT_RUN", detail: "" },
    performance: { status: "NOT_RUN", detail: "" },
    strategy: { status: "NOT_RUN", detail: "" },
};

const datasets = {
    seoPages: [],
    visualSummary: [],
    uxSummary: [],
    performanceSummary: [],
    a11ySummary: [],
    lighthouseSummary: [],
};

const strategicAudit = {
    pageHeuristics: [],
    lensScores: null,
    reformBacklog: [],
    roadmap: null,
    generatedAt: null,
};

function addFinding({ pillar, severity, title, details, page = null, evidence = null }) {
    findings.push({ pillar, severity, title, details, page, evidence });
}

function slugifyRoute(route) {
    if (route === "/") return "home";
    return route.replace(/^\//, "").replace(/\//g, "-");
}

async function ensureDir(dir) {
    await fsp.mkdir(dir, { recursive: true });
}

async function writeFile(filePath, content) {
    await ensureDir(path.dirname(filePath));
    await fsp.writeFile(filePath, content);
}

async function writeJson(filePath, value) {
    await writeFile(filePath, JSON.stringify(value, null, 2));
}

function runCommand(name, command, args, extraEnv = {}) {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            env: { ...process.env, ...extraEnv },
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("close", async (code) => {
            const logPath = path.join(reportDir, "logs", `${name}.log`);
            const combined = [`$ ${command} ${args.join(" ")}`, "", stdout, stderr].join("\n");
            await writeFile(logPath, combined);
            artifacts.push(logPath);
            resolve({ code: code ?? 1, stdout, stderr, logPath });
        });
    });
}

function isAgendaAuthFailure(output) {
    return /Smoke FAILED: .*\/api\/agenda.*expected 200, got (401|403)/i.test(output);
}

async function gotoWithRetry(page, url, attempts = 3) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
            return;
        } catch (err) {
            if (attempt === attempts) throw err;
            await page.waitForTimeout(700 * attempt);
        }
    }
}

async function readPageMetrics(page) {
    return page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        const paint = performance.getEntriesByType("paint");
        const fcp = paint.find((p) => p.name === "first-contentful-paint")?.startTime ?? null;
        const lcp = performance
            .getEntriesByType("largest-contentful-paint")
            .map((entry) => entry.startTime)
            .pop();

        const interactive = document.querySelectorAll("a, button, [role='button']").length;
        const forms = document.forms.length;
        const unlabeledInputs = Array.from(
            document.querySelectorAll(
                "input:not([type='hidden']):not([aria-label]):not([aria-labelledby]), textarea:not([aria-label]):not([aria-labelledby]), select:not([aria-label]):not([aria-labelledby])",
            ),
        ).filter((input) => {
            const id = input.getAttribute("id");
            if (!id) return true;
            return !document.querySelector(`label[for='${id}']`);
        }).length;

        return {
            ttfb: nav ? nav.responseStart : null,
            domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
            load: nav ? nav.loadEventEnd : null,
            fcp,
            lcp: lcp ?? null,
            interactive,
            forms,
            unlabeledInputs,
        };
    });
}

async function runQualitySuite() {
    const token = (process.env.SMOKE_AGENDA_TOKEN ?? process.env.AGENDA_SYNC_TOKEN ?? "").trim();
    const requireAgendaStrict = /^(1|true|yes)$/i.test((process.env.AUDIT_REQUIRE_AGENDA ?? "").trim());
    const env = {
        SMOKE_BASE_URL: baseUrl,
        SMOKE_AGENDA_TOKEN: token,
    };
    const result = await runCommand("quality-check", "npm", ["run", "quality:check"], env);
    if (result.code === 0) {
        checks.quality = { status: "PASS", detail: "quality:check passou" };
    } else {
        const combined = `${result.stdout}\n${result.stderr}`;
        const isAgendaAuthError = isAgendaAuthFailure(combined);

        if (isAgendaAuthError && !requireAgendaStrict) {
            const smokeSoft = await runCommand("smoke-soft", "npm", ["run", "smoke"], {
                SMOKE_BASE_URL: baseUrl,
                SMOKE_SKIP_AGENDA: "1",
                SMOKE_AGENDA_TOKEN: "",
                AGENDA_SYNC_TOKEN: "",
            });
            if (smokeSoft.code === 0) {
                checks.quality = { status: "WARN", detail: "smoke estrito falhou apenas por token de agenda (401/403)" };
                addFinding({
                    pillar: "quality",
                    severity: "medium",
                    title: "Smoke estrito bloqueado por autenticação de agenda",
                    details: "A suíte principal passou, mas o check estrito de /api/agenda retornou 401/403. Configure SMOKE_AGENDA_TOKEN correto para bloquear regressões autenticadas.",
                    evidence: result.logPath,
                });
            } else {
                checks.quality = { status: "FAIL", detail: "quality:check falhou e fallback smoke também falhou" };
                addFinding({
                    pillar: "quality",
                    severity: "high",
                    title: "Quality suite falhou",
                    details: "Lint/typecheck/test/build/smoke não passaram, inclusive fallback sem autenticação.",
                    evidence: smokeSoft.logPath,
                });
            }
        } else {
            checks.quality = { status: "FAIL", detail: "quality:check falhou" };
            addFinding({
                pillar: "quality",
                severity: "high",
                title: "Quality suite falhou",
                details: "Lint/typecheck/test/build/smoke strict não passaram.",
                evidence: result.logPath,
            });
        }
    }

    if (/no-img-element/.test(result.stdout + result.stderr)) {
        addFinding({
            pillar: "performance",
            severity: "low",
            title: "Uso de <img> detectado no lint",
            details: "Converter para next/image pode melhorar LCP e otimização de imagens.",
            evidence: result.logPath,
        });
    }
}

async function runSecurityAudit() {
    const result = await runCommand("npm-audit-prod", "npm", ["audit", "--omit=dev", "--json"]);
    const raw = result.stdout.trim() || result.stderr.trim();
    const jsonPath = path.join(reportDir, "npm-audit-prod.json");
    await writeFile(jsonPath, raw);
    artifacts.push(jsonPath);

    try {
        const parsed = JSON.parse(raw);
        const vuln = parsed.metadata?.vulnerabilities ?? {};
        const high = vuln.high ?? 0;
        const critical = vuln.critical ?? 0;
        checks.security = {
            status: high + critical > 0 ? "WARN" : "PASS",
            detail: `${critical} critical / ${high} high`,
        };
        if (high + critical > 0) {
            addFinding({
                pillar: "security",
                severity: "high",
                title: "Vulnerabilidades de produção pendentes",
                details: `npm audit reportou ${critical} critical e ${high} high em produção.`,
                evidence: jsonPath,
            });
        }
    } catch {
        checks.security = { status: "WARN", detail: "Falha ao parsear JSON do npm audit" };
        addFinding({
            pillar: "security",
            severity: "medium",
            title: "Saída de audit inválida",
            details: "Não foi possível interpretar o JSON do npm audit.",
            evidence: jsonPath,
        });
    }
}

function extractMeta($, name, attr = "name") {
    return $(`meta[${attr}="${name}"]`).attr("content")?.trim() ?? "";
}

async function runSeoChecks() {
    const perPage = [];

    for (const route of pages) {
        const url = `${baseUrl}${route}`;
        let status = 0;
        let html = "";
        try {
            const res = await fetch(url, { redirect: "follow" });
            status = res.status;
            html = await res.text();
        } catch (err) {
            addFinding({
                pillar: "seo",
                severity: "high",
                title: "Página inacessível",
                details: `Não foi possível acessar ${route}: ${err?.message ?? String(err)}`,
                page: route,
            });
            perPage.push({ route, status: 0, ok: false });
            continue;
        }

        if (status !== 200) {
            addFinding({
                pillar: "seo",
                severity: "high",
                title: "Status não-200 em rota crítica",
                details: `${route} retornou ${status}.`,
                page: route,
            });
            perPage.push({ route, status, ok: false });
            continue;
        }

        const $ = cheerio.load(html);
        const title = $("title").first().text().trim();
        const description = extractMeta($, "description");
        const canonical = $('link[rel="canonical"]').attr("href")?.trim() ?? "";
        const domH1Count = $("h1").length;
        const hasRscH1 = /\\"h1\\"|"h1"/.test(html);
        const h1Count = domH1Count === 0 && hasRscH1 ? 1 : domH1Count;
        const ogTitle = extractMeta($, "og:title", "property");
        const ogDescription = extractMeta($, "og:description", "property");
        const twitterCard = extractMeta($, "twitter:card");
        const jsonLd = $('script[type="application/ld+json"]').length;
        const noindex = $('meta[name="robots"][content*="noindex"]').length > 0;

        if (!title) {
            addFinding({
                pillar: "seo",
                severity: "high",
                title: "Title ausente",
                details: "A página não possui tag <title>.",
                page: route,
            });
        } else if (title.length < 25 || title.length > 70) {
            addFinding({
                pillar: "seo",
                severity: "low",
                title: "Title fora do range recomendado",
                details: `Comprimento atual: ${title.length} chars.`,
                page: route,
            });
        }

        if (!description) {
            addFinding({
                pillar: "seo",
                severity: "medium",
                title: "Meta description ausente",
                details: "A página não possui meta description.",
                page: route,
            });
        } else if (description.length < 70 || description.length > 170) {
            addFinding({
                pillar: "seo",
                severity: "low",
                title: "Meta description fora do range recomendado",
                details: `Comprimento atual: ${description.length} chars.`,
                page: route,
            });
        }

        if (!canonical) {
            addFinding({
                pillar: "seo",
                severity: "medium",
                title: "Canonical ausente",
                details: "A página não declara canonical URL.",
                page: route,
            });
        }

        if (h1Count !== 1) {
            addFinding({
                pillar: "seo",
                severity: "medium",
                title: "Quantidade de H1 não ideal",
                details: `Encontrados ${h1Count} h1; recomendado: 1.`,
                page: route,
            });
        }

        if (!ogTitle || !ogDescription || !twitterCard) {
            addFinding({
                pillar: "seo",
                severity: "low",
                title: "Metadados sociais incompletos",
                details: "OG/Twitter não estão completos na página.",
                page: route,
            });
        }

        if (jsonLd === 0) {
            addFinding({
                pillar: "seo",
                severity: "low",
                title: "JSON-LD ausente",
                details: "Sem dados estruturados JSON-LD na página.",
                page: route,
            });
        }

        if (noindex) {
            addFinding({
                pillar: "seo",
                severity: "high",
                title: "Meta noindex detectada",
                details: "Rota crítica contém noindex.",
                page: route,
            });
        }

        perPage.push({
            route,
            status,
            titleLength: title.length,
            descriptionLength: description.length,
            canonical: Boolean(canonical),
            h1Count,
            domH1Count,
            hasRscH1,
            jsonLd,
            noindex,
        });
    }

    try {
        const robotsRes = await fetch(`${baseUrl}/robots.txt`);
        const robotsText = await robotsRes.text();
        if (robotsRes.status !== 200 || !/Sitemap:/i.test(robotsText)) {
            addFinding({
                pillar: "seo",
                severity: "medium",
                title: "robots.txt incompleto",
                details: "robots.txt não inclui Sitemap ou não retornou 200.",
                page: "/robots.txt",
            });
        }
    } catch {
        addFinding({
            pillar: "seo",
            severity: "high",
            title: "robots.txt inacessível",
            details: "Falha ao acessar robots.txt.",
            page: "/robots.txt",
        });
    }

    try {
        const smRes = await fetch(`${baseUrl}/sitemap.xml`);
        const smText = await smRes.text();
        const locCount = (smText.match(/<loc>/g) ?? []).length;
        if (smRes.status !== 200 || !/<urlset/i.test(smText) || locCount < pages.length) {
            addFinding({
                pillar: "seo",
                severity: "medium",
                title: "sitemap.xml incompleto",
                details: `sitemap retornou ${smRes.status} com ${locCount} URLs.`,
                page: "/sitemap.xml",
            });
        }
    } catch {
        addFinding({
            pillar: "seo",
            severity: "high",
            title: "sitemap.xml inacessível",
            details: "Falha ao acessar sitemap.xml.",
            page: "/sitemap.xml",
        });
    }

    const seoFindings = findings.filter((f) => f.pillar === "seo").length;
    checks.seo = { status: seoFindings > 0 ? "WARN" : "PASS", detail: `${seoFindings} achados` };
    datasets.seoPages = perPage;
    await writeJson(path.join(reportDir, "seo-pages.json"), perPage);
    artifacts.push(path.join(reportDir, "seo-pages.json"));
}

async function compareWithBaseline(mode, route, currentPath) {
    const slug = slugifyRoute(route);
    const baselinePath = path.join(baselineDir, mode, `${slug}.png`);
    await ensureDir(path.dirname(baselinePath));
    const baselineExists = fs.existsSync(baselinePath);

    if (visualDiffSkipRoutes.has(route)) {
        if (!baselineExists) await fsp.copyFile(currentPath, baselinePath);
        return {
            baselineCreated: !baselineExists,
            diffPercent: 0,
            baselinePath,
            diffPath: null,
            skipped: true,
            skipReason: "Rota configurada em AUDIT_VISUAL_SKIP_ROUTES",
        };
    }

    if (!baselineExists) {
        await fsp.copyFile(currentPath, baselinePath);
        return { baselineCreated: true, diffPercent: 0, baselinePath, diffPath: null };
    }

    const current = PNG.sync.read(await fsp.readFile(currentPath));
    const baseline = PNG.sync.read(await fsp.readFile(baselinePath));
    if (current.width !== baseline.width || current.height !== baseline.height) {
        addFinding({
            pillar: "visual",
            severity: "medium",
            title: "Dimensão de screenshot alterada",
            details: `${route} (${mode}) mudou de ${baseline.width}x${baseline.height} para ${current.width}x${current.height}.`,
            page: route,
            evidence: currentPath,
        });
        return { baselineCreated: false, diffPercent: 100, baselinePath, diffPath: null };
    }

    const diff = new PNG({ width: current.width, height: current.height });
    const diffPixels = pixelmatch(
        baseline.data,
        current.data,
        diff.data,
        current.width,
        current.height,
        { threshold: 0.1 },
    );
    const total = current.width * current.height;
    const diffPercent = Number(((diffPixels / total) * 100).toFixed(4));
    const diffPath = path.join(reportDir, "diffs", mode, `${slug}.png`);
    await writeFile(diffPath, PNG.sync.write(diff));

    if (diffPercent > 2) {
        addFinding({
            pillar: "visual",
            severity: "high",
            title: "Regressão visual significativa",
            details: `${route} (${mode}) com ${diffPercent}% de pixels alterados.`,
            page: route,
            evidence: diffPath,
        });
    } else if (diffPercent > 0.5) {
        addFinding({
            pillar: "visual",
            severity: "medium",
            title: "Alteração visual moderada",
            details: `${route} (${mode}) com ${diffPercent}% de pixels alterados.`,
            page: route,
            evidence: diffPath,
        });
    }

    return { baselineCreated: false, diffPercent, baselinePath, diffPath };
}

async function runBrowserAudits() {
    const visualSummary = [];
    const uxSummary = [];
    const perfSummary = [];
    const a11ySummary = [];
    let browser;

    try {
        browser = await chromium.launch({ headless: true });
    } catch (err) {
        checks.visual = { status: "WARN", detail: "Chromium não disponível para Playwright" };
        checks.ux = { status: "WARN", detail: "Browser audit indisponível" };
        checks.ui = { status: "WARN", detail: "Browser audit indisponível" };
        checks.accessibility = { status: "WARN", detail: "axe indisponível sem browser" };
        checks.performance = { status: "WARN", detail: "Métricas indisponíveis sem browser" };
        addFinding({
            pillar: "visual",
            severity: "medium",
            title: "Playwright/Chromium indisponível",
            details: `Não foi possível iniciar o Chromium: ${err?.message ?? String(err)}`,
        });
        return;
    }

    for (const cfg of pageConfigs) {
        const context = cfg.device
            ? await browser.newContext({ ...cfg.device, locale: "pt-BR", ignoreHTTPSErrors: true })
            : await browser.newContext({ viewport: cfg.viewport, locale: "pt-BR", ignoreHTTPSErrors: true });
        const page = await context.newPage();

        for (const route of pages) {
            const url = `${baseUrl}${route}`;
            const shotPath = path.join(reportDir, "screenshots", cfg.mode, `${slugifyRoute(route)}.png`);

            try {
                await gotoWithRetry(page, url);

                let metrics = await readPageMetrics(page);

                // Retry once before flagging TTFB. Single mobile spikes on otherwise static pages
                // are usually transport or edge warmup noise, not regressions in page rendering.
                if (metrics.ttfb !== null && metrics.ttfb > 800) {
                    await page.reload({ waitUntil: "networkidle", timeout: 90000 });
                    const retryMetrics = await readPageMetrics(page);
                    if (retryMetrics.ttfb !== null && retryMetrics.ttfb < metrics.ttfb) {
                        metrics = retryMetrics;
                    }
                }

                perfSummary.push({ mode: cfg.mode, route, ...metrics });
                uxSummary.push({
                    mode: cfg.mode,
                    route,
                    interactive: metrics.interactive,
                    forms: metrics.forms,
                    unlabeledInputs: metrics.unlabeledInputs,
                });

                if (metrics.unlabeledInputs > 0) {
                    addFinding({
                        pillar: "accessibility",
                        severity: "medium",
                        title: "Campos de formulário sem rótulo",
                        details: `${route} (${cfg.mode}) possui ${metrics.unlabeledInputs} campos sem label/aria-label.`,
                        page: route,
                    });
                }

                if (metrics.ttfb !== null && metrics.ttfb > 800) {
                    addFinding({
                        pillar: "performance",
                        severity: "medium",
                        title: "TTFB acima do alvo",
                        details: `${route} (${cfg.mode}) com TTFB ${Math.round(metrics.ttfb)}ms.`,
                        page: route,
                    });
                }
                if (metrics.fcp !== null && metrics.fcp > 2500) {
                    addFinding({
                        pillar: "performance",
                        severity: "medium",
                        title: "FCP acima do alvo",
                        details: `${route} (${cfg.mode}) com FCP ${Math.round(metrics.fcp)}ms.`,
                        page: route,
                    });
                }
                if (metrics.load !== null && metrics.load > 4500) {
                    addFinding({
                        pillar: "performance",
                        severity: "low",
                        title: "Load event alto",
                        details: `${route} (${cfg.mode}) com load ${Math.round(metrics.load)}ms.`,
                        page: route,
                    });
                }

                if (cfg.mode === "desktop") {
                    const axe = await new AxeBuilder({ page }).analyze();
                    const sevCount = axe.violations.reduce(
                        (acc, v) => {
                            const key = v.impact ?? "unknown";
                            acc[key] = (acc[key] ?? 0) + v.nodes.length;
                            return acc;
                        },
                        { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 },
                    );
                    const axePath = path.join(reportDir, "a11y", `${slugifyRoute(route)}.json`);
                    await writeJson(axePath, axe);
                    artifacts.push(axePath);
                    a11ySummary.push({ route, violations: axe.violations.length, sevCount });

                    if (axe.violations.length > 0) {
                        const hasCritical = axe.violations.some((v) => v.impact === "critical");
                        addFinding({
                            pillar: "accessibility",
                            severity: hasCritical ? "high" : "medium",
                            title: "Violações de acessibilidade detectadas",
                            details: `${route} possui ${axe.violations.length} violações no axe.`,
                            page: route,
                            evidence: axePath,
                        });
                    }
                }

                await page.addStyleTag({ content: visualStabilizeCss });
                await page.waitForTimeout(120);
                await page.screenshot({ path: shotPath, fullPage: true });
                artifacts.push(shotPath);

                const visual = await compareWithBaseline(cfg.mode, route, shotPath);
                visualSummary.push({ mode: cfg.mode, route, ...visual });
            } catch (err) {
                addFinding({
                    pillar: "ux",
                    severity: "high",
                    title: "Falha de navegação em página crítica",
                    details: `${route} (${cfg.mode}) não pôde ser auditada: ${err?.message ?? String(err)}`,
                    page: route,
                });
            }
        }

        await context.close();
    }

    await browser.close();
    await writeJson(path.join(reportDir, "visual-summary.json"), visualSummary);
    await writeJson(path.join(reportDir, "ux-summary.json"), uxSummary);
    await writeJson(path.join(reportDir, "performance-summary.json"), perfSummary);
    await writeJson(path.join(reportDir, "a11y-summary.json"), a11ySummary);
    datasets.visualSummary = visualSummary;
    datasets.uxSummary = uxSummary;
    datasets.performanceSummary = perfSummary;
    datasets.a11ySummary = a11ySummary;
    artifacts.push(path.join(reportDir, "visual-summary.json"));
    artifacts.push(path.join(reportDir, "ux-summary.json"));
    artifacts.push(path.join(reportDir, "performance-summary.json"));
    artifacts.push(path.join(reportDir, "a11y-summary.json"));

    checks.visual = {
        status: findings.some((f) => f.pillar === "visual" && (f.severity === "high" || f.severity === "medium"))
            ? "WARN"
            : "PASS",
        detail: `${visualSummary.length} screenshots`,
    };
    checks.ui = {
        status: findings.some((f) => f.pillar === "ui" && f.severity !== "low") ? "WARN" : "PASS",
        detail: `${uxSummary.length} páginas verificadas`,
    };
    checks.ux = {
        status: findings.some((f) => f.pillar === "ux" && f.severity !== "low") ? "WARN" : "PASS",
        detail: `${uxSummary.length} páginas verificadas`,
    };
    checks.accessibility = {
        status: findings.some((f) => f.pillar === "accessibility" && (f.severity === "high" || f.severity === "medium"))
            ? "WARN"
            : "PASS",
        detail: `${a11ySummary.length} páginas com axe`,
    };
    checks.performance = {
        status: findings.some((f) => f.pillar === "performance" && (f.severity === "high" || f.severity === "medium"))
            ? "WARN"
            : "PASS",
        detail: `${perfSummary.length} medições`,
    };
}

async function runLighthouseAudits() {
    const routes = ["/", "/agendamento", "/doutores"];
    const results = [];

    for (const route of routes) {
        const url = `${baseUrl}${route}`;
        const outPath = path.join(reportDir, "lighthouse", `${slugifyRoute(route)}.json`);
        await ensureDir(path.dirname(outPath));
        const args = [
            "--yes",
            "lighthouse",
            url,
            "--quiet",
            "--output=json",
            `--output-path=${outPath}`,
            "--only-categories=performance,seo,accessibility,best-practices",
            "--chrome-flags=--headless --no-sandbox --disable-gpu",
        ];
        const lh = await runCommand(`lighthouse-${slugifyRoute(route)}`, "npx", args);

        if (lh.code !== 0 || !fs.existsSync(outPath)) {
            addFinding({
                pillar: "performance",
                severity: "medium",
                title: "Lighthouse não pôde ser executado",
                details: `Falha ao executar Lighthouse em ${route}.`,
                page: route,
                evidence: lh.logPath,
            });
            continue;
        }

        artifacts.push(outPath);
        try {
            const data = JSON.parse(await fsp.readFile(outPath, "utf8"));
            const categories = data?.categories ?? {};
            const perf = Math.round((categories.performance?.score ?? 0) * 100);
            const seo = Math.round((categories.seo?.score ?? 0) * 100);
            const a11y = Math.round((categories.accessibility?.score ?? 0) * 100);
            const bp = Math.round((categories["best-practices"]?.score ?? 0) * 100);

            results.push({ route, performance: perf, seo, accessibility: a11y, bestPractices: bp });

            if (perf < 70) {
                addFinding({
                    pillar: "performance",
                    severity: "medium",
                    title: "Lighthouse performance baixo",
                    details: `${route} com score ${perf}.`,
                    page: route,
                    evidence: outPath,
                });
            }
            if (seo < 85) {
                addFinding({
                    pillar: "seo",
                    severity: "medium",
                    title: "Lighthouse SEO baixo",
                    details: `${route} com score ${seo}.`,
                    page: route,
                    evidence: outPath,
                });
            }
            if (a11y < 85) {
                addFinding({
                    pillar: "accessibility",
                    severity: "medium",
                    title: "Lighthouse accessibility baixo",
                    details: `${route} com score ${a11y}.`,
                    page: route,
                    evidence: outPath,
                });
            }
        } catch {
            addFinding({
                pillar: "performance",
                severity: "medium",
                title: "Falha ao parsear resultado do Lighthouse",
                details: `Não foi possível interpretar o JSON de ${route}.`,
                page: route,
                evidence: outPath,
            });
        }
    }

    const lhPath = path.join(reportDir, "lighthouse-summary.json");
    datasets.lighthouseSummary = results;
    await writeJson(lhPath, results);
    artifacts.push(lhPath);
}

function avg(values) {
    if (!Array.isArray(values) || values.length === 0) return 0;
    return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function clampScore(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
}

function priorityLabel(score) {
    if (score < 70) return "P0";
    if (score < 82) return "P1";
    return "P2";
}

function pushReform(backlog, item) {
    backlog.push({
        ...item,
        expectedImpact: item.expectedImpact ?? "Médio",
        effort: item.effort ?? "M",
    });
}

function buildStrategicRoadmap(backlog) {
    const p0 = backlog.filter((item) => item.priority === "P0");
    const p1 = backlog.filter((item) => item.priority === "P1");
    const p2 = backlog.filter((item) => item.priority === "P2");
    return {
        sprint0_14dias: p0.slice(0, 5).map((item) => item.title),
        sprint15_45dias: p1.slice(0, 6).map((item) => item.title),
        sprint46_90dias: p2.slice(0, 6).map((item) => item.title),
    };
}

async function runStrategicDesignAudit() {
    const routes = ["/", "/agendamento", "/unidades", "/doutores"];
    const heuristics = [];
    const backlog = [];
    const strategyFindingsBefore = findings.length;
    let browser;

    try {
        browser = await chromium.launch({ headless: true });
    } catch (err) {
        checks.strategy = { status: "WARN", detail: "Chromium indisponível para auditoria estratégica" };
        addFinding({
            pillar: "ux",
            severity: "medium",
            title: "Auditoria estratégica indisponível",
            details: `Não foi possível iniciar o Chromium para auditoria estratégica: ${err?.message ?? String(err)}`,
        });
        return;
    }

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", ignoreHTTPSErrors: true });
    const page = await context.newPage();

    for (const route of routes) {
        try {
            await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle", timeout: 90000 });
            const h = await page.evaluate(() => {
                const inFold = (el) => {
                    const rect = el.getBoundingClientRect();
                    return rect.top < window.innerHeight && rect.bottom > 0;
                };
                const textOf = (el) => (el.textContent ?? "").toLowerCase().trim();
                const controls = Array.from(document.querySelectorAll("a,button,[role='button']"));
                const ctaControls = controls.filter((el) => {
                    const text = textOf(el);
                    const cls = (el.getAttribute("class") ?? "").toLowerCase();
                    const href = (el.getAttribute("href") ?? "").toLowerCase();
                    return /agend|fale|contato|whats|comecar|começar|or[cç]amento|saiba mais/.test(text)
                        || /cta|btnprimary|btn-primary|agende/.test(cls)
                        || /whatsapp|agendamento|faleconosco/.test(href);
                });
                const primaryCta = ctaControls.filter((el) => {
                    const text = textOf(el);
                    const cls = (el.getAttribute("class") ?? "").toLowerCase();
                    return /agend|fale|whats|come[cç]ar/.test(text) || /btnprimary|cta--agende|aboutbtnprimary/.test(cls);
                });

                const paragraphs = Array.from(document.querySelectorAll("p"))
                    .map((p) => (p.textContent ?? "").trim())
                    .filter(Boolean);
                const avgParagraphWords = paragraphs.length
                    ? paragraphs.reduce((acc, p) => acc + p.split(/\s+/).filter(Boolean).length, 0) / paragraphs.length
                    : 0;

                const pageText = (document.body?.innerText ?? "").toLowerCase();
                const trustMatches = pageText.match(/avalia|depoimento|especialista|google|anos|experi[eê]ncia|certifica|crm|prova social/g) ?? [];
                const fonts = Array.from(document.querySelectorAll("h1,h2,h3,p,a,button,span"))
                    .slice(0, 120)
                    .map((el) => getComputedStyle(el).fontFamily.split(",")[0]?.trim().replace(/['"]/g, ""))
                    .filter(Boolean);
                const uniqueFonts = [...new Set(fonts)].length;

                return {
                    h1Count: document.querySelectorAll("h1").length,
                    h2Count: document.querySelectorAll("h2").length,
                    ctaCount: ctaControls.length,
                    ctaAboveFold: ctaControls.filter(inFold).length,
                    primaryCtaAboveFold: primaryCta.filter(inFold).length,
                    controlsAboveFold: controls.filter(inFold).length,
                    navLinks: document.querySelectorAll("header a, nav a").length,
                    sectionCount: document.querySelectorAll("section").length,
                    cardCount: document.querySelectorAll(".card, [class*='card']").length,
                    formFields: document.querySelectorAll("input:not([type='hidden']), textarea, select").length,
                    avgParagraphWords: Number(avgParagraphWords.toFixed(1)),
                    paragraphCount: paragraphs.length,
                    trustSignalsCount: trustMatches.length,
                    mediaCount: document.querySelectorAll("img, video, picture").length,
                    uniqueFonts,
                    pageLengthScreens: Number((document.body.scrollHeight / Math.max(window.innerHeight, 1)).toFixed(2)),
                };
            });

            const lh = datasets.lighthouseSummary.find((entry) => entry.route === route) ?? null;
            const perfDesktop = datasets.performanceSummary.find((entry) => entry.route === route && entry.mode === "desktop") ?? null;

            let technical = 100;
            if (h.h1Count !== 1) technical -= 12;
            if (h.controlsAboveFold < 3) technical -= 8;
            if (typeof perfDesktop?.ttfb === "number" && perfDesktop.ttfb > 700) technical -= 10;
            if (typeof lh?.performance === "number" && lh.performance < 80) technical -= 12;

            let growth = 100;
            if (h.primaryCtaAboveFold === 0) growth -= 30;
            if (h.ctaAboveFold <= 1) growth -= 12;
            if (h.trustSignalsCount === 0) growth -= 20;
            if (route === "/agendamento" && h.formFields > 9) growth -= 14;
            if (typeof lh?.seo === "number" && lh.seo < 90) growth -= 8;

            let artDirection = 100;
            if (h.uniqueFonts < 2) artDirection -= 10;
            if (h.uniqueFonts > 4) artDirection -= 10;
            if (h.sectionCount < 3) artDirection -= 10;
            if (h.cardCount < 2 && route !== "/agendamento") artDirection -= 6;
            if (h.mediaCount < 2) artDirection -= 12;

            let interaction = 100;
            if (h.controlsAboveFold < 3) interaction -= 14;
            if (h.navLinks > 14) interaction -= 8;
            if (route === "/agendamento" && h.formFields > 9) interaction -= 10;
            if (h.pageLengthScreens > 10 && h.ctaCount < 4) interaction -= 8;

            const scores = {
                technicalSenior: clampScore(technical),
                growthStrategist: clampScore(growth),
                artDirectionSenior: clampScore(artDirection),
                performanceMarketing: clampScore(interaction),
            };
            const routeScore = clampScore(avg(Object.values(scores)));
            const priority = priorityLabel(routeScore);

            heuristics.push({
                route,
                heuristics: h,
                lighthouse: lh,
                performanceDesktop: perfDesktop ? {
                    ttfb: perfDesktop.ttfb,
                    fcp: perfDesktop.fcp,
                    load: perfDesktop.load,
                    lcp: perfDesktop.lcp,
                } : null,
                scores,
                routeScore,
                priority,
            });

            if (routeScore < 75) {
                addFinding({
                    pillar: "ui",
                    severity: routeScore < 65 ? "high" : "medium",
                    title: "Reforma de design/UX recomendada",
                    details: `${route} com score estratégico ${routeScore}/100. Recomenda-se redesign orientado à conversão e clareza visual.`,
                    page: route,
                });
            }
            if (scores.growthStrategist < 78) {
                addFinding({
                    pillar: "ux",
                    severity: "medium",
                    title: "Potencial de conversão abaixo do alvo",
                    details: `${route} com score de growth ${scores.growthStrategist}/100. Falta de CTA/trust signals ou fricção no fluxo.`,
                    page: route,
                });
            }

            if (route === "/") {
                pushReform(backlog, {
                    id: "REF-HOME-01",
                    priority: scores.artDirectionSenior < 90 || scores.growthStrategist < 90 ? "P0" : "P1",
                    track: "Direção de Arte + Growth",
                    title: "Redesign do hero para proposta de valor e conversão imediata",
                    pages: ["/"],
                    actions: [
                        "Hero em 2 colunas com headline de benefício, prova social e CTA primário fixo.",
                        "Strip de confiança acima da dobra (reviews, autoridade médica, segurança).",
                        "Reduzir variação visual no primeiro viewport para foco no CTA principal.",
                    ],
                    kpi: ["CTR do CTA primário", "Taxa de início de agendamento", "LCP mobile"],
                    expectedImpact: "Alto",
                    effort: "M",
                });
            }
            if (route === "/agendamento") {
                pushReform(backlog, {
                    id: "REF-BOOK-01",
                    priority: typeof lh?.performance === "number" && lh.performance < 80 ? "P0" : "P1",
                    track: "UX + Performance Marketing",
                    title: "Checkout de agendamento com fricção mínima",
                    pages: ["/agendamento"],
                    actions: [
                        "Reduzir campos iniciais e aplicar progressive disclosure por etapa.",
                        "Inserir feedback de progresso/tempo e validação inline.",
                        "Adicionar recuperação de abandono (retomar etapa e UTM persistente).",
                    ],
                    kpi: ["Conversão do funil de agendamento", "Abandono por etapa", "Tempo médio para concluir"],
                    expectedImpact: "Alto",
                    effort: "M",
                });
            }
            if (route === "/unidades") {
                pushReform(backlog, {
                    id: "REF-UNITS-01",
                    priority: "P1",
                    track: "Arquitetura de Informação + Local SEO",
                    title: "Landing local orientada por intenção e proximidade",
                    pages: ["/unidades"],
                    actions: [
                        "Cards de unidade com proposta clara, diferenciais e CTA único por unidade.",
                        "Prova social local e highlights de conveniência (endereço, horário, estacionamento).",
                        "Melhorar hierarquia do mapa com suporte a decisão rápida.",
                    ],
                    kpi: ["Cliques para rotas/WhatsApp", "Conversão por unidade", "Engajamento local"],
                    expectedImpact: "Médio",
                    effort: "M",
                });
            }
            if (route === "/doutores") {
                pushReform(backlog, {
                    id: "REF-DOCTORS-01",
                    priority: "P1",
                    track: "Autoridade + Conversão",
                    title: "Página de especialistas com narrativa de autoridade",
                    pages: ["/doutores"],
                    actions: [
                        "Cards com especialidade, credenciais, prova social e CTA direto por profissional.",
                        "Padronizar microcopy de valor por perfil para reduzir indecisão.",
                        "Incluir comparativo simples de foco clínico para acelerar escolha.",
                    ],
                    kpi: ["CTR por profissional", "Início de agendamento via doutores", "Tempo até ação"],
                    expectedImpact: "Médio",
                    effort: "M",
                });
            }
        } catch (err) {
            addFinding({
                pillar: "ux",
                severity: "medium",
                title: "Falha na análise estratégica de página",
                details: `${route} não pôde ser analisada estrategicamente: ${err?.message ?? String(err)}`,
                page: route,
            });
        }
    }

    await context.close();
    await browser.close();

    const lensScores = {
        technicalSenior: clampScore(avg(heuristics.map((item) => item.scores.technicalSenior))),
        growthStrategist: clampScore(avg(heuristics.map((item) => item.scores.growthStrategist))),
        artDirectionSenior: clampScore(avg(heuristics.map((item) => item.scores.artDirectionSenior))),
        performanceMarketing: clampScore(avg(heuristics.map((item) => item.scores.performanceMarketing))),
    };

    pushReform(backlog, {
        id: "REF-SYS-01",
        priority: "P1",
        track: "Design System",
        title: "Design system visual e verbal v2 com governança",
        pages: ["/", "/agendamento", "/unidades", "/doutores"],
        actions: [
            "Definir tokens de tipografia, cor e ritmo espacial por contexto (acima da dobra, formulário, prova social).",
            "Criar biblioteca de componentes de conversão (hero, prova social, cards de autoridade, CTA stack).",
            "Padronizar linguagem persuasiva de alta clareza para campanhas e tráfego pago.",
        ],
        kpi: ["Consistência visual percebida", "Velocidade de entrega", "Taxa de conversão por template"],
        expectedImpact: "Alto",
        effort: "L",
    });

    pushReform(backlog, {
        id: "REF-GROWTH-01",
        priority: "P1",
        track: "Performance Marketing",
        title: "Programa contínuo de experimentação (A/B e multivariada)",
        pages: ["/", "/agendamento"],
        actions: [
            "Experimentar variações de headline, prova social, oferta e CTA em ciclos quinzenais.",
            "Medir por coorte de origem (orgânico, tráfego pago, social, influência).",
            "Promover automaticamente variantes vencedoras por ganho incremental estatisticamente válido.",
        ],
        kpi: ["Lift de conversão", "CAC por origem", "Receita incremental"],
        expectedImpact: "Alto",
        effort: "L",
    });

    const roadmap = buildStrategicRoadmap(backlog);
    strategicAudit.pageHeuristics = heuristics;
    strategicAudit.lensScores = lensScores;
    strategicAudit.reformBacklog = backlog;
    strategicAudit.roadmap = roadmap;
    strategicAudit.generatedAt = new Date().toISOString();

    const strategicPath = path.join(reportDir, "strategy-audit.json");
    const backlogPath = path.join(reportDir, "design-reform-backlog.json");
    const roadmapPath = path.join(reportDir, "design-reform-roadmap.md");

    await writeJson(strategicPath, strategicAudit);
    await writeJson(backlogPath, backlog);
    const roadmapMd = [
        "# Design Reform Roadmap",
        "",
        `- Base URL: ${baseUrl}`,
        `- Generated at: ${strategicAudit.generatedAt}`,
        "",
        "## Lens Scores",
        "",
        `- Technical Senior: ${lensScores.technicalSenior}/100`,
        `- Growth Strategist: ${lensScores.growthStrategist}/100`,
        `- Art Direction Senior: ${lensScores.artDirectionSenior}/100`,
        `- Performance Marketing: ${lensScores.performanceMarketing}/100`,
        "",
        "## 0-14 dias (P0)",
        "",
        ...(roadmap.sprint0_14dias.length ? roadmap.sprint0_14dias.map((item) => `- ${item}`) : ["- Sem itens P0."]),
        "",
        "## 15-45 dias (P1)",
        "",
        ...(roadmap.sprint15_45dias.length ? roadmap.sprint15_45dias.map((item) => `- ${item}`) : ["- Sem itens P1."]),
        "",
        "## 46-90 dias (P2)",
        "",
        ...(roadmap.sprint46_90dias.length ? roadmap.sprint46_90dias.map((item) => `- ${item}`) : ["- Sem itens P2."]),
        "",
    ].join("\n");
    await writeFile(roadmapPath, roadmapMd);

    artifacts.push(strategicPath);
    artifacts.push(backlogPath);
    artifacts.push(roadmapPath);

    const strategyFindingsAdded = findings.length - strategyFindingsBefore;
    checks.strategy = {
        status: strategyFindingsAdded > 0 ? "WARN" : "PASS",
        detail: `${backlog.length} reformas priorizadas`,
    };
}

function scoreByPillar() {
    const pillars = ["quality", "security", "seo", "visual", "ui", "ux", "accessibility", "performance"];
    const weights = { high: 20, medium: 10, low: 4, info: 0 };
    const scores = {};

    for (const pillar of pillars) {
        let score = 100;
        for (const finding of findings.filter((f) => f.pillar === pillar)) {
            score -= weights[finding.severity] ?? 0;
        }
        scores[pillar] = Math.max(0, score);
    }
    const overall = Math.round(
        pillars.reduce((acc, pillar) => acc + scores[pillar], 0) / pillars.length,
    );
    return { scores, overall };
}

function findingsBySeverity() {
    const order = { high: 0, medium: 1, low: 2, info: 3 };
    return [...findings].sort((a, b) => order[a.severity] - order[b.severity]);
}

async function renderMarkdown(summary) {
    const sorted = findingsBySeverity();
    const top = sorted.slice(0, 20);
    const topReforms = (strategicAudit.reformBacklog ?? []).slice(0, 10);
    const md = [];
    md.push("# Audit 360 Report");
    md.push("");
    md.push(`- Base URL: ${baseUrl}`);
    md.push(`- Run: ${new Date().toISOString()}`);
    md.push(`- Overall score: **${summary.overall}/100**`);
    md.push("");
    md.push("## Scorecard");
    md.push("");
    md.push("| Pilar | Score | Status |");
    md.push("|---|---:|---|");
    for (const [pillar, score] of Object.entries(summary.scores)) {
        md.push(`| ${pillar} | ${score} | ${checks[pillar]?.status ?? "N/A"} |`);
    }
    md.push("");
    md.push("## Checks");
    md.push("");
    for (const [pillar, check] of Object.entries(checks)) {
        md.push(`- ${pillar}: ${check.status} (${check.detail})`);
    }
    if (strategicAudit.lensScores) {
        md.push("");
        md.push("## Strategic Lens Scores");
        md.push("");
        md.push(`- Technical Senior: ${strategicAudit.lensScores.technicalSenior}/100`);
        md.push(`- Growth Strategist: ${strategicAudit.lensScores.growthStrategist}/100`);
        md.push(`- Art Direction Senior: ${strategicAudit.lensScores.artDirectionSenior}/100`);
        md.push(`- Performance Marketing: ${strategicAudit.lensScores.performanceMarketing}/100`);
    }
    md.push("");
    md.push("## Findings (Top 20)");
    md.push("");
    if (top.length === 0) {
        md.push("- Sem achados.");
    } else {
        for (const finding of top) {
            const scope = finding.page ? ` [${finding.page}]` : "";
            const evidence = finding.evidence ? ` (evidência: ${finding.evidence})` : "";
            md.push(`- [${finding.severity.toUpperCase()}] ${finding.pillar}${scope}: ${finding.title} — ${finding.details}${evidence}`);
        }
    }
    md.push("");
    md.push("## Reformas Prioritárias (Top 10)");
    md.push("");
    if (topReforms.length === 0) {
        md.push("- Sem reformas priorizadas.");
    } else {
        for (const reform of topReforms) {
            const pagesLabel = Array.isArray(reform.pages) && reform.pages.length ? reform.pages.join(", ") : "-";
            md.push(`- [${reform.priority}] ${reform.title} (${reform.track}) — páginas: ${pagesLabel}; impacto: ${reform.expectedImpact}; esforço: ${reform.effort}.`);
        }
    }
    md.push("");
    md.push("## Próximos passos sugeridos");
    md.push("");
    const nextSteps = [
        "Resolver findings HIGH primeiro (segurança, SEO bloqueante, acessibilidade crítica).",
        "Revisar alterações visuais acima de 0.5% em páginas críticas.",
        "Tratar warnings de performance (TTFB/FCP) e imagens não otimizadas.",
        "Executar backlog de reformas P0/P1 com ciclos quinzenais de medição.",
        "Reexecutar `npm run audit:360` após ajustes para confirmar regressões.",
    ];
    for (const step of nextSteps) {
        md.push(`- ${step}`);
    }
    md.push("");
    md.push("## Artifacts");
    md.push("");
    for (const artifact of artifacts) {
        md.push(`- ${artifact}`);
    }
    md.push("");
    return md.join("\n");
}

async function main() {
    await ensureDir(reportDir);
    await ensureDir(path.join(reportDir, "logs"));
    await ensureDir(path.join(reportDir, "screenshots", "desktop"));
    await ensureDir(path.join(reportDir, "screenshots", "mobile"));
    await ensureDir(path.join(reportDir, "diffs", "desktop"));
    await ensureDir(path.join(reportDir, "diffs", "mobile"));
    await ensureDir(path.join(reportDir, "a11y"));

    console.log(`Audit 360 base URL: ${baseUrl}`);
    console.log(`Report directory: ${reportDir}`);

    await runQualitySuite();
    await runSecurityAudit();
    await runSeoChecks();
    await runBrowserAudits();
    await runLighthouseAudits();
    await runStrategicDesignAudit();

    const score = scoreByPillar();
    const summary = {
        baseUrl,
        runTs,
        checks,
        findingsCount: findings.length,
        findingsBySeverity: {
            high: findings.filter((f) => f.severity === "high").length,
            medium: findings.filter((f) => f.severity === "medium").length,
            low: findings.filter((f) => f.severity === "low").length,
            info: findings.filter((f) => f.severity === "info").length,
        },
        scores: score.scores,
        overall: score.overall,
        strategic: {
            lensScores: strategicAudit.lensScores,
            reformBacklogCount: strategicAudit.reformBacklog.length,
            roadmap: strategicAudit.roadmap,
        },
    };

    await writeJson(path.join(reportDir, "findings.json"), findingsBySeverity());
    await writeJson(path.join(reportDir, "summary.json"), summary);
    await writeFile(path.join(reportDir, "summary.env"), `run_ts=${runTs}\noverall_score=${score.overall}\nfindings=${findings.length}\n`);
    artifacts.push(path.join(reportDir, "findings.json"));
    artifacts.push(path.join(reportDir, "summary.json"));
    artifacts.push(path.join(reportDir, "summary.env"));

    const markdown = await renderMarkdown(score);
    const reportPath = path.join(reportDir, "audit360-report.md");
    await writeFile(reportPath, markdown);
    artifacts.push(reportPath);

    console.log(`Audit 360 completed. Overall score: ${score.overall}/100`);
    console.log(`Findings: ${findings.length} (high=${summary.findingsBySeverity.high}, medium=${summary.findingsBySeverity.medium}, low=${summary.findingsBySeverity.low})`);
    console.log(`Report: ${reportPath}`);
}

main().catch((err) => {
    console.error("Audit 360 FAILED:", err?.stack ?? err?.message ?? err);
    process.exit(1);
});
