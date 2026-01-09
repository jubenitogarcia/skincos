# Dependency Inventory

Purpose: Single view of all declared dependencies across modules (Node and Python), highlighting duplicates, version skews, and notes for optimization.

Last updated: 2025-12-17

## Scope

- Node packages (package.json) in:
  - Root workspace (`/package.json`)
  - CRM app (`/crm/package.json`)
  - WhatsApp Official Module (`/whatsapp/official-module/package.json`)
  - WhatsApp Library fork (`/whatsapp/official/package.json`)
  - Agent Zero monorepo root (`/a0/package.json`)
  - Agent Zero shared configs (`/a0/packages/shared-configs/package.json`)
- WhatsApp stub (`/whatsapp/stub/package.json`)
- Python packages:
  - Agent Zero requirements (`/a0/requirements.txt` and `requirements.unified.txt`)
  - Agent Zero `pyproject.toml` (project deps)
  - Root `pyproject.toml` (empty deps)

---

## Node Dependencies by Location

### Root workspace (`/package.json`)
- axios ^1.12.0
- cors ^2.8.5
- express ^5.1.0
- express-rate-limit ^8.1.0
- express-session ^1.18.2
- helmet ^8.1.0
- ioredis ^5.7.0
- jsdom ^27.0.0
- jsonwebtoken ^9.0.2
- memoizee ^0.4.17
- openid-client ^6.8.0
- pg ^8.16.3
- redis ^5.8.2
- tailwindcss ^3.4.15
- uuid ^13.0.0
- validator ^13.15.15
- vitest ^3.2.4 (+ @vitest/ui ^3.2.4)
- ws ^8.18.3
- zod ^4.1.8
- drizzle-orm ^0.44.5, drizzle-kit ^0.31.4, drizzle-zod ^0.8.3
- @tanstack/react-query-devtools ^5.89.0
- @testing-library/* (jest-dom, react, user-event)
- @types/* (express-session, memoizee, passport, pg)

Notes:
- React-related libs in root appear to support docs/tests; the main React app lives under CRM.

### CRM app (`/crm/package.json`)
- React 19 + Vite 6 stack
- Frontend-only deps (React/Vite)
- qrcode ^1.5.4
- memoizee ^0.4.17
- helmet not present here (present in root)
- tailwindcss v4 toolchain

Notes:
- A API do CRM foi isolada em `backend/apps/crm-api/package.json` (express/cors/http-proxy-middleware/axios + nodemon).
- DevDependencies include vite ^6.3.5, typescript ~5.7.2, eslint 9.x, vitest 3.x.

### CRM API (`/backend/apps/crm-api/package.json`)
- express ^5.1.0
- cors ^2.8.5
- http-proxy-middleware ^3.0.5
- axios ^1.12.0
- nodemon ^3.1.10 (dev)

### WhatsApp Official Module (`/whatsapp/official-module/package.json`)
- whatsapp-web.js ^1.34.1
- express ^4.18.2
- axios ^1.12.2
- helmet ^8.1.0
- express-rate-limit ^8.1.0
- express-session ^1.18.2
- cors ^2.8.5
- jsonwebtoken ^9.0.2
- validator ^13.15.15

Notes:
- Security middlewares present; API surface serves /api/status, /api/qr, etc.

### WhatsApp Library fork (`/whatsapp/official/package.json`)
- puppeteer ^18.2.1
- fluent-ffmpeg 2.1.3
- node-fetch ^2.6.9
- mime ^3.x, node-webpmux 3.1.7

Notes:
- puppeteer 18.x is older; upgrading may break whatsapp-web.js compatibility.

### Agent Zero monorepo root (`/a0/package.json`)
- express ^5.1.0
- cors ^2.8.5
- body-parser ^2.2.0

Notes:
- body-parser version appears incorrect; latest known stable is 1.20.x. Investigate and correct.
- Uses Nx 21.x in devDependencies.

### Agent Zero shared configs (`/a0/packages/shared-configs/package.json`)
- Peer deps: eslint ^8, prettier ^3, typescript ^5, jest ^29

### WhatsApp stub (`/whatsapp/stub/package.json`)
- express ^5.1.0

---

## Python Dependencies by Location

### Agent Zero (`/a0/requirements.txt`)
- Pinned prod libs (selected):
  - flask[async]==3.0.3, fastapi, uvicorn, httpx (unpinned)
  - playwright==1.52.0, openai-whisper==20240930
  - sentence-transformers==3.0.1, tiktoken==0.8.0
  - redis==6.4.0, prometheus-client==0.22.1
  - unstructured[all-docs]==0.16.23, unstructured-client==0.31.0
  - pandas>=1.5.0, pypdf==4.3.1, pdf2image==1.17.0, pymupdf==1.25.3
  - google-* auth/client (>= ranges), requests>=2.28.0, urllib3>=1.26.0
  - Pillow>=9.0.0, python-dateutil>=2.8.0, cloudinary, six, certifi
- Dev/test: pytest==8.3.2
- Guidance: install with constraints.txt

### Agent Zero (`/a0/requirements.unified.txt`)
- Similar set; includes commentary about merges with legacy components.

### Agent Zero `pyproject.toml`
- Duplicates most of `requirements.txt` content under [project.dependencies]
- Extras: dev/docs toolchains

### Root `pyproject.toml`
- No dependencies

---

## Cross-module Observations (Node)

- express versions:
  - v5.1.0: root, a0, whatsapp/stub
  - v4.21.1: CRM
  - v4.18.2: WhatsApp official-module
  - Action: choose standard (likely v5 where possible), plan migrations.

- axios versions:
  - ^1.12.2 (WA module), ^1.12.0 (root), ^1.7.7 (CRM)
  - Action: standardize >=1.12.x.

- security middlewares:
  - helmet ^8.1.0 present (root, WA module); add to CRM API if missing.

- sessions/auth:
  - express-session ^1.18.2 consistent.

- Redis clients:
  - ioredis (root), redis (root). Different clients for different purposes; OK, but confirm usage.

- whatsapp-web.js stack:
  - puppeteer ^18.2.1 in library; Chromium path handling required on macOS.
  - Action: avoid upgrading puppeteer without testing library compatibility.

## Cross-module Observations (Python)

- Dual source of truth:
  - requirements.txt and pyproject.toml both declare runtime deps (duplication risk).
  - Action: pick authoritative source (recommend pyproject), generate requirements from it for deployment, keep constraints.

- Mixed pins/ranges:
  - Many libs pinned; some ranges (>=) and unpinned (fastapi, uvicorn, httpx).
  - Action: pin server-critical libs (fastapi, uvicorn, httpx) via constraints for reproducible builds.

- PDF libs duplication:
  - pypdf==4.3.1 and note about PyPDF2; only pypdf is present (good). Ensure PyPDF2 not reintroduced.

---

## Candidate Issues To Address

1) body-parser ^2.2.0 likely invalid; standard is 1.20.x
2) express major mismatch (4.x vs 5.x)
3) axios version skew (1.7.x vs 1.12.x)
4) Mixed Redis clients: validate intent
5) puppeteer version age; ensure compatibility strategy
6) Python dual declarations; pin unpinned critical libs

---

## Next

- See `DEPENDENCY_OPTIMIZATION_PLAN.md` for prioritized actions and testing approach.
