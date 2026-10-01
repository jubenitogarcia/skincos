import crypto from "node:crypto";

const CONTEXTS = ["global-merge-authority", "skincos-integration-gate"];

export function rulesetFingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildNativeAdmissionRuleset(previous, { appId, expectedFingerprint, readiness } = {}) {
  if (previous?.id !== 19631459 || previous.name !== "main-enterprise-baseline" || previous.enforcement !== "active"
    || previous.target !== "branch" || !Array.isArray(previous.rules) || !Array.isArray(previous.bypass_actors)
    || previous.bypass_actors.length || rulesetFingerprint(previous) !== expectedFingerprint) {
    throw new Error("Canonical main ruleset identity or checkpoint changed");
  }
  if (!Number.isSafeInteger(appId) || appId < 1 || readiness?.appId !== appId
    || readiness?.timerReady !== true || readiness?.nativeMergerReady !== true
    || readiness?.actionsStatusTriggersRetired !== true
    || !CONTEXTS.every((context) => readiness?.statusReadbacks?.includes(context))) {
    throw new Error("Native App issuer, timer, merger and status readbacks must be ready before requiring checks");
  }
  const body = structuredClone(Object.fromEntries(["name", "target", "enforcement", "conditions", "bypass_actors", "rules"].map((name) => [name, previous[name]])));
  const checks = body.rules.filter((rule) => rule.type === "required_status_checks");
  if (checks.length !== 1 || !Array.isArray(checks[0].parameters?.required_status_checks)
    || checks[0].parameters.required_status_checks.some((check) => !CONTEXTS.includes(check.context))) {
    throw new Error("Existing required checks need an explicit native migration");
  }
  checks[0].parameters = { ...checks[0].parameters, strict_required_status_checks_policy: true,
    required_status_checks: CONTEXTS.map((context) => ({ context, integration_id: appId })) };
  return body;
}
