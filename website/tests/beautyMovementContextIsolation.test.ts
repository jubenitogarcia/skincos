import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
    bindBeautyMovementContextRef,
    clearBeautyMovementContextRef,
    consumeBeautyMovementInviteHandoff,
    parseBeautyMovementInviteFragment,
    readBeautyMovementContextRef,
} from "../src/lib/beautyMovementBrowserContext";
import {
    deriveBeautyMovementSessionContextRef,
    getBeautyMovementSessionCookieName,
    hashBeautyMovementSessionToken,
} from "../src/lib/beautyMovementSecurity";
import {
    buildBeautyMovementReleaseValidationMarker,
    extractStaticAssetPaths,
    parseWranglerJson,
} from "../scripts/beauty-movement-production-release-smoke.mjs";
import { redactBeautyMovementSmokeError } from "../scripts/beauty-movement-context-isolation-smoke.mjs";
import {
    buildBeautyMovementReleaseOwner,
    buildBeautyMovementSyntheticCampaignId,
    decideBeautyMovementRollback,
    readBeautyMovementReleaseCheckpoint,
    resolveBeautyMovementReleaseConclusion,
    type BeautyMovementReleaseCheckpoint,
} from "../scripts/beauty-movement-production-reconcile.mjs";

const sourceUrl = (relativePath: string) => new URL(`../${relativePath}`, import.meta.url);
const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as { load: (source: string) => unknown };

function assertEmbeddedBashParses(workflow: string): number {
    const lines = workflow.split(/\r?\n/);
    let blocks = 0;
    for (let index = 0; index < lines.length; index += 1) {
        if (!/^        run: \|$/.test(lines[index] ?? "")) continue;
        const block: string[] = [];
        for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
            const line = lines[cursor] ?? "";
            if (line && !line.startsWith("          ")) break;
            block.push(line.startsWith("          ") ? line.slice(10) : "");
        }
        const script = block.join("\n").replace(/\$\{\{[^}]+\}\}/g, "github_expression");
        const parsed = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
        assert.equal(parsed.status, 0, `embedded bash block ${blocks + 1} failed: ${parsed.stderr}`);
        blocks += 1;
    }
    return blocks;
}

test("campaign identity is selected explicitly per history entry instead of by a global cookie", async () => {
    const [campaign, layout, route, security] = await Promise.all([
        readFile(sourceUrl("src/components/BeautyMovementCampaign.tsx"), "utf8"),
        readFile(sourceUrl("src/app/layout.tsx"), "utf8"),
        readFile(sourceUrl("src/lib/beautyMovementRoute.ts"), "utf8"),
        readFile(sourceUrl("src/lib/beautyMovementSecurity.ts"), "utf8"),
    ]);

    assert.match(campaign, /X-Beauty-Movement-Context/);
    assert.match(campaign, /key=\{contextRef\}/);
    assert.match(campaign, /pageshow/);
    assert.match(campaign, /popstate/);
    assert.match(campaign, /AbortController/);
    assert.match(
        campaign,
        /const verified = await requestCampaignState\("\/api\/beleza-em-movimento\/state", \{\s*contextRef: exchange\.contextRef,/,
    );
    assert.match(campaign, /nextState = verified\.state/);
    assert.doesNotMatch(campaign, /nextState = exchange\.state/);
    assert.doesNotMatch(campaign, /initializedRef/);
    assert.match(layout, /ef:beauty-movement:handoff-attempt/);
    assert.match(layout, /beauty-movement-invite-handoff/);
    assert.match(layout, /delete nextState\.__efBeautyMovementContextRef/);
    assert.match(route, /getBeautyMovementSessionCredential/);
    assert.match(route, /clearBeautyMovementLegacySessionCookie/);
    assert.match(security, /deriveBeautyMovementSessionContextRef/);
    assert.match(security, /BEAUTY_MOVEMENT_CONTEXT_COOKIE_PREFIX/);
});

type FakeBrowser = {
    host: Window;
    history: {
        state: Record<string, unknown> | null;
        replaceState: (state: Record<string, unknown>) => void;
    };
    storage: Map<string, string>;
};

function fakeBrowser(options: {
    state?: Record<string, unknown> | null;
    storageThrows?: boolean;
    handoff?: { attempted: boolean; token: string | null };
} = {}): FakeBrowser {
    const storage = new Map<string, string>();
    const history = {
        state: options.state ?? null,
        replaceState(state: Record<string, unknown>) {
            this.state = state;
        },
    };
    const sessionStorage = {
        getItem(key: string) {
            if (options.storageThrows) throw new Error("storage_unavailable");
            return storage.get(key) ?? null;
        },
        setItem(key: string, value: string) {
            if (options.storageThrows) throw new Error("storage_unavailable");
            storage.set(key, value);
        },
        removeItem(key: string) {
            if (options.storageThrows) throw new Error("storage_unavailable");
            storage.delete(key);
        },
    };
    const host = {
        history,
        sessionStorage,
        location: { pathname: "/BelezaEmMovimento", search: "" },
        __efBeautyMovementInviteHandoff: options.handoff,
    } as unknown as Window;
    return { host, history, storage };
}

test("history entries keep independent invite contexts and can be restored safely", () => {
    const browser = fakeBrowser();
    const contextA = "a".repeat(43);
    const contextB = "b".repeat(43);

    bindBeautyMovementContextRef(contextA, browser.host);
    const entryA = structuredClone(browser.history.state);
    assert.equal(readBeautyMovementContextRef(browser.host), contextA);

    browser.history.state = { unrelated: "preserved" };
    bindBeautyMovementContextRef(contextB, browser.host);
    const entryB = structuredClone(browser.history.state);
    assert.equal(readBeautyMovementContextRef(browser.host), contextB);
    assert.equal(browser.history.state?.unrelated, "preserved");

    browser.history.state = entryA;
    assert.equal(readBeautyMovementContextRef(browser.host), contextA);
    browser.history.state = entryB;
    assert.equal(readBeautyMovementContextRef(browser.host), contextB);

    clearBeautyMovementContextRef(browser.host);
    assert.equal(readBeautyMovementContextRef(browser.host), null);
    assert.equal(browser.history.state?.unrelated, "preserved");
});

test("in-memory invite handoff remains fail-closed when sessionStorage is unavailable", () => {
    const token = "t".repeat(43);
    const valid = fakeBrowser({
        storageThrows: true,
        handoff: { attempted: true, token },
    });
    assert.deepEqual(consumeBeautyMovementInviteHandoff(valid.host), { attempted: true, token });
    assert.deepEqual(consumeBeautyMovementInviteHandoff(valid.host), { attempted: false, token: null });

    const invalid = fakeBrowser({
        storageThrows: true,
        handoff: { attempted: true, token: ["not", "an", "invite"].join("-") },
    });
    assert.deepEqual(consumeBeautyMovementInviteHandoff(invalid.host), { attempted: true, token: null });
});

test("fragment parser distinguishes absent, valid, and invalid invite handoffs", () => {
    const token = "i".repeat(43);
    assert.deepEqual(parseBeautyMovementInviteFragment(""), { attempted: false, token: null });
    assert.deepEqual(parseBeautyMovementInviteFragment("#section=mesa"), { attempted: false, token: null });
    assert.deepEqual(parseBeautyMovementInviteFragment(`#c=${token}`), { attempted: true, token });
    assert.deepEqual(parseBeautyMovementInviteFragment("#c=invalid"), { attempted: true, token: null });
});

test("context references are opaque, domain-separated, and map to one cookie name", async () => {
    const secret = ["context", "isolation", "synthetic", "material", "1234567890"].join("-");
    const sessionToken = "s".repeat(43);
    const contextRef = await deriveBeautyMovementSessionContextRef({ secret, token: sessionToken });
    const sessionHash = await hashBeautyMovementSessionToken({ secret, token: sessionToken });

    assert.match(contextRef, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(contextRef, sessionHash);
    assert.equal(getBeautyMovementSessionCookieName(contextRef), `ef_bm_ctx_${contextRef}`);
    assert.equal(getBeautyMovementSessionCookieName("invalid"), null);
});

test("production route attestation ignores serialized trailing escapes in static asset paths", () => {
    const html = [
        '<link rel="stylesheet" href="/_next/static/css/layout.css">',
        "/_next/static/css/layout.css\\",
        '<script src="/_next/static/chunks/app/page.js"></script>',
        "/_next/static/chunks/app/page.js\\\\",
    ].join("\n");

    assert.deepEqual(extractStaticAssetPaths(html), [
        "/_next/static/chunks/app/page.js",
        "/_next/static/css/layout.css",
    ]);
});

test("browser smoke diagnostics preserve safe failure codes while redacting opaque values", () => {
    const opaque = "t".repeat(43);
    const message = `beauty_movement_isolation_smoke_act_timeout:{\"expectedAct\":\"Movimento\",\"opaque\":\"${opaque}\"}`;

    assert.equal(
        redactBeautyMovementSmokeError(message),
        'beauty_movement_isolation_smoke_act_timeout:{"expectedAct":"Movimento","opaque":"[opaque]"}',
    );
    assert.equal(
        redactBeautyMovementSmokeError("beauty_movement_isolation_smoke_context_missing"),
        "beauty_movement_isolation_smoke_context_missing",
    );
    assert.equal(redactBeautyMovementSmokeError(`navigation failed at /#c=${opaque}`), "navigation failed at /#c=[redacted]");
});

test("governed staging and production smokes execute the same four-invite isolation matrix", async () => {
    const [staging, production, deploy, recovery, smoke, primarySmoke, releaseSmoke, deployWorker, reconcile] = await Promise.all([
        readFile(sourceUrl("../.github/workflows/beauty-movement-staging-smoke.yml"), "utf8"),
        readFile(sourceUrl("../.github/workflows/beauty-movement-production-activation.yml"), "utf8"),
        readFile(sourceUrl("../.github/workflows/deploy-website-cloudflare.yml"), "utf8"),
        readFile(sourceUrl("../.github/workflows/beauty-movement-production-recovery.yml"), "utf8"),
        readFile(sourceUrl("scripts/beauty-movement-context-isolation-smoke.mjs"), "utf8"),
        readFile(sourceUrl("scripts/beauty-movement-primary-journey-smoke.mjs"), "utf8"),
        readFile(sourceUrl("scripts/beauty-movement-production-release-smoke.mjs"), "utf8"),
        readFile(sourceUrl("scripts/deploy-worker.mjs"), "utf8"),
        readFile(sourceUrl("scripts/beauty-movement-production-reconcile.mjs"), "utf8"),
    ]);

    for (const workflow of [staging, production, deploy, recovery]) {
        assert.doesNotThrow(() => yaml.load(workflow));
    }
    assert.ok(assertEmbeddedBashParses(deploy) >= 8);
    assert.ok(assertEmbeddedBashParses(recovery) >= 2);
    for (const workflow of [staging, production]) {
        assert.match(workflow, /Beauty Movement Smoke Primary/);
        assert.match(workflow, /Beauty Movement Isolation A/);
        assert.match(workflow, /Beauty Movement Isolation B/);
        assert.match(workflow, /Beauty Movement Isolation Expired/);
        assert.match(workflow, /beauty-movement-context-isolation-smoke\.mjs/);
        assert.match(workflow, /context-isolation-readback\.json/);
    }
    assert.match(smoke, /sameTabStartsFresh: true/);
    assert.match(smoke, /twoPagesSameContextIndependent: true/);
    assert.match(smoke, /simultaneousReloadStable: true/);
    assert.match(smoke, /crossContextAuthorizationRejected: true/);
    assert.match(smoke, /crossCookieCredentialRejected: true/);
    assert.match(smoke, /name: `ef_bm_ctx_\$\{secondContextB\}`/);
    assert.match(smoke, /rawTokensPersistedInEvidence: false/);
    assert.match(smoke, /beauty_movement_isolation_smoke_act_timeout/);
    assert.match(smoke, /beauty_movement_isolation_smoke_fresh_checkpoint_failure/);
    assert.match(smoke, /checkpointDiagnosticsSnapshot/);
    assert.match(smoke, /failAtCheckpoint/);
    assert.match(smoke, /assertScrubbed\(page, checkpoint\)/);
    assert.match(smoke, /contextRef\(page, checkpoint = "context-ref"\)/);
    assert.match(smoke, /waitAct\(page, act, checkpoint = "act-transition"\)/);
    assert.match(smoke, /"forward-b"/);
    assert.match(smoke, /"hash-race-b-to-a"/);
    assert.match(smoke, /"simultaneous-reload-a"/);
    assert.match(smoke, /"simultaneous-reload-b"/);
    assert.match(smoke, /"expired-invite"/);
    assert.match(smoke, /navigateAtCheckpoint/);
    assert.match(smoke, /checkpointLastApiTransportFailure = true/);
    assert.doesNotMatch(smoke, /console\.log\(.*token/i);
    assert.match(primarySmoke, /whatsappCtaPresent: true/);
    assert.match(primarySmoke, /contextRestoredAfterReload: true/);
    assert.match(releaseSmoke, /syntheticFixtureRevoked: true/);
    assert.match(releaseSmoke, /durableValidationRecorded: true/);
    assert.match(releaseSmoke, /persistDurableValidation/);
    assert.match(releaseSmoke, /preexistingActiveCampaignsPreserved/);
    assert.match(releaseSmoke, /ROUTE_ATTESTATION_ATTEMPTS = 6/);
    assert.match(releaseSmoke, /failedStage/);
    assert.match(releaseSmoke, /containsPersonalData: false/);
    assert.match(deploy, /beauty-movement-production-release-smoke\.mjs/);
    assert.match(deploy, /beauty-movement-production-reconcile\.mjs/);
    assert.match(deploy, /website-production-incumbent-/);
    assert.match(deploy, /website-production-candidate-/);
    assert.match(deploy, /DEPLOY_RELEASE_OWNER/);
    assert.match(deployWorker, /deployArgs\.push\("--tag", releaseOwner\)/);
    assert.match(deployWorker, /"deployments",\s*"status",\s*"--json"/);
    assert.match(reconcile, /"deployments",\s*"status",\s*"--json"/);
    assert.match(deployWorker, /assertProductionReleaseReconciliationContract/);
    assert.match(deployWorker, /if \(productionDeployment\)[\s\S]*Production rollback delegated/);
    assert.match(deploy, /always\(\).*beautyMovementRollbackCheckpoint/);
    assert.match(deploy, /always\(\).*beautyMovementReleaseSmoke\.outcome != 'skipped'/);
    assert.match(recovery, /workflow_run:/);
    assert.match(recovery, /group: deploy-website-production/);
    assert.match(recovery, /actions\/download-artifact@/);
    assert.match(recovery, /ref: main/);
    assert.match(recovery, /persist-credentials: false/);
    assert.doesNotMatch(recovery, /github\.event\.workflow_run\.head_sha/);
    assert.doesNotMatch(recovery, /ref: \$\{\{ steps\.recovery\.outputs\.release_sha \}\}/);
    assert.match(recovery, /beauty-movement-production-reconcile\.mjs/);
    assert.match(recovery, /expectedReleaseOwner/);
    assert.match(recovery, /wait_timeout_seconds: '1200'/);
    assert.ok((recovery.match(/required: 'true'/g) ?? []).length >= 3);
    assert.doesNotMatch(recovery, /beauty-movement-production-release-\*/);
    assert.match(reconcile, /"workers\/tag"/);
    assert.match(reconcile, /superseded_same_sha/);
    assert.match(reconcile, /hasDurableValidation/);
    assert.match(deploy, /beautyMovementReleaseSmoke\.outcome == 'success'/);
    assert.doesNotMatch(recovery, /BEAUTY_MOVEMENT_(TOKEN_HMAC|PII)_KEY/);
});

test("production reconciliation fails closed when durable validation cannot be read", () => {
    assert.equal(resolveBeautyMovementReleaseConclusion({
        conclusion: "failure",
        durableValidation: true,
        validationReadFailed: false,
    }), "success");
    assert.equal(resolveBeautyMovementReleaseConclusion({
        conclusion: "success",
        durableValidation: false,
        validationReadFailed: true,
    }), "success");
    assert.equal(resolveBeautyMovementReleaseConclusion({
        conclusion: "failure",
        durableValidation: false,
        validationReadFailed: true,
    }), null);
    assert.equal(resolveBeautyMovementReleaseConclusion({
        conclusion: "cancelled",
        durableValidation: false,
        validationReadFailed: false,
    }), "cancelled");
});

test("production release smoke parses clean and noisy Wrangler JSON without logging payloads", () => {
    const payload = [{ success: true, results: [{ active_count: 1 }] }];
    assert.deepEqual(parseWranglerJson(JSON.stringify(payload)), payload);
    assert.deepEqual(parseWranglerJson(`wrangler progress\n${JSON.stringify(payload)}\n`), payload);
    assert.throws(() => parseWranglerJson("wrangler failed"), /beauty_movement_release_smoke_json_invalid/);
    assert.equal(
        buildBeautyMovementReleaseValidationMarker("a".repeat(40), "bm-123456789-2"),
        `bm-release-validated:${"a".repeat(40)}:bm-123456789-2`,
    );
    assert.throws(
        () => buildBeautyMovementReleaseValidationMarker("invalid", "bm-123456789-2"),
        /beauty_movement_release_smoke_validation_marker_invalid/,
    );
});

test("production reconciliation derives one bounded synthetic fixture identity", () => {
    assert.equal(
        buildBeautyMovementSyntheticCampaignId("123456789", "2"),
        "bm-prod-release-smoke-123456789-2",
    );
    assert.throws(
        () => buildBeautyMovementSyntheticCampaignId("not/a/run", "2"),
        /beauty_movement_reconcile_campaign_id_invalid/,
    );
    assert.equal(buildBeautyMovementReleaseOwner("123456789", "2"), "bm-123456789-2");
    assert.throws(
        () => buildBeautyMovementReleaseOwner("not/a/run", "2"),
        /beauty_movement_reconcile_release_owner_invalid/,
    );
});

test("production reconciliation only rolls back the exact owned candidate", () => {
    const checkpoint: BeautyMovementReleaseCheckpoint = {
        version: 1,
        phase: "candidate",
        releaseSha: "a".repeat(40),
        releaseOwner: "bm-123456789-2",
        previousVersionId: "11111111-1111-4111-8111-111111111111",
        candidateVersionId: "22222222-2222-4222-8222-222222222222",
        beautyMovementActiveCampaignCount: 1,
        previousBuildSha: "b".repeat(40),
    };
    assert.deepEqual(decideBeautyMovementRollback({
        conclusion: "failure",
        checkpoint,
        currentVersionId: checkpoint.candidateVersionId!,
        currentBuildSha: checkpoint.releaseSha,
        currentReleaseOwner: checkpoint.releaseOwner,
    }), { action: "rollback", candidateVersionId: checkpoint.candidateVersionId });
    assert.deepEqual(decideBeautyMovementRollback({
        conclusion: "cancelled",
        checkpoint,
        currentVersionId: checkpoint.previousVersionId,
        currentBuildSha: checkpoint.previousBuildSha,
        currentReleaseOwner: "bm-previous-1",
    }), { action: "none", reason: "already_previous" });
    assert.deepEqual(decideBeautyMovementRollback({
        conclusion: "failure",
        checkpoint,
        currentVersionId: "33333333-3333-4333-8333-333333333333",
        currentBuildSha: "c".repeat(40),
        currentReleaseOwner: "bm-987654321-1",
    }), { action: "none", reason: "superseded" });
    assert.throws(() => decideBeautyMovementRollback({
        conclusion: "failure",
        checkpoint,
        currentVersionId: checkpoint.candidateVersionId!,
        currentBuildSha: "c".repeat(40),
        currentReleaseOwner: checkpoint.releaseOwner,
    }), /beauty_movement_reconcile_candidate_identity_split/);
    assert.throws(() => decideBeautyMovementRollback({
        conclusion: "failure",
        checkpoint,
        currentVersionId: checkpoint.candidateVersionId!,
        currentBuildSha: checkpoint.releaseSha,
        currentReleaseOwner: "bm-987654321-1",
    }), /beauty_movement_reconcile_candidate_owner_mismatch/);
    assert.deepEqual(decideBeautyMovementRollback({
        conclusion: "success",
        checkpoint,
        currentVersionId: checkpoint.candidateVersionId!,
        currentBuildSha: checkpoint.releaseSha,
        currentReleaseOwner: checkpoint.releaseOwner,
    }), { action: "none", reason: "validated_release" });
    assert.deepEqual(decideBeautyMovementRollback({
        conclusion: "failure",
        checkpoint,
        currentVersionId: "33333333-3333-4333-8333-333333333333",
        currentBuildSha: checkpoint.releaseSha,
        currentReleaseOwner: "bm-987654321-1",
    }), { action: "none", reason: "superseded_same_sha" });
});

test("prepared checkpoint can safely infer a stranded candidate by exact release SHA", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "beauty-movement-reconcile-"));
    const checkpointPath = path.join(directory, "incumbent.json");
    const checkpoint: BeautyMovementReleaseCheckpoint = {
        version: 1,
        phase: "prepared",
        releaseSha: "d".repeat(40),
        releaseOwner: "bm-123456789-2",
        previousVersionId: "44444444-4444-4444-8444-444444444444",
        candidateVersionId: null,
        beautyMovementActiveCampaignCount: 1,
        previousBuildSha: "e".repeat(40),
    };
    try {
        await writeFile(checkpointPath, JSON.stringify(checkpoint), "utf8");
        assert.deepEqual(readBeautyMovementReleaseCheckpoint(
            checkpointPath,
            checkpoint.releaseSha,
            checkpoint.releaseOwner,
        ), checkpoint);
        assert.deepEqual(decideBeautyMovementRollback({
            conclusion: "timed_out",
            checkpoint,
            currentVersionId: "55555555-5555-4555-8555-555555555555",
            currentBuildSha: checkpoint.releaseSha,
            currentReleaseOwner: checkpoint.releaseOwner,
        }), {
            action: "rollback",
            candidateVersionId: "55555555-5555-4555-8555-555555555555",
            inferred: true,
        });
        assert.throws(
            () => readBeautyMovementReleaseCheckpoint(
                checkpointPath,
                "f".repeat(40),
                checkpoint.releaseOwner,
            ),
            /beauty_movement_reconcile_checkpoint_invalid/,
        );
        assert.deepEqual(decideBeautyMovementRollback({
            conclusion: "timed_out",
            checkpoint,
            currentVersionId: "55555555-5555-4555-8555-555555555555",
            currentBuildSha: checkpoint.releaseSha,
            currentReleaseOwner: "bm-987654321-1",
        }), { action: "none", reason: "superseded_same_sha" });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
