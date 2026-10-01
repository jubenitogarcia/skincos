import { decideRuntimeAction } from "../scripts/crm-local-runtime-policy.mjs"
const target = "a".repeat(40)
const sf = "snapshot:" + target + ":" + "b".repeat(64)
const current = {
  manifest: { persona: "GESTOR", state: "ready", targetCommit: target, buildCommit: target, sourceFingerprint: sf },
  buildState: { commit: target, sourceFingerprint: sf },
  targetCommit: target,
  sourceFingerprint: sf,
  persona: "GESTOR",
  pidAlive: true,
  healthy: true,
}
const candidate = {
  sourceOrigin: "file:///tmp/origin",
  ...current,
  manifest: { ...current.manifest, sourceFingerprint: undefined, sourceOrigin: "file:///tmp/origin" },
  buildState: { ...current.buildState, sourceFingerprint: undefined, sourceOrigin: "file:///tmp/origin" },
  sourceFingerprint: "commit:" + target,
}
console.log(decideRuntimeAction(candidate))
