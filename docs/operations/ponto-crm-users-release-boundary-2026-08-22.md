# Ponto release boundary for CRM Users invite recovery

## Objective

Create a new immutable source boundary for the governed Ponto reconciliation
after the CRM Pages surface was already published at the previous candidate
SHA. This record exists to preserve the release audit trail; it does not
change application behavior, flags, data, or credentials.

## Reason for the boundary

The CRM Users resend path correctly reaches the Inventory service, but the
service fail-closes before sending mail when Workforce reconciliation cannot
complete. The production Pages canonical deployment is already at
`2cd0dd94fcc88bc1d0ffc9224223b3dbbc9dba87`, which is also the candidate used
by the failed Ponto pilot. The progressive-release baseline therefore refuses
to treat that same SHA as a new candidate, while production Timekeeping still
needs the matching release affinity.

This documentation-only commit provides a distinct, reviewable SHA for the
same source content so the normal baseline, staging, pilot, canary, production
and recovery gates can execute without weakening any guard.

## Scope and safety

- Surfaces: Ponto Timekeeping, Core Inventory/API, and CRM Pages.
- No migration, database write, invite record mutation, feature-flag change,
  grant change, secret change, or direct Cloudflare mutation is included.
- The unified-team capability remains governed by the existing production
  configuration and must not be enabled by this boundary commit.
- The two pending CRM invite resends remain blocked until the authenticated
  production readiness and UI checks pass.

## Rollback

The rollback target is the exact production state attested by the failed pilot
recovery ledger and its successful recovery jobs. The release must not be
considered complete unless the progressive workflow records the incumbent
versions, candidate version IDs, and a successful post-rollback smoke path.
If any production gate or smoke fails, keep Ponto in maintenance and use the
governed recovery/rollback workflow; do not edit D1/KV or create an invite
directly.

## Required validation

Before the CRM resends are attempted, the governed release must prove:

1. exact release affinity across Timekeeping, Identity/Workforce, Core API,
   Inventory, and CRM Pages;
2. staging authenticated journey, maintenance restoration, and rollback drill;
3. pilot, canary, and production readiness without `404`, `503`, or
   `RELEASE_AFFINITY_MISMATCH`;
4. `GET /api/auth/me` and `GET /api/crm/admin/team?mode=config` return `200`;
5. the CRM Users screen loads configuration, members, units, and invite
   history before the two UI-only resend actions are performed.
