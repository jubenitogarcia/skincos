# Native PR admission

The trusted native poller replaces the two historical `pull_request_target`
signals: `global-merge-authority` denies a direct merge; the integration status
evaluates the exact current base, head, dependency closure and coordinator gate.
It never checks out or executes PR content and never performs a merge.

Program code is installed as a root-owned immutable release under
`/opt/skincos-native-pr-admission/releases/<program-sha>/source`. The timer runs
that reviewed implementation while a private bare mirror supplies public main
trees as data. Main advancing does not execute new main code. Native merge
authority still validates its own exact main/head, checks, receipt and fenced
`merge:main` lease immediately before mutation.

The issuer accepts only GitHub App RSA custody through systemd credentials:
`/etc/skincos/github-app/private-key.pem` and `config.json` (root 0600). Metadata
contains `appId`, `installationId`, `botLogin` and the canonical `coordinatorUrl`.
The installation token is limited to repository ID 1060913632 and the admission
profile: contents read, pull requests read and statuses write. No interactive
`gh` token is copied into the daemon. The shared issuer also exposes distinct
security and merge profiles; callers must request and verify their exact scope.
Tokens remain in memory for one run and are neither logged nor persisted.

Coordinator custody is loaded directly from the existing root-private
`/etc/skincos/global-coordination/runtime.env`. Missing credentials, ambiguous
syntax, absent scopes, API failures, unsupported tree entries and changed
identity fail closed. A stale base receives failure; a competing lease receives
pending; the next poll re-evaluates it. Draft and fork PRs receive no admission.
The poller preserves a native merger's success for at most two minutes only
when its creator matches the configured App bot and its URL points to the
versioned native merge runbook. The merger still owns every final lease check.

Status publication is disabled while current main contains `status`,
`check_run`, `check_suite` or `pull_request_target` Actions triggers. The cutover
must neutralize these triggers and preserve other scheduled duties before
enabling this timer; merely disabling the two workflows in the catalogue is
not the complete transition. A read-only preflight proves mirror, App token
scope and local coordinator custody, but does not claim a green coordinator
admission or successful status write.

Acceptance evidence must include the canonical main SHA, immutable program
SHA, App installation/permissions, sanitized native preflight and a real
published status readback. Confirm the ruleset binds the two required contexts
to the intended App and preserves strict base checks. The observed historical
ruleset had an empty required context list; documentation alone cannot close
that enforcement gap. Keep an exported ruleset and the previous immutable
release for rollback. A rollback stops/disables the native timer, restores the
previous release and ruleset under the merge lease, and verifies their readback;
it does not start or wait for GitHub Actions.

The private service state holds only public Git objects and aggregate
`latest.json` evidence (0700 directory / 0600 receipt). Journald receives only
aggregate counts and fixed fail-closed diagnostics.
