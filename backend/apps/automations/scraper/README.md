# scraper

Runner único via ações do Codex (sem menu).

## Estrutura do projeto

- Exports (CSV/XLSX): `report/`
- Logs + artefatos de debug (HTML/PNG): `debug/`
- Perfil do Chrome (sessão/cookies): `chrome_profile/`
- Documentação e notas: `docs/`

## Como rodar

1) Criar/ativar venv e instalar deps:

- `python3 -m venv .venv`
- `./.venv/bin/pip install -r requirements.lock`

2) Rodar direto:

- `./.venv/bin/python run_scraper.py` (exige `EF_MODE`)

## Configuração (env vars)

- `EF_LOGIN_EMAIL` / `EF_LOGIN_PASSWORD` (opcional; se não tiver, o runner pergunta)
- `EF_UNIT_NAME` (opcional; se não tiver, o runner pergunta)
- `EF_UNIT_OPTIONS` (opcional, lista separada por vírgula para o menu)
- `EF_OUTPUT_DIR` (default: `./report`)
- `EF_DEBUG_DIR` (default: `./debug`)
- `EF_LOG_DIR` (default: `./debug`)
- `EF_CHROME_USER_DATA_DIR` (default: `./chrome_profile` quando sessão persistente estiver ativa)
- `HEADLESS` (`1`/`0`)
- `EF_MODE` (`agenda`, `caixa`, `recorder`, `selftest`, `booking_api`)
- `EF_DRY_RUN` (`1`/`0`)
- `EF_DEBUG_RETENTION_DAYS` (default: `7`)
- `EF_DATE_RANGE_MODE` (`prev_month`)
- `EF_RECORDER_PURGE` (`1`/`0`)
- `EF_AGENDA_SYNC_URL` (endpoint de sync, ex.: `https://espacofacial.com/api/agenda/sync`)
- `EF_AGENDA_SYNC_TOKEN` (Bearer token do endpoint de sync)
- `EF_BOOKING_API_HOST` (default: `127.0.0.1`)
- `EF_BOOKING_API_PORT` (default: `8765`)
- `EF_BOOKING_API_TOKEN` (Bearer token para o endpoint local de reservas)
- `EF_BOOKING_WEBHOOK_SECRET` (segredo aceito no header `x-booking-webhook-secret`; compatível com o website)

## API de reservas

Suba o listener local:

- `EF_MODE=booking_api ./.venv/bin/python run_scraper.py`

Health check:

- `curl http://127.0.0.1:8765/healthz`

Criar job de reserva:

```bash
curl -X POST http://127.0.0.1:8765/api/agenda/book \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $EF_BOOKING_API_TOKEN" \
  -d '{
    "unit": "BarraShoppingSul",
    "clientName": "Maria Silva",
    "appointmentDate": "2026-03-08",
    "timeRange": "13:00 - 13:30",
    "serviceName": "Revisão",
    "professionalName": "Gabriela Menegat",
    "notes": "Lead vindo do site"
  }'
```

Webhook compatível com o website (`booking.created`):

```bash
curl -X POST http://127.0.0.1:8765/api/agenda/book \
  -H "Content-Type: application/json" \
  -H "x-booking-webhook-secret: $EF_BOOKING_WEBHOOK_SECRET" \
  -d '{
    "event": "booking.created",
    "dryRun": true,
    "booking": {
      "unitSlug": "barrashoppingsul",
      "doctorName": "Gabriela Menegat",
      "durationMinutes": 30,
      "service": { "id": "avaliacao", "name": "Avaliação" },
      "startAtMs": 1772971200000,
      "endAtMs": 1772973000000,
      "patientName": "Maria Silva",
      "whatsapp": "51999999999",
      "cpf": "12345678900",
      "notes": "Lead vindo do site"
    }
  }'
```

Consultar status do job:

- `curl http://127.0.0.1:8765/api/agenda/book/<job_id>`

Você pode criar um `.env` (não commitado) neste diretório. Use como base o `.env.example`.

## Google Sheets (Caixa)

- Coloque o service account em `secrets/ef_service_account.json` (já está no `.gitignore`).

## Self-test

- Diretamente: `./.venv/bin/python selftest.py` (ou `EF_MODE=selftest`)

Ele testa imports, export CSV/XLSX e se o Chrome abre a tela de login (sem logar). Por padrão, os arquivos de teste vão para `debug/` (mantém `report/` só para exports finais).

## Rotação do token de sync

- `./scripts/rotate_agenda_sync_token.sh`

O script gera um token novo, atualiza `~/.config/espacofacial/agenda_sync.env`, atualiza `AGENDA_SYNC_TOKEN` em `website/.env.local`, publica a secret no Worker Cloudflare (`espacofacial-site`) e valida o endpoint de sync.

## Desenvolvimento (opcional)

- `./.venv/bin/pip install -r requirements-dev.txt`
- `./.venv/bin/ruff check .`
