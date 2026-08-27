import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  readSyntheticInvites,
  redactBeautyMovementSmokeError,
} from "./beauty-movement-context-isolation-smoke.mjs";

const CONTEXT_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

function fail(code, details = {}) {
  const safe = Object.fromEntries(
    Object.entries(details).filter(([, value]) => (
      typeof value === "number"
      || typeof value === "boolean"
      || (typeof value === "string" && value.length < 80 && !value.includes("#c="))
    )),
  );
  throw new Error(`${code}:${JSON.stringify(safe)}`);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) fail("beauty_movement_primary_smoke_args_invalid");
    values.set(key.slice(2), value);
  }
  const baseUrl = values.get("base-url");
  const deliveryDirectory = values.get("delivery-directory");
  const evidenceFile = values.get("evidence-file");
  if (!baseUrl || !deliveryDirectory || !evidenceFile) fail("beauty_movement_primary_smoke_args_missing");
  const parsedBase = new URL(baseUrl);
  if (!['https:', 'http:'].includes(parsedBase.protocol) || parsedBase.pathname !== "/") {
    fail("beauty_movement_primary_smoke_base_invalid");
  }
  return {
    baseUrl: parsedBase.origin,
    deliveryDirectory: path.resolve(deliveryDirectory),
    evidenceFile: path.resolve(evidenceFile),
  };
}

async function run() {
  const { baseUrl, deliveryDirectory, evidenceFile } = parseArgs(process.argv.slice(2));
  const { primary } = readSyntheticInvites(deliveryDirectory);
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true, mode: 0o700 });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const diagnostics = {
      consoleErrors: 0,
      pageErrors: 0,
      failedApiRequests: 0,
      whatsappRequests: 0,
      revealRequests: 0,
      confirmRequests: 0,
    };

    page.on("console", (message) => {
      if (message.type() === "error") diagnostics.consoleErrors += 1;
    });
    page.on("pageerror", () => {
      diagnostics.pageErrors += 1;
    });
    page.on("requestfailed", (request) => {
      try {
        if (new URL(request.url()).pathname.startsWith("/api/beleza-em-movimento/")) {
          diagnostics.failedApiRequests += 1;
        }
      } catch {
        // Third-party request details are intentionally not retained.
      }
    });
    page.on("request", (request) => {
      const requestUrl = request.url();
      if (request.method() === "POST" && requestUrl.includes("/api/beleza-em-movimento/reveal")) {
        diagnostics.revealRequests += 1;
      }
      if (request.method() === "POST" && requestUrl.includes("/api/beleza-em-movimento/confirm")) {
        diagnostics.confirmRequests += 1;
      }
      if (/^https:\/\/(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//i.test(requestUrl)) {
        diagnostics.whatsappRequests += 1;
      }
    });

    await page.goto(
      `${baseUrl}/beleza-em-movimento#c=${encodeURIComponent(primary.token)}`,
      { waitUntil: "domcontentloaded" },
    );
    const deck = page.getByRole("button", { name: /Clique no baralho para começar a sua leitura/i });
    await deck.waitFor({ state: "visible", timeout: 60_000 });

    const bootstrap = await page.evaluate(() => {
      let inviteStorage = null;
      try {
        inviteStorage = window.sessionStorage.getItem("ef:beauty-movement:invite");
      } catch {
        inviteStorage = null;
      }
      return {
        hashEmpty: window.location.hash === "",
        inviteStorageEmpty: inviteStorage === null,
        contextRef: history.state?.__efBeautyMovementContextRef ?? null,
      };
    });
    if (!bootstrap.hashEmpty || !bootstrap.inviteStorageEmpty || !CONTEXT_PATTERN.test(bootstrap.contextRef ?? "")) {
      fail("beauty_movement_primary_smoke_bootstrap_invalid", {
        hashEmpty: bootstrap.hashEmpty,
        inviteStorageEmpty: bootstrap.inviteStorageEmpty,
        contextPresent: CONTEXT_PATTERN.test(bootstrap.contextRef ?? ""),
      });
    }

    const mutate = async (route, trigger) => {
      const responsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === "POST" && url.pathname === route;
      }, { timeout: 30_000 });
      await trigger();
      const response = await responsePromise;
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        // The status and public ok flag are validated below.
      }
      if (!response.ok() || payload?.ok !== true) {
        fail("beauty_movement_primary_smoke_mutation_failed", {
          confirm: route.endsWith("/confirm"),
          status: response.status(),
        });
      }
    };

    const reveal = async (actLabel) => {
      const card = page.getByRole("button", {
        name: `Revelar carta 1 de ${actLabel}`,
        exact: true,
      });
      await card.waitFor({ state: "visible", timeout: 30_000 });
      await mutate("/api/beleza-em-movimento/reveal", () => card.click());
      await page.locator('button[aria-pressed="true"]').waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForTimeout(5_600);
    };

    await deck.click();
    await reveal("Beleza");
    await reveal("Movimento");
    await reveal("Celebração");

    const specialReveal = page.getByRole("button", {
      name: /Clique aqui para revelar sua carta especial/i,
    });
    await specialReveal.waitFor({ state: "visible", timeout: 30_000 });
    if (await page.getByRole("checkbox").count() !== 0) {
      fail("beauty_movement_primary_smoke_obsolete_consent_present");
    }
    await mutate(
      "/api/beleza-em-movimento/confirm",
      () => specialReveal.click(),
    );

    const special = page.locator('article[aria-label^="Carta especial:"]');
    await special.waitFor({ state: "visible", timeout: 30_000 });
    const revealedFace = special.locator('div[class*="specialCardFront"]');
    await revealedFace.waitFor({ state: "visible", timeout: 30_000 });
    const beforeReload = (await revealedFace.innerText()).replace(/\s+/g, " ").trim();
    if (!/combinação|Elleva|Preenchimento|Restylane|Skinbooster|Diamond|Sculptra/i.test(beforeReload)) {
      fail("beauty_movement_primary_smoke_outcome_missing");
    }
    const whatsappAction = special.locator('a[href^="/api/whatsapp/redirect"]');
    if (await whatsappAction.count() !== 1 || await whatsappAction.getAttribute("data-tracking-skip") !== "true") {
      fail("beauty_movement_primary_smoke_whatsapp_cta_invalid");
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await special.waitFor({ state: "visible", timeout: 30_000 });
    await revealedFace.waitFor({ state: "visible", timeout: 30_000 });
    const afterReload = (await revealedFace.innerText()).replace(/\s+/g, " ").trim();
    const restoredContext = await page.evaluate(() => history.state?.__efBeautyMovementContextRef ?? null);
    if (
      beforeReload !== afterReload
      || !CONTEXT_PATTERN.test(restoredContext ?? "")
      || restoredContext !== bootstrap.contextRef
      || diagnostics.revealRequests !== 3
      || diagnostics.confirmRequests !== 1
      || diagnostics.whatsappRequests !== 0
      || diagnostics.consoleErrors !== 0
      || diagnostics.pageErrors !== 0
      || diagnostics.failedApiRequests !== 0
    ) {
      fail("beauty_movement_primary_smoke_evidence_invalid", {
        resultStable: beforeReload === afterReload,
        contextStable: restoredContext === bootstrap.contextRef,
        ...diagnostics,
      });
    }

    const evidence = {
      version: 1,
      browser: true,
      fragmentScrubbed: true,
      contextRestoredAfterReload: true,
      revealRequests: 3,
      confirmRequests: 1,
      outcomeVisible: true,
      whatsappCtaPresent: true,
      whatsappRequests: 0,
      consoleErrors: 0,
      rawTokensPersistedInEvidence: false,
      inviteRef: primary.inviteRef,
    };
    fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await context.close();
  } finally {
    await browser.close();
  }
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectExecution) {
  run().catch((error) => {
    console.error(redactBeautyMovementSmokeError(
      error instanceof Error ? error.message : "beauty_movement_primary_smoke_failed",
    ));
    process.exitCode = 1;
  });
}
