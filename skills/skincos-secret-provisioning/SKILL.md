---
name: skincos-secret-provisioning
description: Classify, generate, rotate, store, verify, and recover SKINCOS secrets without exposing their values. Use when a secret is absent, needs provisioning or rotation, or its issuer/custody is unclear.
---

# SKINCOS Secret Provisioning

Use this procedure with the [autonomy policy](../../docs/decisions/codex-autonomy-policy.md)
and the affected domain runbook. It operationalizes that policy; it never
replaces a platform permission, trust boundary, rollback gate, or release
contract.

## 1. Discover before writing

1. Inspect the accepting code and contract: issuer, systems that define
   validity, scope, canonical secret store, runtime propagation path, and safe
   authenticated verification endpoint.
2. Identify the existing rotation and recovery contract before overwriting a
   value. A metadata list does not recover a prior secret value.
3. Keep names, scopes, timestamps, SHA/run IDs, and outcomes as evidence. Never
   read, print, paste, version, upload, or otherwise disclose a secret value.

## 2. Classify by issuer and validity

- `INTERNAL GENERATED SECRET`: validity is defined entirely by SKINCOS, such as
  an internal opaque bearer, webhook secret, application authentication secret,
  signing secret, or random secret.
- `EXTERNALLY ISSUED CREDENTIAL`: issuance depends on another authority, such
  as OAuth, GitHub or provider authentication, a Cloudflare/provider API
  credential, Meta access token, externally issued certificate/key, or MFA/OTP.

Do not classify from a name, an absent store entry, or a missing versioned
generator. Absence of a versioned generator alone is not evidence that an
internal generated secret requires human intervention.

## 3. Provision or rotate an internal secret

Proceed only when the mission authorizes the surface, the canonical store is
writable, and domain gates/rollback are technically eligible.

1. Generate a CSPRNG value with at least 32 random bytes unless the accepting
   contract specifies a different entropy or encoding requirement.
2. Send it directly to the canonical secret store through protected stdin or an
   in-memory secure input channel. Never put it in argv, a repository/worktree
   file, shell trace, persistent redirect, log, artifact, PR, or conversation.
3. Propagate it only through the established runtime path. Do not bypass a
   workflow-owned binding with an ad-hoc copy.
4. Verify name/timestamp metadata and an authenticated allowed/denied behavior.
   Health alone is insufficient when the bearer is optional there.
5. Continue the authorized mission automatically after successful verification.

For rotation, establish overlap, a deployed version, or another contractually
recoverable prior state before replacement. If no safe rollback exists, record
that as a technical gate and repair it; do not relabel the secret as a human
blocker or claim metadata can restore its value.

## 4. Handle an external credential fail-closed

Never fabricate an `EXTERNALLY ISSUED CREDENTIAL`. Use its canonical,
authenticated issuance, refresh, or rotation mechanism first. Escalate only
for unavailable MFA/interactive authentication, genuinely unavailable or
unprovisionable permission, or an external trust/decision that available tools
cannot make. Keep all other failed gates concrete and technical.
