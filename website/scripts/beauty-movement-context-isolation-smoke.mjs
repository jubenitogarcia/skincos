import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,180}$/;
const CONTEXT_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const INVITE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/;
const ROUTES = ["/beleza-em-movimento", "/BelezaEmMovimento"];
const LEGACY_COOKIE = "ef_beauty_movement_session";
const pageDiagnostics = new WeakMap();

function fail(code, details = {}) {
  const safe = Object.fromEntries(
    Object.entries(details).filter(([, value]) => (
      typeof value === "number"
      || typeof value === "boolean"
      || (typeof value === "string" && !TOKEN_PATTERN.test(value) && !value.includes("#c="))
    )),
  );
  throw new Error(`${code}:${JSON.stringify(safe)}`);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) fail("beauty_movement_isolation_smoke_args_invalid");
    values.set(key.slice(2), value);
  }
  const baseUrl = values.get("base-url");
  const deliveryDirectory = values.get("delivery-directory");
  const evidenceFile = values.get("evidence-file");
  if (!baseUrl || !deliveryDirectory || !evidenceFile) fail("beauty_movement_isolation_smoke_args_missing");
  const parsedBase = new URL(baseUrl);
  if (!["https:", "http:"].includes(parsedBase.protocol) || parsedBase.pathname !== "/") {
    fail("beauty_movement_isolation_smoke_base_invalid");
  }
  return {
    baseUrl: parsedBase.origin,
    deliveryDirectory: path.resolve(deliveryDirectory),
    evidenceFile: path.resolve(evidenceFile),
  };
}

export function parseCsvRow(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        current += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      cells.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (quoted) fail("beauty_movement_isolation_smoke_csv_quote_invalid");
  cells.push(current);
  return cells;
}

export function readSyntheticInvites(deliveryDirectory) {
  const files = fs.readdirSync(deliveryDirectory).filter((name) => name.endsWith("-delivery.csv"));
  if (files.length !== 1) fail("beauty_movement_isolation_smoke_delivery_count_invalid", { count: files.length });
  const lines = fs.readFileSync(path.join(deliveryDirectory, files[0]), "utf8").trim().split(/\r?\n/);
  const header = parseCsvRow(lines[0] ?? "").join(",");
  if (header !== "name,invite_ref,whatsapp,invite_url") fail("beauty_movement_isolation_smoke_delivery_header_invalid");
  const rows = lines.slice(1).map((line) => {
    const [name, inviteRef, , inviteUrl] = parseCsvRow(line);
    if (!name || !INVITE_REF_PATTERN.test(inviteRef ?? "")) fail("beauty_movement_isolation_smoke_delivery_row_invalid");
    let parsed;
    try {
      parsed = new URL(inviteUrl);
    } catch {
      fail("beauty_movement_isolation_smoke_invite_url_invalid");
    }
    const token = new URLSearchParams(parsed.hash.slice(1)).get("c");
    if (!TOKEN_PATTERN.test(token ?? "") || !ROUTES.some((route) => parsed.pathname.toLowerCase() === route.toLowerCase())) {
      fail("beauty_movement_isolation_smoke_invite_shape_invalid");
    }
    return { name, inviteRef, token };
  });
  const byName = (name) => {
    const row = rows.find((candidate) => candidate.name === name);
    if (!row) fail("beauty_movement_isolation_smoke_fixture_missing", { name });
    return row;
  };
  const selected = {
    primary: byName("Beauty Movement Smoke Primary"),
    a: byName("Beauty Movement Isolation A"),
    b: byName("Beauty Movement Isolation B"),
    expired: byName("Beauty Movement Isolation Expired"),
  };
  if (new Set(Object.values(selected).map((invite) => invite.inviteRef)).size !== 4) {
    fail("beauty_movement_isolation_smoke_invite_ref_collision");
  }
  if (new Set(Object.values(selected).map((invite) => invite.token)).size !== 4) {
    fail("beauty_movement_isolation_smoke_token_collision");
  }
  return selected;
}

function attachDiagnostics(page) {
  const diagnostics = {
    consoleErrors: 0,
    pageErrors: 0,
    apiFailures: 0,
    apiResponses: 0,
    revealRequests: 0,
    whatsappRequests: 0,
    checkpointApiFailures: 0,
    checkpointApiResponses: 0,
    checkpointLastApiStatus: 0,
    checkpointLastApiOperation: "none",
    checkpointLastApiTransportFailure: false,
  };
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors += 1;
  });
  page.on("pageerror", () => {
    diagnostics.pageErrors += 1;
  });
  page.on("requestfailed", (request) => {
    try {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/api/beleza-em-movimento/")) {
        diagnostics.apiFailures += 1;
        diagnostics.checkpointApiFailures += 1;
        diagnostics.checkpointLastApiStatus = 0;
        diagnostics.checkpointLastApiOperation = pathname.split("/").at(-1) ?? "unknown";
        diagnostics.checkpointLastApiTransportFailure = true;
      }
    } catch {
      // Ignore malformed third-party URLs; no value is retained.
    }
  });
  page.on("response", (response) => {
    try {
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith("/api/beleza-em-movimento/")) {
        diagnostics.apiResponses += 1;
        diagnostics.checkpointApiResponses += 1;
        diagnostics.checkpointLastApiStatus = response.status();
        diagnostics.checkpointLastApiOperation = pathname.split("/").at(-1) ?? "unknown";
        diagnostics.checkpointLastApiTransportFailure = false;
      }
    } catch {
      // No URL is retained in evidence.
    }
  });
  page.on("request", (request) => {
    const requestUrl = request.url();
    if (request.method() === "POST" && requestUrl.includes("/api/beleza-em-movimento/reveal")) {
      diagnostics.revealRequests += 1;
    }
    if (/^https:\/\/(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//i.test(requestUrl)) {
      diagnostics.whatsappRequests += 1;
    }
  });
  pageDiagnostics.set(page, diagnostics);
  return diagnostics;
}

function resetCheckpointDiagnostics(page) {
  const diagnostics = pageDiagnostics.get(page);
  if (!diagnostics) return;
  diagnostics.checkpointApiFailures = 0;
  diagnostics.checkpointApiResponses = 0;
  diagnostics.checkpointLastApiStatus = 0;
  diagnostics.checkpointLastApiOperation = "none";
  diagnostics.checkpointLastApiTransportFailure = false;
}

function checkpointDiagnosticsSnapshot(page) {
  const diagnostics = pageDiagnostics.get(page) ?? {};
  return {
    apiResponses: diagnostics.checkpointApiResponses ?? 0,
    apiFailures: diagnostics.checkpointApiFailures ?? 0,
    lastApiStatus: diagnostics.checkpointLastApiStatus ?? 0,
    lastApiOperation: diagnostics.checkpointLastApiOperation ?? "none",
    lastApiTransportFailure: diagnostics.checkpointLastApiTransportFailure ?? false,
    consoleErrors: diagnostics.consoleErrors ?? 0,
    pageErrors: diagnostics.pageErrors ?? 0,
  };
}

function failAtCheckpoint(page, code, checkpoint, details = {}) {
  fail(code, {
    checkpoint,
    ...details,
    ...checkpointDiagnosticsSnapshot(page),
  });
}

async function contextRef(page, checkpoint = "context-ref") {
  let value = null;
  try {
    value = await page.evaluate(() => history.state?.__efBeautyMovementContextRef ?? null);
  } catch {
    failAtCheckpoint(page, "beauty_movement_isolation_smoke_context_missing", checkpoint, {
      phase: "read",
    });
  }
  if (!CONTEXT_PATTERN.test(value ?? "")) {
    failAtCheckpoint(page, "beauty_movement_isolation_smoke_context_missing", checkpoint, {
      phase: "validation",
    });
  }
  return value;
}

async function assertScrubbed(page, checkpoint) {
  const result = await page.evaluate(() => {
    let inviteStorage = null;
    try {
      inviteStorage = window.sessionStorage.getItem("ef:beauty-movement:invite");
    } catch {
      inviteStorage = null;
    }
    return {
      hashEmpty: window.location.hash === "",
      tokenAbsentFromUrl: !window.location.href.includes("#c="),
      inviteStorageEmpty: inviteStorage === null,
    };
  });
  if (!result.hashEmpty || !result.tokenAbsentFromUrl || !result.inviteStorageEmpty) {
    failAtCheckpoint(page, "beauty_movement_isolation_smoke_handoff_not_scrubbed", checkpoint, result);
  }
}

async function reportFreshCheckpointFailure(page, checkpoint, phase) {
  const state = await page.evaluate(() => ({
    pathname: window.location.pathname,
    historyLength: window.history.length,
    hasContextRef: typeof window.history.state?.__efBeautyMovementContextRef === "string",
    documentVisible: document.visibilityState === "visible",
    deckButtonCount: document.querySelectorAll('button[aria-label*="Clique no baralho"]').length,
    busyRegionCount: document.querySelectorAll('[aria-busy="true"]').length,
  })).catch(() => ({ stateUnavailable: true }));
  fail("beauty_movement_isolation_smoke_fresh_checkpoint_failure", {
    checkpoint,
    phase,
    ...state,
    ...checkpointDiagnosticsSnapshot(page),
  });
}

async function navigateAtCheckpoint(page, checkpoint, navigate) {
  resetCheckpointDiagnostics(page);
  try {
    await navigate();
  } catch {
    await reportFreshCheckpointFailure(page, checkpoint, "navigation");
  }
}

async function waitFresh(page, checkpoint) {
  const deck = page.getByRole("button", { name: /Clique no baralho para começar a sua leitura/i });
  try {
    await deck.waitFor({ state: "visible", timeout: 60_000 });
  } catch {
    await reportFreshCheckpointFailure(page, checkpoint, "freshness");
  }
  await assertScrubbed(page, checkpoint);
}

async function readJourneyState(page) {
  return page.evaluate(() => {
    const table = document.querySelector("[data-hand-stage]");
    return {
      motionNoPreference: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      documentVisible: document.visibilityState === "visible",
      handStage: table?.getAttribute("data-hand-stage") ?? "missing",
      actIndex: Number(table?.getAttribute("data-act-index") ?? -1),
      finaleStage: table?.getAttribute("data-finale-stage") ?? "missing",
      revealButtonCount: Array.from(document.querySelectorAll("button[aria-label]"))
        .filter((button) => button.getAttribute("aria-label")?.startsWith("Revelar carta ")).length,
      selectedCardCount: document.querySelectorAll('button[aria-pressed="true"]').length,
      busyRegionCount: document.querySelectorAll('[aria-busy="true"]').length,
    };
  });
}

async function waitAct(page, act, checkpoint = "act-transition") {
  try {
    await page.getByRole("button", { name: `Revelar carta 1 de ${act}`, exact: true })
      .waitFor({ state: "visible", timeout: 60_000 });
  } catch {
    const state = await readJourneyState(page).catch(() => ({ stateUnavailable: true }));
    fail("beauty_movement_isolation_smoke_act_timeout", {
      checkpoint,
      expectedAct: act,
      ...state,
      ...checkpointDiagnosticsSnapshot(page),
    });
  }
  await assertScrubbed(page, checkpoint);
}

async function openInvite(page, baseUrl, invite, route, expectedAct = null, checkpoint = "open-invite") {
  if (!ROUTES.includes(route)) fail("beauty_movement_isolation_smoke_route_invalid");
  await navigateAtCheckpoint(page, checkpoint, () => (
    page.goto(`${baseUrl}${route}#c=${encodeURIComponent(invite.token)}`, { waitUntil: "domcontentloaded" })
  ));
  if (expectedAct) await waitAct(page, expectedAct, checkpoint);
  else await waitFresh(page, checkpoint);
  return contextRef(page, checkpoint);
}

async function revealAndAdvance(page, currentAct, nextAct, checkpoint) {
  resetCheckpointDiagnostics(page);
  const card = page.getByRole("button", {
    name: `Revelar carta 1 de ${currentAct}`,
    exact: true,
  });
  try {
    await card.waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    failAtCheckpoint(page, "beauty_movement_isolation_smoke_reveal_failed", checkpoint, {
      phase: "button",
      status: 0,
    });
  }
  let response;
  try {
    [response] = await Promise.all([
      page.waitForResponse((candidate) => {
        const url = new URL(candidate.url());
        return candidate.request().method() === "POST" && url.pathname === "/api/beleza-em-movimento/reveal";
      }, { timeout: 30_000 }),
      card.click(),
    ]);
  } catch {
    failAtCheckpoint(page, "beauty_movement_isolation_smoke_reveal_failed", checkpoint, {
      phase: "request",
      status: 0,
    });
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Status and the public ok flag are both required below.
  }
  if (!response.ok() || payload?.ok !== true) {
    failAtCheckpoint(page, "beauty_movement_isolation_smoke_reveal_failed", checkpoint, {
      phase: "response",
      status: response.status(),
    });
  }
  try {
    await page.locator('button[aria-pressed="true"]').waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    failAtCheckpoint(page, "beauty_movement_isolation_smoke_reveal_failed", checkpoint, {
      phase: "selection",
      status: response.status(),
    });
  }
  await page.waitForTimeout(5_600);
  await waitAct(page, nextAct, checkpoint);
}

async function reloadAt(page, act, checkpoint) {
  await navigateAtCheckpoint(page, checkpoint, () => page.reload({ waitUntil: "domcontentloaded" }));
  await waitAct(page, act, checkpoint);
}

async function expectFailClosed(page, target, checkpoint) {
  await navigateAtCheckpoint(page, checkpoint, () => page.goto(target, { waitUntil: "domcontentloaded" }));
  try {
    await page.waitForFunction(() => {
      const normalized = window.location.pathname.replace(/\/+$/, "") || "/";
      return normalized !== "/beleza-em-movimento" && normalized.toLowerCase() !== "/belezaemmovimento";
    }, { timeout: 60_000 });
  } catch {
    failAtCheckpoint(page, "beauty_movement_isolation_smoke_fail_closed_invalid", checkpoint, {
      phase: "redirect",
    });
  }
  const result = await page.evaluate(() => ({
    hashEmpty: window.location.hash === "",
    campaignBusy: document.querySelectorAll('[aria-busy="true"]').length,
    campaignDeck: document.querySelectorAll('button[aria-label*="Clique no baralho"]').length,
  }));
  if (!result.hashEmpty || result.campaignBusy !== 0 || result.campaignDeck !== 0) {
    failAtCheckpoint(page, "beauty_movement_isolation_smoke_fail_closed_invalid", checkpoint, {
      phase: "validation",
      ...result,
    });
  }
}

function assertDiagnostics(label, diagnostics, options = {}) {
  const allowApiFailures = options.allowApiFailures === true;
  if (
    diagnostics.consoleErrors !== 0
    || diagnostics.pageErrors !== 0
    || diagnostics.whatsappRequests !== 0
    || (!allowApiFailures && diagnostics.apiFailures !== 0)
  ) {
    fail("beauty_movement_isolation_smoke_browser_error", {
      label,
      consoleErrors: diagnostics.consoleErrors,
      pageErrors: diagnostics.pageErrors,
      apiFailures: diagnostics.apiFailures,
      whatsappRequests: diagnostics.whatsappRequests,
    });
  }
}

async function run() {
  const { baseUrl, deliveryDirectory, evidenceFile } = parseArgs(process.argv.slice(2));
  const invites = readSyntheticInvites(deliveryDirectory);
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true, mode: 0o700 });

  const browser = await chromium.launch({ headless: true });
  try {
    const shared = await browser.newContext();
    const pageA = await shared.newPage();
    const diagnosticsA = attachDiagnostics(pageA);

    const firstContextA = await openInvite(pageA, baseUrl, invites.a, ROUTES[0], null, "initial-a");
    await pageA.getByRole("button", { name: /Clique no baralho para começar a sua leitura/i }).click();
    await revealAndAdvance(pageA, "Beleza", "Movimento", "advance-a-beleza-to-movimento");
    await reloadAt(pageA, "Movimento", "reload-a-movement");

    const firstContextB = await openInvite(pageA, baseUrl, invites.b, ROUTES[0], null, "switch-a-to-b");
    if (firstContextA === firstContextB) {
      failAtCheckpoint(pageA, "beauty_movement_isolation_smoke_context_collision", "switch-a-to-b");
    }

    const pageB = await shared.newPage();
    const diagnosticsB = attachDiagnostics(pageB);
    const secondContextB = await openInvite(pageB, baseUrl, invites.b, ROUTES[1], null, "parallel-b");
    if (secondContextB === firstContextA || secondContextB === firstContextB) {
      failAtCheckpoint(pageB, "beauty_movement_isolation_smoke_session_context_reused", "parallel-b");
    }

    await navigateAtCheckpoint(pageA, "back-a", () => pageA.goBack());
    await waitAct(pageA, "Movimento", "back-a");
    if (await contextRef(pageA, "back-a") !== firstContextA) {
      failAtCheckpoint(pageA, "beauty_movement_isolation_smoke_back_restored_wrong_context", "back-a");
    }
    await navigateAtCheckpoint(pageA, "forward-b", () => pageA.goForward());
    await waitFresh(pageA, "forward-b");
    if (await contextRef(pageA, "forward-b") !== firstContextB) {
      failAtCheckpoint(pageA, "beauty_movement_isolation_smoke_forward_restored_wrong_context", "forward-b");
    }

    await navigateAtCheckpoint(pageA, "back-a-final", () => pageA.goBack());
    await waitAct(pageA, "Movimento", "back-a-final");
    await revealAndAdvance(pageA, "Movimento", "Celebração", "advance-a-movimento-to-celebracao");
    await revealAndAdvance(pageB, "Beleza", "Movimento", "advance-b-beleza-to-movimento");

    await Promise.all([
      reloadAt(pageA, "Celebração", "simultaneous-reload-a"),
      reloadAt(pageB, "Movimento", "simultaneous-reload-b"),
    ]);
    if (await contextRef(pageA, "simultaneous-reload-a") !== firstContextA) {
      failAtCheckpoint(
        pageA,
        "beauty_movement_isolation_smoke_simultaneous_reload_context_changed",
        "simultaneous-reload-a",
      );
    }
    if (await contextRef(pageB, "simultaneous-reload-b") !== secondContextB) {
      failAtCheckpoint(
        pageB,
        "beauty_movement_isolation_smoke_simultaneous_reload_context_changed",
        "simultaneous-reload-b",
      );
    }

    const reopenedA = await shared.newPage();
    const diagnosticsReopenedA = attachDiagnostics(reopenedA);
    await openInvite(reopenedA, baseUrl, invites.a, ROUTES[0], "Celebração", "reopen-a");
    const reopenedB = await shared.newPage();
    const diagnosticsReopenedB = attachDiagnostics(reopenedB);
    await openInvite(reopenedB, baseUrl, invites.b, ROUTES[1], "Movimento", "reopen-b");

    const privateContext = await browser.newContext();
    const privatePage = await privateContext.newPage();
    const diagnosticsPrivate = attachDiagnostics(privatePage);
    await openInvite(privatePage, baseUrl, invites.primary, ROUTES[0], null, "private-primary");
    await navigateAtCheckpoint(privatePage, "private-reload", () => privatePage.reload({ waitUntil: "domcontentloaded" }));
    await waitFresh(privatePage, "private-reload");

    // The public exchange limiter allows six attempts per source IP and
    // minute. Phase one intentionally consumes exactly six exchanges. Waiting
    // for the next fixed window keeps the smoke representative without adding
    // a bypass that production users would not have.
    await pageA.waitForTimeout(61_000);

    const storageUnavailable = await browser.newContext();
    await storageUnavailable.addInitScript(() => {
      Object.defineProperty(window, "sessionStorage", {
        configurable: true,
        get() {
          throw new DOMException("Unavailable", "SecurityError");
        },
      });
    });
    const storagePage = await storageUnavailable.newPage();
    const diagnosticsStorage = attachDiagnostics(storagePage);
    await openInvite(storagePage, baseUrl, invites.primary, ROUTES[1], null, "storage-unavailable");
    await navigateAtCheckpoint(storagePage, "storage-reload", () => storagePage.reload({ waitUntil: "domcontentloaded" }));
    await waitFresh(storagePage, "storage-reload");

    const racePage = await shared.newPage();
    const diagnosticsRace = attachDiagnostics(racePage);
    await openInvite(racePage, baseUrl, invites.a, ROUTES[0], "Celebração", "race-seed-a");
    resetCheckpointDiagnostics(racePage);
    await racePage.evaluate(({ tokenB, tokenA }) => {
      window.location.hash = `c=${tokenB}`;
      window.setTimeout(() => {
        window.location.hash = `c=${tokenA}`;
      }, 50);
    }, { tokenB: invites.b.token, tokenA: invites.a.token });
    await waitAct(racePage, "Celebração", "hash-race-b-to-a");
    await assertScrubbed(racePage, "hash-race-b-to-a");

    await shared.addCookies([{
      name: LEGACY_COOKIE,
      value: "l".repeat(43),
      url: `${baseUrl}/`,
      httpOnly: true,
      secure: baseUrl.startsWith("https:"),
      sameSite: "Lax",
    }]);
    const expiredPage = await shared.newPage();
    const diagnosticsExpired = attachDiagnostics(expiredPage);
    await expectFailClosed(
      expiredPage,
      `${baseUrl}${ROUTES[0]}#c=${encodeURIComponent(invites.expired.token)}`,
      "expired-invite",
    );
    const legacyAfterExpired = (await shared.cookies(baseUrl)).some((cookie) => cookie.name === LEGACY_COOKIE);
    if (legacyAfterExpired) fail("beauty_movement_isolation_smoke_legacy_cookie_not_cleared");

    const invalidPage = await shared.newPage();
    const diagnosticsInvalid = attachDiagnostics(invalidPage);
    await expectFailClosed(invalidPage, `${baseUrl}${ROUTES[1]}#c=invalid`, "invalid-invite");
    const directPage = await shared.newPage();
    const diagnosticsDirect = attachDiagnostics(directPage);
    await expectFailClosed(directPage, `${baseUrl}${ROUTES[0]}`, "direct-entry");

    const sharedCookies = await shared.cookies(`${baseUrl}/api/beleza-em-movimento/state`);
    const cookieA = sharedCookies.find((cookie) => cookie.name === `ef_bm_ctx_${firstContextA}`);
    if (!cookieA || !cookieA.httpOnly) fail("beauty_movement_isolation_smoke_http_only_cookie_missing");
    const mismatchContext = await browser.newContext();
    await mismatchContext.addCookies([{
      name: cookieA.name,
      value: cookieA.value,
      domain: cookieA.domain,
      path: cookieA.path,
      httpOnly: true,
      secure: cookieA.secure,
      sameSite: "Lax",
      expires: cookieA.expires,
    }, {
      // A credential copied under B's selector must not authorize B. This is
      // stronger than only sending B's selector alongside A's cookie name.
      name: `ef_bm_ctx_${secondContextB}`,
      value: cookieA.value,
      domain: cookieA.domain,
      path: cookieA.path,
      httpOnly: true,
      secure: cookieA.secure,
      sameSite: "Lax",
      expires: cookieA.expires,
    }]);
    const mismatchPage = await mismatchContext.newPage();
    await mismatchPage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    const authorization = await mismatchPage.evaluate(async ({ refA, refB }) => {
      const call = async (contextRef) => {
        const response = await fetch("/api/beleza-em-movimento/state", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { "X-Beauty-Movement-Context": contextRef },
        });
        return response.status;
      };
      return { matching: await call(refA), mismatched: await call(refB) };
    }, { refA: firstContextA, refB: secondContextB });
    if (authorization.matching !== 200 || authorization.mismatched !== 404) {
      fail("beauty_movement_isolation_smoke_authorization_invalid", authorization);
    }

    const diagnostics = [
      ["a", diagnosticsA],
      ["b", diagnosticsB],
      ["reopened-a", diagnosticsReopenedA],
      ["reopened-b", diagnosticsReopenedB],
      ["private", diagnosticsPrivate],
      ["storage", diagnosticsStorage],
      ["expired", diagnosticsExpired],
      ["invalid", diagnosticsInvalid],
      ["direct", diagnosticsDirect],
    ];
    for (const [label, value] of diagnostics) assertDiagnostics(label, value);
    assertDiagnostics("race", diagnosticsRace, { allowApiFailures: true });

    const evidence = {
      version: 1,
      browser: true,
      syntheticInvitesDistinct: true,
      sameTabStartsFresh: true,
      twoPagesSameContextIndependent: true,
      simultaneousReloadStable: true,
      reopenPersonalizedLinksStable: true,
      canonicalAndAliasEquivalent: true,
      backForwardStable: true,
      rapidSwitchLastNavigationWins: true,
      privateContextStable: true,
      exchangeRateLimitWindowRespected: true,
      storageUnavailableStable: true,
      invalidTokenFailsClosed: true,
      expiredTokenFailsClosed: true,
      fragmentlessRouteFailsClosed: true,
      crossContextAuthorizationRejected: true,
      crossCookieCredentialRejected: true,
      legacyCookieCleared: true,
      rawTokensPersistedInEvidence: false,
      whatsappRequests: 0,
      consoleErrors: 0,
      revealCounts: { a: diagnosticsA.revealRequests, b: diagnosticsB.revealRequests },
      inviteRefs: {
        a: invites.a.inviteRef,
        b: invites.b.inviteRef,
        expired: invites.expired.inviteRef,
      },
    };
    fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });

    await Promise.all([
      mismatchContext.close(),
      storageUnavailable.close(),
      privateContext.close(),
      shared.close(),
    ]);
  } finally {
    await browser.close();
  }
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
export function redactBeautyMovementSmokeError(message) {
  const redactDetails = (value) => value
    .replace(/#c=[A-Za-z0-9_-]+/g, "#c=[redacted]")
    .replace(/[A-Za-z0-9_-]{40,180}/g, "[opaque]");
  if (/^beauty_movement_[a-z0-9_]+$/i.test(message)) return message;
  const separator = message.indexOf(":");
  const code = separator >= 0 ? message.slice(0, separator) : "";
  if (/^beauty_movement_[a-z0-9_]+$/i.test(code)) {
    return `${code}:${redactDetails(message.slice(separator + 1))}`;
  }
  return redactDetails(message);
}

if (isDirectExecution) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : "beauty_movement_isolation_smoke_failed";
    console.error(redactBeautyMovementSmokeError(message));
    process.exitCode = 1;
  });
}
