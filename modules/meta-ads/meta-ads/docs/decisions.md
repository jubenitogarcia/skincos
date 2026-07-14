# Architecture Decisions

## ADR-001: Monorepo with pnpm workspaces
- **Decision**: Use `pnpm` workspaces to manage apps and packages.
- **Why**: simple local dev and shared dependency graph.

## ADR-002: NestJS for API
- **Decision**: Use NestJS for structured modules, guards, and DI.
- **Why**: fast iteration + clear structure for future growth.

## ADR-003: BullMQ for async jobs
- **Decision**: Use BullMQ + Redis for bulk ops and scheduled jobs.
- **Why**: stable, predictable, supports repeatables.

## ADR-004: Prisma for Postgres
- **Decision**: Use Prisma schema in `packages/db`.
- **Why**: typed client shared by API/worker.

## ADR-005: Token encryption
- **Decision**: Use AES-256-GCM with master key from env.
- **Why**: no secrets in repo; straightforward key rotation.
