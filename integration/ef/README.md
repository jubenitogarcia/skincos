# scraper

A integração de Booking do Website e o transporte de sync foram retirados deste checkout; a fonte e o publisher pertencem exclusivamente a `jubenitogarcia/website`. Este runner mantém os modos locais de extração EF.

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

- `EF_LOGIN_EMAIL` / `EF_LOGIN_PASSWORD` (opcional; nas ações EF App, se o
  `login.env` privado não tiver ambos, o launcher pergunta no terminal Windows
  e salva somente em `%LOCALAPPDATA%\Codex\skincos\espacofacial-app\login.env`)
- `EF_UNIT_NAME` (opcional; se não tiver, o runner pergunta)
- `EF_UNIT_OPTIONS` (opcional, lista separada por vírgula para o menu)
- `EF_OUTPUT_DIR` (default: `./report`)
- `EF_DEBUG_DIR` (default: `./debug`)
- `EF_LOG_DIR` (default: `./debug`)
- `EF_CHROME_USER_DATA_DIR` (default: `./chrome_profile` quando sessão persistente estiver ativa)
- `HEADLESS` (`1`/`0`)
- `EF_MODE` (`agenda`, `agenda_index`, `agenda_delta`, `caixa`, `procedures`, `client_registration`, `recorder`, `selftest`)
- `EF_DRY_RUN` (`1`/`0`)
- `EF_DEBUG_RETENTION_DAYS` (default: `7`)
- `EF_DATE_RANGE_MODE` (`prev_month`)
- `EF_CASH_START_DATE` / `EF_CASH_END_DATE` (período explícito do Caixa em
  `DD/MM/AAAA`; nas ações EF App Caixa vêm das perguntas no terminal e têm
  precedência sobre `EF_DATE_RANGE_MODE`)
- `EF_INDEX_WEEK_WINDOW_WEEKS` (opcional; limita agenda/index para a semana atual + próximas semanas, ex.: `4` para totalizar 28 dias a partir do início da semana atual)
- `EF_INDEX_FUTURE_DAYS` (opcional; limita agenda/index para janela móvel a partir de hoje, ex.: `28`)
- `EF_RECORDER_PURGE` (`1`/`0`)
- `EF_UNITS` (opcional; lista separada por vírgula para modos multiunidade, ex.: `BarraShoppingSul,Novo Hamburgo`)
- `EF_PROCEDURES_MAX_PAGES` (opcional; limita páginas no modo `procedures`, útil para smoke test)
- `EF_PROCEDURES_MAX_CLIENTS_PER_UNIT` (opcional; limita clientes por unidade no modo `procedures`, útil para smoke test)
- `EF_CLIENT_REGISTRATION_MAX_PAGES` (opcional; limita páginas no modo `client_registration`, útil para smoke test)
- `EF_CLIENT_REGISTRATION_MAX_CLIENTS_PER_UNIT` (opcional; limita clientes por unidade no modo `client_registration`, útil para smoke test)
- `EF_AGENDA_SYNC_TOKEN` (nome de contrato cliente preservado para integrações EF externas; este checkout não inclui o transporte que o consome)

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

O modo `client_registration` está disponível no runner. Ele percorre a lista
de clientes de cada unidade, abre a aba visível `Cadastro` e lê os campos sem
alterar nada no aplicativo.

- Export completo: `EF_MODE=client_registration HEADLESS=1 ./.venv/bin/python run_scraper.py`
- Smoke test curto: `EF_MODE=client_registration HEADLESS=1 EF_CLIENT_REGISTRATION_MAX_PAGES=1 EF_CLIENT_REGISTRATION_MAX_CLIENTS_PER_UNIT=2 ./.venv/bin/python run_scraper.py`
- Smoke test: `EF_MODE=client_registration HEADLESS=0 EF_CLIENT_REGISTRATION_MAX_PAGES=1 EF_CLIENT_REGISTRATION_MAX_CLIENTS_PER_UNIT=2 ./.venv/bin/python run_scraper.py`

Se o perfil persistente ainda não estiver autenticado, use
`EF_WAIT_FOR_MANUAL_LOGIN=1` com `HEADLESS=0`; o scraper aguarda o login feito
diretamente na janela do Chrome e não recebe nem grava senha.

Saídas:

- `<EF_OUTPUT_DIR>/cadastro_clientes_espacofacial.csv`
- `<EF_OUTPUT_DIR>/cadastro_clientes_espacofacial.xlsx`
- `<EF_OUTPUT_DIR>/cadastro_clientes_espacofacial_resumo.json`

Observações:

- O modo `client_registration` percorre todas as unidades configuradas em `EF_UNITS` e atualiza os arquivos parciais durante a execução.
- `EF_CLIENT_REGISTRATION_MAX_PAGES` e `EF_CLIENT_REGISTRATION_MAX_CLIENTS_PER_UNIT` limitam a execução para smoke tests; sem eles, o export percorre todas as páginas e as duas unidades de `EF_UNITS`.
- O CSV é um checkpoint de retomada: uma nova execução reutiliza clientes já exportados por unidade+nome (somente quando o nome é único naquela unidade), preserva os dados já lidos e retoma os demais. Quedas de aba do Chrome disparam reinício automático da sessão até o limite de `EF_CLIENT_REGISTRATION_MAX_SESSION_RETRIES`.
- A ação compartilhada `Client Registration` cria, por padrão, uma pasta privada nova em `C:\CodexRuntime\operator\admin\skincos\scraper\client-registration\<run-id>`. Assim, uma execução nova não mistura silenciosamente o seu checkpoint com um export anterior. Uma retomada pelo menu exige definir `EF_CLIENT_REGISTRATION_RESUME_OUTPUT_DIR` para uma pasta de execução privada já existente; em execução direta, escolha explicitamente um `EF_OUTPUT_DIR` privado existente somente quando quiser retomar aquele checkpoint.
- Para estabilidade em lotes longos, a sessão é reciclada preventivamente a cada 40 novos cadastros (`EF_CLIENT_REGISTRATION_SESSION_MAX_CLIENTS`), depois de atualizar o checkpoint.
- O extrator lê os campos da aba `Cadastro` por rótulo visível, cobrindo dados pessoais, contatos e endereço.
- Erros pontuais por cliente vão para `client_errors` no JSON de resumo, sem derrubar o restante do lote. Os arquivos CSV/XLSX/JSON são atualizados após cada página.
- O resumo contém `sourceCoverage` versionado e vinculado ao hash/contagem do CSV: identifica início novo ou retomado, limites, reciclos, término por unidade e erros. `visible_pagination_exhausted` comprova somente que a paginação visível terminou; filtros e escopo de status permanecem não verificados. Por isso `snapshotComplete` e `absenceIsRetirementEvidence` são sempre `false`: ausência no CSV não autoriza marcar um cadastro histórico como aposentado.
- O reconciliador de Clientes lê esse resumo na mesma pasta do CSV (ou em `CLIENT_REGISTRATION_SOURCE_COVERAGE_FILE`), confere o hash e a contagem de linhas e inclui a cobertura no fingerprint do checkpoint. Um `--apply` exige cobertura válida, nova, sem limites e sem erros na lista visível; dados ausentes, retomados ou limitados continuam úteis para diagnóstico/dry-run, mas não liberam apply.

## Self-test

- Diretamente: `./.venv/bin/python selftest.py` (ou `EF_MODE=selftest`)

Ele testa imports, export CSV/XLSX e se o Chrome abre a tela de login (sem logar). Por padrão, os arquivos de teste vão para `debug/` (mantém `report/` só para exports finais).

## Rotação do token de sync

`EF_AGENDA_SYNC_TOKEN` continua registrado como nome do contrato de credencial cliente para integrações EF externas. Este repositório não inclui o transporte de sync nem uma ferramenta de rotação. A rotação de `AGENDA_SYNC_TOKEN` e a atualização do Worker devem ser coordenadas pelo publisher independente Website/Booking em `jubenitogarcia/website`; esta documentação não atesta configuração ou execução de rotação.

## Desenvolvimento (opcional)

- `./.venv/bin/pip install -r requirements-dev.txt`
- `./.venv/bin/ruff check .`
