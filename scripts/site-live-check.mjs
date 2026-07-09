#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://espacofacial.com";
const DEFAULT_EXPECTED_CAMPAIGN = "aniversario-7-anos-2026";
const DEFAULT_ABSENT_PATTERN = "Marina|dramarinalima";

const args = new Set(process.argv.slice(2));
const summaryMode = args.has("--summary");
const noFail = args.has("--no-fail");

const baseUrl = (process.env.SITE_LIVE_CHECK_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
const expectedBuild = (process.env.SITE_LIVE_CHECK_EXPECT_BUILD || "").trim();
const expectedCampaign = (process.env.SITE_LIVE_CHECK_EXPECT_CAMPAIGN || DEFAULT_EXPECTED_CAMPAIGN).trim();
const absentPattern = (process.env.SITE_LIVE_CHECK_ABSENT_PATTERN || DEFAULT_ABSENT_PATTERN).trim();

const redirectChecks = [
    {
        name: "long_bss_marina",
        url: `${baseUrl}/barrashoppingsul/dramarinalima`,
        expectedLocation: `${baseUrl}/barrashoppingsul`,
    },
    {
        name: "long_nh_marina",
        url: `${baseUrl}/novohamburgo/dramarinalima`,
        expectedLocation: `${baseUrl}/novohamburgo`,
    },
    {
        name: "short_bss_marina",
        url: "https://esfa.co/bss/dramarinalima",
        expectedLocation: `${baseUrl}/barrashoppingsul`,
    },
    {
        name: "short_nh_marina",
        url: "https://esfa.co/nh/dramarinalima",
        expectedLocation: `${baseUrl}/novohamburgo`,
    },
];

const results = [];

function record(ok, label, details) {
    results.push({ ok, label, details });
}

function normalizeUrl(value, base) {
    return new URL(value, base).toString();
}

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

function campaignFromItems(items) {
    const campaigns = new Set();
    for (const item of items) {
        const src = typeof item?.src === "string" ? item.src : "";
        const match = src.match(/\/images\/hero\/campaigns\/([^/]+)\//);
        if (match?.[1]) campaigns.add(match[1]);
    }
    return [...campaigns].sort();
}

async function readHeroVariant(variant) {
    const res = await fetchWithTimeout(`${baseUrl}/api/hero-media?variant=${encodeURIComponent(variant)}`);
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`/api/hero-media?variant=${variant} returned ${res.status}: ${text.slice(0, 160)}`);
    }
    const payload = JSON.parse(text);
    const items = Array.isArray(payload.items) ? payload.items : [];
    const campaigns = campaignFromItems(items);
    return { items, campaigns };
}

async function checkHomeBuild() {
    const res = await fetchWithTimeout(`${baseUrl}/`, { method: "HEAD", redirect: "manual" });
    const build = (res.headers.get("x-app-build") || "").trim();
    const buildTime = (res.headers.get("x-app-build-time") || "").trim();
    record(res.status === 200, "home_status", `${res.status}`);
    record(Boolean(build), "x_app_build_present", build || "(empty)");
    if (expectedBuild) {
        record(build === expectedBuild, "x_app_build_expected", `expected=${expectedBuild} actual=${build || "(empty)"}`);
    }
    return { build, buildTime };
}

async function checkHeroMedia() {
    for (const variant of ["desktop", "mobile"]) {
        const { items, campaigns } = await readHeroVariant(variant);
        record(items.length > 0, `hero_${variant}_items`, `count=${items.length}`);
        record(campaigns.length === 1, `hero_${variant}_single_campaign`, campaigns.join(",") || "(none)");
        if (expectedCampaign) {
            record(
                campaigns.includes(expectedCampaign),
                `hero_${variant}_expected_campaign`,
                `expected=${expectedCampaign} actual=${campaigns.join(",") || "(none)"}`,
            );
        }
    }
}

async function checkEquipe() {
    const res = await fetchWithTimeout(`${baseUrl}/api/equipe`);
    const text = await res.text();
    record(res.status === 200, "equipe_status", `${res.status}`);
    if (absentPattern) {
        const re = new RegExp(absentPattern, "i");
        record(!re.test(text), "equipe_absent_pattern", absentPattern);
    }
}

async function checkRedirects() {
    for (const check of redirectChecks) {
        const res = await fetchWithTimeout(check.url, { method: "HEAD", redirect: "manual" });
        const location = res.headers.get("location") || "";
        const actual = location ? normalizeUrl(location, check.url) : "";
        const expected = normalizeUrl(check.expectedLocation, check.url);
        record([301, 302, 307, 308].includes(res.status), `${check.name}_status`, `${res.status}`);
        record(actual === expected, `${check.name}_location`, `expected=${expected} actual=${actual || "(empty)"}`);
    }
}

function printResults(buildInfo) {
    if (summaryMode) {
        const failed = results.filter((result) => !result.ok);
        console.log(`site_live_check=${failed.length ? "FAIL" : "OK"}`);
        console.log(`site_build=${buildInfo.build || "(empty)"}`);
        console.log(`site_build_time=${buildInfo.buildTime || "(empty)"}`);
        for (const result of results) {
            if (result.label.includes("hero_") || result.label.includes("short_") || result.label === "equipe_absent_pattern") {
                console.log(`${result.ok ? "OK" : "FAIL"} ${result.label}: ${result.details}`);
            }
        }
        return;
    }

    console.log(`Site live check: ${baseUrl}`);
    console.log(`Expected campaign: ${expectedCampaign || "(not enforced)"}`);
    console.log(`Absent equipe pattern: ${absentPattern || "(not enforced)"}`);
    for (const result of results) {
        console.log(`${result.ok ? "OK  " : "FAIL"} ${result.label}: ${result.details}`);
    }
}

async function main() {
    const buildInfo = await checkHomeBuild();
    await checkHeroMedia();
    await checkEquipe();
    await checkRedirects();
    printResults(buildInfo);

    if (results.some((result) => !result.ok) && !noFail) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(`site-live-check failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!noFail) process.exitCode = 1;
});
