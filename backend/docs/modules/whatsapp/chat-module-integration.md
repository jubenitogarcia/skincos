## Chat Module Integration (WhatsApp Gateway Extraction)

This document explains how to extract and integrate the WhatsApp Gateway (present in `backend/apps/whatsapp/gateway/` inside the SKINCOS workspace) into the chat-module.

Note: the Chat Module packages live inside WhatsApp now: `backend/apps/whatsapp/chat-module/` (previously `backend/apps/chat-module/`).

### 1. Objectives
- Reuse stable WhatsApp session management (Puppeteer + auth strategies)
- Expose a lean Chat API layer (status, chats, send message, media fetch)
- Preserve future upgrade path by keeping a controlled sync script

### 2. Source Components
From `backend/apps/whatsapp/gateway/apps/whatsapp-api/src/`:
- `Client.js` (core WhatsApp control w/ injection)
- `authStrategies/` (session persistence strategies)
- `factories/` (Chat / Contact factories)
- `structures/` (Message, Contact, GroupNotification, etc.)
- `util/` + `webCache/` (helpers, constants, version cache)

From repository root (selected docs/config for reference):
- `README.md` / `README_GATEWAY_FEATURES.md`
- `get_qr.sh` (optional sample QR retrieval pattern)
- `docker-compose.*.yml` (reference ONLY; likely simplified for chat-module)

### 3. Target Structure (chat-module)
```
backend/apps/whatsapp/chat-module/
  whatsapp-core/                # Core headless client (copied from src)
      src/
        Client.js
        authStrategies/
        factories/
        structures/
        util/
        webCache/
      package.json              # New minimal package manifest
  whatsapp-api/                 # Express API wrapper (if desired)
      src/
        index.js                # Thin server exposing endpoints
        routes/                  # chat, contacts, media, status
  whatsapp-ui/                  # UI (if desired)
```

### 4. Git History Preservation Options
| Strategy | Pros | Cons | Command Sketch |
|----------|------|------|----------------|
| Subtree (recommended) | Keeps history, simple updates | Slightly verbose merge process | `git subtree add --prefix=packages/whatsapp-core <remote> main --squash` (or without `--squash` for full history) |
| Filter-Repo Extraction | Full fine-grained history | One-time complexity | Use `git filter-repo --path backend/apps/whatsapp/gateway/apps/whatsapp-api/src` |
| Plain Copy | Fastest | No history | `cp -R ...` |

### 5. Minimal Dependency Set
Needed runtime deps (align versions if possible):
```
puppeteer
qrcode-terminal
axios
express
redis (optional if using caching layer)
fluent-ffmpeg (if sending stickers/webp transformations)
node-webpmux (sticker metadata)
uuid
```

Development (optional): `nodemon`, `eslint`, `prettier`, `c8`.

### 6. Environment Variables (Proposed .env.example)
```
PORT=3001
WHATSAPP_HEADLESS=true
WHATSAPP_SESSION_PATH=./.wa-sessions
WHATSAPP_LOG_LEVEL=info
WHATSAPP_BROWSER_ARGS=--no-sandbox,--disable-setuid-sandbox
FFMPEG_PATH=/usr/bin/ffmpeg
REDIS_URL=redis://localhost:6379
JWT_SECRET=change_me
RATE_LIMIT_PER_MINUTE=300
```

### 7. Express API (Suggested Endpoints)
| Method | Path | Purpose |
|--------|------|---------|
| GET | /status | Session state + readiness |
| GET | /chats | List chats (id, name, unreadCount) |
| GET | /chats/:id/messages?limit=50 | Recent messages |
| POST | /send | Send message { number, type, message / media } |
| GET | /media/:messageId | Retrieve media (if cached) |
| GET | /contacts | List contacts |
| GET | /contacts/:id | Contact detail |
| POST | /webhooks | Register webhook (optional) |

### 8. Sync Script Workflow
1. Pull latest `SKINCOS-AI`
2. Copy updated source directories into `packages/whatsapp-core/src`
3. Optionally run a diff & produce a patch summary
4. Commit with message: `chore: sync whatsapp-core from SKINCOS-AI@<commit>`

### 9. Migration Steps
1. Clone target repo:
   ```bash
   git clone https://github.com/jubenitogarcia/chat-module.git
   cd chat-module
   ```
2. (Option) Add SKINCOS-AI remote:
   ```bash
   git remote add skincos-ai https://github.com/jubenitogarcia/SKINCOS-AI.git
   git fetch skincos-ai main
   ```
3. Create working branch:
   ```bash
   git checkout -b feat/whatsapp-core
   ```
4. Create directory scaffold and copy code (manual or run planned script).
5. Add new `package.json` for `whatsapp-core` (see Section 10).
6. Implement thin Express wrapper (#11) or integrate into existing chat module services.
7. Add `.env.example`.
8. Commit & push; open PR.

### 10. Example package.json (packages/whatsapp-core/package.json)
```json
{
  "name": "@chat-module/whatsapp-core",
  "version": "0.1.0",
  "main": "src/Client.js",
  "type": "commonjs",
  "license": "Apache-2.0",
  "dependencies": {
    "puppeteer": "^24.16.0",
    "qrcode-terminal": "^0.12.0"
  }
}
```

### 11. Example Express Wrapper (packages/whatsapp-api/src/index.js)
```js
const express = require('express');
const Client = require('@chat-module/whatsapp-core/src/Client');
const app = express();
app.use(express.json());

const client = new Client({ puppeteer: { headless: true } });
let ready = false;
client.on('qr', qr => console.log('QR:', qr));
client.on('ready', () => { ready = true; console.log('WhatsApp ready'); });
client.initialize();

app.get('/status', (req, res) => res.json({ ready }));
// Additional routes go here...

app.listen(process.env.PORT || 3001, () => console.log('API running'));
```

### 12. Security Hardening (Post-Merge)
- JWT auth middleware on mutating endpoints
- Rate limiting (e.g., express-rate-limit) – align with `RATE_LIMIT_PER_MINUTE`
- Webhook signature (HMAC SHA256 with shared secret)

### 13. Update & Maintenance
- Track upstream changes by diffing `backend/apps/whatsapp/gateway/apps/whatsapp-api/src` against `packages/whatsapp-core/src`
- Maintain CHANGELOG in chat-module for imported updates
- Consider tests mirroring upstream behavior (connection lifecycle, basic send)

### 14. License & Attribution
Original code licensed Apache-2.0 (see upstream LICENSE). Retain headers where present.

### 15. Future Enhancements
- TS migration for stronger typing
- Abstract transport to support multi-platform (e.g., Telegram, Instagram) under unified interface
- Add metrics adapter (Prometheus) and structured logging (pino/winston)

---
Maintainer: automation generated integration guide (initial version)
