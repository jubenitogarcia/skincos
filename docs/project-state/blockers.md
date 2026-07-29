# Blockers

## P0 — Insumos unit access

PR #763 remains the source correction; the current closure evidence is the
immutable release `f30f66e70e0dc949adde5120378509a1c95fe557`, recorded on
`main` by PR #847/#848. Production Inventory run `30420719000` and CRM Pages
run `30420793906` completed through the canonical pipelines with checkpoint
artifact `8711811875`. Controlled synthetic onboarding and authenticated UI
smokes passed, including canonical-unit access, localStorage reconciliation,
Atendimento without `UNAUTHORIZED`, and explicit out-of-scope denial
`403/RBAC_UNIT_DENIED`. All synthetic identities were torn down; no business
data, real user, grant or flag was changed.

The P0 queue item can be marked resolved for orchestration purposes, with the
rollback checkpoints and sanitized evidence retained in the evidence ledger.
Do not infer that this unlocks Finance production activation: Finance staging
rollback/restore and its separate nominal gate remain required before any pilot.

Finance pilot activation remains separately blocked by current staging evidence
and named human approval; it is frozen independently of the resolved P0 item.

## Finance staging gate — current status

The fresh offsite retry at 2026-07-25T04:55Z did not close the remaining
transfer gate. Drive metadata and the four expected objects were visible, but
the connector's raw PostgreSQL download exceeded its IPC frame limit; the
private rclone/direct-token attempts could not list or read the folder (403 or
directory-not-found). No payload, secret, production data or scratch resource
was changed. Existing local ciphertexts remain manifest-matched only and must
not be relabeled as a fresh offsite restore.

The current-main rollback/restore exercise is now complete for candidate SHA
`b869485b6a33fae5a5dbe504b41660f842fb4ca9`. Worker preview/staging runs
`30143039262`/`30143051826` promoted it, rollback `30143185583` restored the
reachable immutable SHA `8af1d5fe9551891a05a104363043bf3d36fb4ef4`, and the
scratch D1/KV/R2/Worker restore passed its synthetic authenticated journey.
The UI staging artifact was built from the same candidate (`30143594297`).
The kill switch was validated against remote KV by `30143674681` and restored
by `30143742671`; the shell remained healthy while Finance returned 423.
Scratch resources were destroyed after checksums and functional evidence were
captured. This is evidence for rollback and recovery, not a production or pilot
approval. The sanitized private record is retained outside the repository.

PR #740 is integrated; follow-up state/evidence PRs #800, #801, #802, #804,
#805, #806 and #807 are integrated. Current main is
`68f88e070629e4077a1a1754b3347e60dc89be18`.
The offsite drill has valid D1 retrieval/restore evidence and matching
PostgreSQL/configuration ciphertext hashes. A fresh runtime-config transfer
was subsequently fetched and decrypted with the versioned restore script; its
plaintext SHA matched the manifest and the plaintext was destroyed after
sanitized inspection. The fresh PostgreSQL transfer remains blocked because
the connector exceeds its IPC limit for the 90,908,667-byte object and the
alternate provider path lacks authorization. The complete offsite gate
therefore remains open. No module promotion, flag, grant or production change
is authorized by this evidence.

A follow-up streaming attempt with rclone 1.60.1 reached the same restricted
Drive vault but was rejected with provider `RATE_LIMIT_EXCEEDED`; it downloaded
no bytes and changed no state. The next action is to wait for the quota window
or use an authorized service account, then repeat hash verification and scratch
restore. This is an external-provider blocker, not a reason to activate
Finance.

The current-main SHA `8af1d5fe9551891a05a104363043bf3d36fb4ef4` has a successful
candidate (`30139535704`), preview (`30139561027`) and staging deployment
(`30139576133`) with Worker version
`97c7a7da-6a78-44a8-b980-2cc2810df7a0`. A controlled rollback (`30139701809`)
restored immutable SHA `67ee53843a9a52ad495ab6d67b8cd2b4fac053f9` using Worker
version `c57fdafc-6045-4eb5-8b38-07ae98d7c256`; health stayed ready and no
migrations or unrelated modules were touched. The synthetic canary abort drill
(`30139247054`) also proved the remote kill switch and baseline restoration.

These staging gates are now evidenced, but they do not unlock the pilot. The
remaining blockers are authenticated import/UI smoke, an external monitor with
human alert evidence, encrypted offsite backup plus restore for the
current-main artifact, and named approval. `module_enabled` remains false and
no real user or unit is enabled.

Inventory production is stable on the single reconciled `RELEASE_SHA`
`c64ff2b6655ce9e035a1b3a3840b1d6d809a9c2d`. The additive
`0017_employee_onboarding.sql` migration is present in the journal with zero
onboarding payloads; no new promotion is required. `IDENTITY_PII_KEY` exists in
the staging and production GitHub environments, but external vault/escrow and
recovery ownership for the generated production key are not evidenced. This is
an operational security debt and must be closed before onboarding data is
created or the key is rotated; it does not justify another production deploy.
