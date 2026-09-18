# Backend command catalog

- `backend/scripts/dev.sh status|start|stop|restart`: delegates lifecycle to the supported native `systemd` units.
- Product runtimes are started from their owning directory; this compatibility area does not provide a launcher for an external product.
- `backend/scripts/e2e.sh health`: checks native unit health.
- `backend/scripts/e2e.sh smoke`: checks local and public runtime endpoints.
- `backend/scripts/e2e.sh ci-smoke`: checks the repository architecture contract without starting production services.
- `backend/scripts/clean-local-artifacts.sh`: handles regenerable local artifacts (dry-run by default).

Do not add launchers that spawn alternate WhatsApp engines, use repository state as runtime state, or mutate Git from an application process.
