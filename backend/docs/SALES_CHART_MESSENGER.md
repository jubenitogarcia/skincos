# Sales Chart Messenger

Automação para envio de mensagens (com gráficos/relatórios) via WhatsApp, com integração ao Google Sheets/Drive, diagnósticos, cache, validação e logs.

Observação: o código canônico desta automação fica em `backend/apps/automations/sales_chart_messenger/`.
O entrypoint canônico é `python3 -m apps.automations.sales_chart_messenger` (ou `./backend/scripts/dev.sh sales-chart-messenger`).

## Funcionalidades
- Envio automatizado de mensagens de vendas para diferentes unidades (BSS/NH)
- Modos de operação:
  - `run`: execução real com envio de mensagens
  - `test`: envia para o número de teste configurado (útil para validar mensagem/integrações sem atingir destinatários reais)
  - `diagnose`: diagnóstico completo do sistema (sem envio)
- Menu interativo para execução manual
- Integração com Google APIs (Sheets, Drive)
- Integração com WhatsApp API
- Validação de arquivos e gráficos
- Sistema de cache otimizado
- Logs detalhados

## Estrutura (canônica)
```
backend/apps/automations/sales_chart_messenger/  # Automação (Python)
backend/apps/automations/sales_chart_messenger/scripts/               # Entrypoints (run/setup)
backend/config/templates/modules/whatsapp-sales-charts/        # Exemplos de config/env (sem segredos)
backend/var/                                         # Estado local (logs, pids, cache, etc.)
```

## Instalação (local)
1. Acesse a raiz do monorepo:
   ```bash
   cd skincos
   ```
2. Execute o setup:
   ```bash
   ./backend/apps/automations/sales_chart_messenger/scripts/setup.sh
   ```
3. Configure credenciais:
   - Gere `backend/config.json` a partir de `backend/config/templates/modules/whatsapp-sales-charts/config.example.json` (não commitar segredos).

## Uso
- Execução via script:
  ```bash
  ./backend/apps/automations/sales_chart_messenger/scripts/run.sh run bss        # Execução real BSS
  ./backend/apps/automations/sales_chart_messenger/scripts/run.sh test nh        # Teste (envia para número de teste)
  ./backend/apps/automations/sales_chart_messenger/scripts/run.sh diagnose       # Diagnóstico completo
  ./backend/apps/automations/sales_chart_messenger/scripts/run.sh --help         # Ajuda
  ```
- Execução manual:
  ```bash
  python3 -m apps.automations.sales_chart_messenger --mode run bss
  python3 -m apps.automations.sales_chart_messenger --mode test nh
  python3 -m apps.automations.sales_chart_messenger --mode diagnose
  ```
- Menu interativo:
  ```bash
  python3 -m apps.automations.sales_chart_messenger
  ```

## Atalhos (Makefile)
- `make -C backend sales-chart-messenger` (dev helper)
- `make -C backend sales-chart-messenger-diagnose`
- `make -C backend sales-chart-messenger-run-bss-morning` / `make -C backend sales-chart-messenger-run-nh-evening`
- `make -C backend sales-chart-messenger-test-bss-morning` / `make -C backend sales-chart-messenger-test-nh-evening`
- `make -C backend sales-chart-messenger-setup-local` (gera `config.json`/`.env` local a partir dos exemplos)

## Requisitos
- Python 3
- Tesseract OCR (opcional, para OCR)

## Segurança operacional (local)
- `run` (produção) aplica idempotência local por dia/unidade/período para evitar envio duplicado acidental.
  - Log/auditoria: `backend/var/outbox/whatsapp_sends.jsonl`
  - Para forçar reenvio no mesmo dia: `--force` (ou `SKINCOS_FORCE_SEND=1`)
