# Architecture

## Monorepo layout
- `apps/web`: Next.js App Router UI.
- `apps/api`: NestJS REST API.
- `apps/worker`: BullMQ workers for async jobs.
- `packages/shared`: shared types, schemas, crypto, metrics.
- `packages/meta`: Meta Business SDK wrapper helpers.
- `packages/db`: Prisma schema + client.

## Data flow
1. User logs in via API (`/api/auth/*`).
2. API stores Meta OAuth tokens encrypted (`meta_connections`).
3. API syncs ad accounts and campaigns to Postgres for UI caching.
4. UI triggers bulk actions → API creates `bulk_operations` → worker processes in chunks.
5. Worker updates items, writes results, and updates operation status.
6. Pacing job (worker) aggregates insights and creates alerts.

## Key components
- **MetaGateway (API)**: wraps `@meta/meta` calls with retries/backoff.
- **Bulk Operations**: preview → execute → background processing.
- **Pacing & Alerts**: hourly job computes pacing and creates alerts.

## Storage
Postgres with Prisma. Redis for BullMQ queues.

## Mock mode
`MOCK_MODE=true` skips Meta API calls and returns deterministic mock data.
