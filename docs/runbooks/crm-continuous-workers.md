# CRM continuous workers

`crm-jobs.service` is the process boundary for continuous CRM jobs. It binds
only `127.0.0.1:${CRM_CONTINUOUS_WORKER_PORT:-8102}` and is not a public API.
The API/gateway remains responsible for HTTP transport, identity,
authorization, correlation and routing; it never executes a background job.

## Endpoints

- `GET /health` proves the process is live.
- `GET /readiness` proves the registered worker has completed a successful
  database claim loop. It returns `503` while the database is unavailable,
  while the process health remains `200` for diagnosis.

No endpoint returns task payloads, message content, tokens or connection URLs.

## Staging activation

This runbook requires a reviewed immutable source release. It does not permit
production promotion.

1. Record the current source link and `crm.service` status. Confirm
   `crm-jobs.service` is stopped.
2. Promote the reviewed source artifact and restart `crm.service`. The new API
   no longer starts continuous workers.
3. Render/install the unit definitions, then start only `crm-jobs.service`.
4. Confirm both probes and a worker status:

   ```bash
   systemctl is-active crm.service crm-jobs.service
   curl -fsS http://127.0.0.1:8102/health
   curl -fsS http://127.0.0.1:8102/readiness
   journalctl -u crm-jobs.service -n 100 --no-pager
   ```

5. Run the controlled unavailability test in staging: block or replace only
   the worker's staging database credential, confirm `/readiness` returns
   `503` while CRM `/health` remains `200`, restore the credential and confirm
   readiness returns `200`. Do not use production dependencies for this test.

## Rollback

If readiness or task processing fails, stop only the extracted process:

```bash
sudo systemctl stop crm-jobs.service
```

Repoint the immutable source link to the prior release and restart only
`crm.service`; that release resumes the embedded worker under its prior private
configuration. Re-run CRM health and record both release SHA values. Do not
run the worker from a checkout or worktree.
