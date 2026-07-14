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
- `EF_MODE` (`agenda`, `caixa`, `procedures`, `recorder`, `selftest`, `booking_api`)
- `EF_DRY_RUN` (`1`/`0`)
- `EF_DEBUG_RETENTION_DAYS` (default: `7`)
- `EF_DATE_RANGE_MODE` (`prev_month`)
- `EF_INDEX_WEEK_WINDOW_WEEKS` (opcional; limita agenda/index para a semana atual + próximas semanas, ex.: `4` para totalizar 28 dias a partir do início da semana atual)
- `EF_INDEX_FUTURE_DAYS` (opcional; limita agenda/index para janela móvel a partir de hoje, ex.: `28`)
- `EF_RECORDER_PURGE` (`1`/`0`)
- `EF_UNITS` (opcional; lista separada por vírgula para modos multiunidade, ex.: `BarraShoppingSul,Novo Hamburgo`)
- `EF_PROCEDURES_MAX_PAGES` (opcional; limita páginas no modo `procedures`, útil para smoke test)
- `EF_PROCEDURES_MAX_CLIENTS_PER_UNIT` (opcional; limita clientes por unidade no modo `procedures`, útil para smoke test)
- `EF_CLIENT_REGISTRATION_MAX_PAGES` (opcional; limita páginas no modo `client_registration`, útil para smoke test)
- `EF_CLIENT_REGISTRATION_MAX_CLIENTS_PER_UNIT` (opcional; limita clientes por unidade no modo `client_registration`, útil para smoke test)
- `EF_CLIENT_REGISTRATION_TARGETS` (opcional; lista separada por vírgula, `;` ou quebra de linha para export seletivo por cliente)
- `EF_CLIENT_REGISTRATION_TARGETS_FILE` (opcional; arquivo `.txt`, `.csv`, `.tsv`, `.xlsx` ou `.json` com a lista de clientes)
- `EF_CLIENT_REGISTRATION_TARGETS_FILE_SHEET` (opcional; aba do Excel quando `EF_CLIENT_REGISTRATION_TARGETS_FILE` for `.xlsx`)
- `EF_CLIENT_REGISTRATION_TARGETS_SPREADSHEET_URL` (opcional; URL da planilha Google Sheets com a lista de clientes)
- `EF_CLIENT_REGISTRATION_TARGETS_SPREADSHEET_ID` (opcional; Google Sheets com a lista de clientes)
- `EF_CLIENT_REGISTRATION_TARGETS_WORKSHEET` (opcional; nome da aba no Google Sheets com a lista de clientes)
- `EF_CLIENT_REGISTRATION_TARGETS_WORKSHEET_GID` (opcional; `gid` da aba no Google Sheets; útil quando você só tem a URL)
- `EF_CLIENT_REGISTRATION_SYNC_SHEETS` (default: `1`; quando a origem é Google Sheets, preenche as colunas C:K da própria aba com os dados extraídos)
- `EF_AGENDA_SYNC_URL` (endpoint de sync, ex.: `https://espacofacial.com/api/agenda/sync`)
- `EF_AGENDA_SYNC_TOKEN` (Bearer token do endpoint de sync)
- `EF_BOOKING_API_HOST` (default: `127.0.0.1`)
- `EF_BOOKING_API_PORT` (default: `8765`)
- `EF_BOOKING_API_TOKEN` (Bearer token para o endpoint local de reservas)
- `EF_BOOKING_WEBHOOK_SECRET` (segredo aceito no header `x-booking-webhook-secret`; compatível com o website)
- `EF_BOOKING_ENV_FILE` (opcional; default `./secrets/booking_api.env` no modo `booking_api`)

## API de reservas

Suba o listener local:

- `EF_MODE=booking_api ./.venv/bin/python run_scraper.py`

No modo `booking_api`, o runner carrega automaticamente `./secrets/booking_api.env` (ou `EF_BOOKING_ENV_FILE` se definido), sem sobrescrever variáveis já exportadas no shell.

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

## Export de procedimentos dos clientes

- Export completo: `EF_MODE=procedures HEADLESS=1 ./.venv/bin/python run_scraper.py`
- Smoke test curto: `EF_MODE=procedures HEADLESS=1 EF_PROCEDURES_MAX_PAGES=1 EF_PROCEDURES_MAX_CLIENTS_PER_UNIT=2 ./.venv/bin/python run_scraper.py`

Saídas:

- `report/procedimentos_clientes_espacofacial.csv`
- `report/procedimentos_clientes_espacofacial.xlsx`
- `report/procedimentos_clientes_espacofacial_resumo.json`

Observações:

- O modo `procedures` atualiza os arquivos parciais durante a execução, para não perder progresso se houver falha.
- Erros pontuais por cliente são registrados no JSON de resumo em `client_errors`, sem interromper o restante do lote.

## Export de cadastro dos clientes

> Status atual: esta secao permaneceu documentada, mas o modo
> `client_registration` nao esta ligado no `run_scraper.py` atual. Antes de
> republicar um atalho funcional para esse fluxo, o runner precisa voltar a
> expor a implementacao correspondente.

- Export completo: `EF_MODE=client_registration HEADLESS=1 ./.venv/bin/python run_scraper.py`
- Smoke test curto: `EF_MODE=client_registration HEADLESS=1 EF_CLIENT_REGISTRATION_MAX_PAGES=1 EF_CLIENT_REGISTRATION_MAX_CLIENTS_PER_UNIT=2 ./.venv/bin/python run_scraper.py`
- Export seletivo por lista inline: `EF_MODE=client_registration HEADLESS=1 EF_UNITS='Novo Hamburgo' EF_CLIENT_REGISTRATION_TARGETS='Adair Nobre,Ana Leticia Algayer' ./.venv/bin/python run_scraper.py`
- Export seletivo por arquivo: `EF_MODE=client_registration HEADLESS=1 EF_CLIENT_REGISTRATION_TARGETS_FILE='/caminho/clientes.xlsx' ./.venv/bin/python run_scraper.py`
- Export seletivo por Google Sheets: `EF_MODE=client_registration HEADLESS=1 EF_CLIENT_REGISTRATION_TARGETS_SPREADSHEET_ID='...' EF_CLIENT_REGISTRATION_TARGETS_WORKSHEET='Clientes' ./.venv/bin/python run_scraper.py`
- Export seletivo por Google Sheets usando URL + `gid`: `EF_MODE=client_registration HEADLESS=1 EF_CLIENT_REGISTRATION_TARGETS_SPREADSHEET_URL='https://docs.google.com/spreadsheets/d/.../edit?gid=1666496487#gid=1666496487' EF_CLIENT_REGISTRATION_TARGETS_WORKSHEET_GID='1666496487' ./.venv/bin/python run_scraper.py`

Saídas:

- `report/cadastro_clientes_espacofacial.csv`
- `report/cadastro_clientes_espacofacial.xlsx`
- `report/cadastro_clientes_espacofacial_resumo.json`

Observações:

- O modo `client_registration` percorre todas as unidades configuradas em `EF_UNITS` e atualiza os arquivos parciais durante a execução.
- Quando algum alvo é informado via `EF_CLIENT_REGISTRATION_TARGETS`, arquivo local ou Google Sheets, o scraper troca a paginação completa pela busca da tela de clientes e exporta só os correspondentes.
- Para arquivo/planilha, o parser tenta detectar colunas como `cliente`/`nome` e `unidade`. Se a coluna `unidade` existir, a busca fica restrita à unidade informada; sem essa coluna, ele procura o cliente nas unidades configuradas em `EF_UNITS`.
- Quando a origem é Google Sheets e `EF_CLIENT_REGISTRATION_SYNC_SHEETS` está ativo, o scraper escreve de volta na própria linha da aba: `TELEFONE`, `EMAIL`, `NASCIMENTO`, `PROFISSÃO`, `ENDEREÇO`, `CIDADE`, `ESTADO`, `CEP` e `COMO CONHECEU`.
- Clientes não encontrados entram em `missing_clients` no JSON de resumo; falhas durante abertura/leitura continuam indo para `client_errors`.
- O extrator lê os campos da aba `Cadastro` por rótulo visível, cobrindo dados pessoais, contatos e endereço.
- Erros pontuais por cliente também vão para `client_errors` no JSON de resumo, sem derrubar o lote inteiro.

## Self-test

- Diretamente: `./.venv/bin/python selftest.py` (ou `EF_MODE=selftest`)

Ele testa imports, export CSV/XLSX e se o Chrome abre a tela de login (sem logar). Por padrão, os arquivos de teste vão para `debug/` (mantém `report/` só para exports finais).

## Rotação do token de sync

- `./scripts/rotate_agenda_sync_token.sh`

O script gera um token novo, atualiza `~/.config/espacofacial/agenda_sync.env`, atualiza `AGENDA_SYNC_TOKEN` em `website/.env.local`, publica a secret no Worker Cloudflare (`espacofacial-site`) e valida o endpoint de sync.

## Backfill completo da agenda sincronizada

- `HEADLESS=1 EF_INDEX_WEEK_WINDOW_WEEKS=4 EF_UNITS='BarraShoppingSul,Novo Hamburgo' EF_AGENDA_SYNC_URL='https://espacofacial.com/api/agenda/sync' ./run_agenda_full_sync_all_units.sh`

Esse fluxo faz scrape completo por unidade e publica todos os agendamentos como `added`, útil para repovoar `agenda_appointments` com `duration_min`. Com `EF_INDEX_WEEK_WINDOW_WEEKS=4`, a janela coberta é a semana atual mais as próximas 3 semanas.

## Desenvolvimento (opcional)

- `./.venv/bin/pip install -r requirements-dev.txt`
- `./.venv/bin/ruff check .`
