# Documentação

Arquivos de documentação e notas do projeto.

## Onde ficam os artefatos

- Exports (CSV/XLSX): `../report/`
- Logs + artefatos de debug (HTML/PNG): `../debug/`
- Perfil do Chrome (sessão/cookies): `../chrome_profile/`

## Como rodar

- Usar ações do Codex ou `EF_MODE` (sem menu).
- `EF_MODE=caixa` exporta um XLSX único com 3 abas: `por_cliente` (tabela detalhada), `por_pagamento` (resumo diário por forma de pagamento, sem linha TOTAL) e `total` (soma mensal por método) em `report/caixa_recebimentos_completo_YYYYMMDD_a_YYYYMMDD.xlsx`.
- `EF_DATE_RANGE_MODE=prev_month` aplica automaticamente o período do mês anterior (1º ao último dia).
