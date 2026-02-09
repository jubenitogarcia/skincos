Harmonia Inbox Validation Checklist
===================================

Prereqs
-------
- CRM API running on :8099
- DATABASE_URL configured (or expect 503)
- Optional tokens if enabled:
  - HARMONIA_DEBUG_TOKEN
  - HARMONIA_EXEC_TOKEN
  - HARMONIA_INGEST_TOKEN

1) Health
---------
curl -s http://localhost:8099/api/harmonia/health | jq .

Expected:
- harmonia.dbConfigured == true
- debugTokenConfigured / execTokenConfigured / ingestTokenConfigured reflect env

2) Units (debug token)
----------------------
curl -s -H "X-Harmonia-Token: $HARMONIA_DEBUG_TOKEN" \
  "http://localhost:8099/api/harmonia/units" | jq .

Expected:
- ok == true
- data is array

3) Inbox list
-------------
curl -s -H "X-Harmonia-Token: $HARMONIA_DEBUG_TOKEN" \
  "http://localhost:8099/api/harmonia/conversations?unitSlug=novo_hamburgo&limit=30" | jq .

Expected:
- ok == true
- data.items is array
- data.nextCursor present or null

4) Open conversation by id
--------------------------
CONV_ID=...
curl -s -H "X-Harmonia-Token: $HARMONIA_DEBUG_TOKEN" \
  "http://localhost:8099/api/harmonia/conversations/$CONV_ID" | jq .

5) Messages for conversation
----------------------------
curl -s -H "X-Harmonia-Token: $HARMONIA_DEBUG_TOKEN" \
  "http://localhost:8099/api/harmonia/conversations/$CONV_ID/messages?limit=50" | jq .

6) Exec route protection (optional)
-----------------------------------
If HARMONIA_EXEC_TOKEN is set:
curl -s -X POST \
  "http://localhost:8099/api/harmonia/tasks/claim" | jq .
Expect 401.

With token:
curl -s -X POST -H "X-Harmonia-Exec-Token: $HARMONIA_EXEC_TOKEN" \
  "http://localhost:8099/api/harmonia/tasks/claim" | jq .

7) Ingest protection (optional)
-------------------------------
If HARMONIA_INGEST_TOKEN is set:
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"payload":{}}' \
  "http://localhost:8099/api/harmonia/ingest" | jq .
Expect 401.

With token:
curl -s -X POST -H "Content-Type: application/json" \
  -H "X-Harmonia-Ingest-Token: $HARMONIA_INGEST_TOKEN" \
  -d '{"payload":{}}' \
  "http://localhost:8099/api/harmonia/ingest" | jq .

