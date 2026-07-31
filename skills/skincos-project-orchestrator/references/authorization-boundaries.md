# Authorization boundaries

[The Codex autonomy policy](../../../docs/decisions/codex-autonomy-policy.md)
is the canonical interpretation of authorization. The explicit current user
mission supplies the scope; this reference keeps that authorization consistent
while the Skill executes it.

## Mission and continuation

- Do not ask again for authorization that the active mission already grants.
  It remains valid through worktrees, compaction, continuation, CI correction,
  merge and environment transition.
- A Stop-generated continuation transports the existing mission; it does not
  create authorization or broaden the objective.
- When the mission names the surface, it can authorize code, documentation,
  configuration, GitHub, Cloudflare, synthetic resources, additive migrations,
  staging, canary, production, smoke, rollback and cleanup. Authorization for a
  secret allows secure creation, rotation, reference or use, never disclosure or
  versioning of its value.

## Technical eligibility is separate

Policies and runbooks for the affected domain still require real permission,
least privilege, fail-closed flags/grants, additive migration safety,
pre-production validation, proportional tests, release evidence and rollback.
A missing item is a concrete technical blocker; it is not a reason to request a
second human authorization. Neither a merge nor a health endpoint proves an
authorized production journey.

Platform trust checks, unavailable credentials, MFA and non-bypassable external
controls remain real boundaries. The agent cannot invent access, self-approve a
trust boundary, disclose secrets/PII, or make destructive irreversible changes
to real data.

## Human interruption

Use a terminal human blocker only for the mission's explicit exception set,
including: unavailable MFA/re-authentication, genuinely unprovisionable
permission, billing/procurement, medical/legal/labor/commercial judgment,
irreversible real-data mutation, or material expansion into an unrelated
product/domain. State one minimum executable human action.
