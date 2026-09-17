# Decisões de arquitetura

Este arquivo registra somente decisões vigentes do monorepo. O produto CRM,
seu console, Core API, banco e deploy vivem no repositório independente
`C:\CodexShared\Projetos\crm` e não são implementados aqui.

## Fronteiras vigentes

- O monorepo mantém Website, API/gateway, Ponto, Escala, Financeiro,
  Inventário, Mensageria, Social, Clínico, Booking e integrações próprias.
- O CRM externo é consumido somente por contratos versionados. O gateway
  encaminha `/crm/*` para o serviço externo; não há cópia de código, banco,
  cookie ou segredo do CRM neste repositório.
- Atendimento publica apenas o catálogo comercial read-only em
  `integration/atendimento/commercial-catalog`, com autenticação por bearer e
  contrato `crm-commercial-catalog/v1`. Esse catálogo não grava dados.
- Cada superfície Cloudflare possui um único workflow publisher e um recurso
  de coordenação próprio. Workflows de segredo não fazem deploy de código.
- Dados reais, credenciais, recibos assinados e evidências operacionais ficam
  fora do Git; somente contratos e validadores sanitizados são versionados.

## Operação e validação

- Alterações devem partir de `main`/worktree limpo, manter proveniência exata e
  usar migrações aditivas com readback e rollback do mesmo artefato.
- Ações locais de Node passam por `scripts/invoke-skincos-wsl.ps1`; os atalhos
  compartilhados não iniciam runtimes de produto externo.
- CI e Actions são auxiliares. A validação local equivalente é obrigatória
  antes de qualquer promoção.
