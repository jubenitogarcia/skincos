# SKINCOS backend compatibility area

`backend/` retains shared utilities and applications that have not yet moved to a root domain. New product code belongs to the owning root domain (`api`, `booking`, `crm`, `integration`, `messaging`, and others).

Stable operator commands:

- `./backend/scripts/dev.sh status`
- `./backend/scripts/e2e.sh health`
- `./backend/scripts/e2e.sh smoke`
- `./backend/scripts/e2e.sh ci-smoke`

The production runtime is managed by the versioned units in `ops/runtime/units` and the launchers in `scripts/runtime`. Application code, sessions and mutable state must not be started from this compatibility directory.

See `docs/service-catalog.md`, `docs/ownership-model.md` and `docs/runtime-native-cutover-runbook.md` for the current architecture and operations contract.
