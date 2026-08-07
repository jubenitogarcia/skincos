# Estado terminal — Clientes / aprovação clínica — 2026-08-06

## Escopo e proveniência

- Base verificada: `origin/main` em `d498aa4812aad098abca93db02df3ebf33c9e623`.
- Branch isolada: `codex/admin/clientes-clinical-approval-hardening-20260806`.
- Head entregue: `987d3ed1`; commits de implementação/documentação/testes: `af2d2c06`, `d3f7b9fa`, `987d3ed1`; PR aberta: `https://github.com/jubenitogarcia/skincos/pull/1175` (checks remotos ainda sem runners).
- O checkout compartilhado estava sujo e não foi alterado.
- A PR antiga do worker Harmonia (#736) está fechada/draft e não foi incorporada.
- A PR de ofertas/WhatsApp assistido (#1170) está aberta e bloqueada; sua branch divergente não foi incorporada. O delta clínico foi reimplementado sobre o `main` atual.

## Entrega

Foi criado o bounded context `clinical_approval`, separado do CRM comercial, com:

- regras versionadas de cadência clínica e estados `draft`, `submitted`, `approved`, `rejected`, `expired` e `disabled`;
- revisão, autor, aprovador, unidade, intervalo, justificativa, evidência, vigência e expiração;
- ledger de eventos append-only, deduplicação por idempotência e locks por procedimento/unidade;
- transições permitidas por estado, evidência de evento antes do commit, optimistic locking e retenção sem `DELETE`/`TRUNCATE`;
- trigger que impede aprovação direta na tabela legada de cadências comerciais;
- papel `CLINICAL_APPROVER`, escopo explícito de unidades e segregação de funções;
- API própria `/api/clinical`, health público sem PII e readiness interno protegido por ator;
- UI independente, carregada sob demanda, com acesso restrito e sem envio/recomendação automática;
- integração comercial somente leitura de aprovações atuais, com fail-closed quando o domínio ou banco não está disponível;
- migration aditiva, dry-run, aplicação/rollback transacional e rollback não destrutivo;
- runbook, ADR, catálogo de módulos e mapa de domínios atualizados.

## Flags e limites da primeira promoção

```text
CLINICAL_APPROVAL_ENABLED=false
CRM_ATENDIMENTO_READ_ONLY=true
commercialContactWritesEnabled=false
canary=[]
messaging=false
recommendationAutomation=false
```

Não houve criação de regra real, registro de consentimento, contato, campanha, mensagem, merge de identidade, migração aplicada, alteração de staging ou produção.

## Evidência de validação local

- API: `296` testes descobertos, `295` aprovados, `1` ignorado, `0` falhas.
- Console: `49` arquivos, `247` testes aprovados, `0` falhas.
- TypeScript: `tsc -p tsconfig.json --noEmit --pretty false` concluído com código `0`.
- Lint do console: `0` erros; os `95` avisos são preexistentes.
- Arquitetura, catálogo e limites de domínio: aprovados; somente 3 avisos preexistentes rastreados.
- Exceções de segurança JavaScript e guard de demo: aprovados.
- API `npm audit --audit-level=high --omit=dev`: 0 vulnerabilidades.
- Console `npm audit --audit-level=high`: 3 moderadas transitivas de desenvolvimento (`valibot` via Storybook); correção exige downgrade incompatível e permanece risco residual documentado.
- Lockfile raiz (somente ferramentas de desenvolvimento) ainda reporta 1 alta e 5 moderadas transitivas (`brace-expansion`, `@hono/node-server`/`hono`, `uuid` via Lighthouse/MCP); não é runtime do CRM. A tentativa de aplicar overrides foi revertida por alterar o lockfile raiz fora do escopo e por exigir mudanças incompatíveis; o workflow de segurança continua o gate para essa dívida existente.
- Build do console: aprovado; 9.058 módulos, entrada inicial `563,8 KiB` (limite `800 KiB`), chunk clínico lazy `6,42 kB`.
- Migration dry-run local e staging com URLs sintéticas seguras: aprovado, `writes=false`, guard de destino aprovado.
- Catálogo de observabilidade, manifesto de staging, scripts de staging e contrato de deploy nativo: aprovados.
- A árvore de dependências foi reconstruída com `npm ci` a partir do lockfile antes do build final.

## Validações não executadas e motivo

- Apply/rollback PostgreSQL, testes de triggers em banco real, staging e produção: não há `DATABASE_URL`, PostgreSQL ou credencial de migrador disponíveis; a política exige fail-closed.
- Smoke autenticado completo do launcher CRM: a primeira tentativa encontrou configuração privada de timekeeping; após desabilitá-la explicitamente, uma tentativa posterior encontrou `ENOTEMPTY` durante a instalação do runtime local. Uma tentativa direta do backend isolado também não respondeu ao health dentro do timeout, sem logs; o processo foi encerrado por `SIGTERM` e a porta isolada foi liberada. O processo e os listeners das portas isoladas foram encerrados; nenhuma porta externa ficou aberta por esta branch.
- Smoke de staging/produção, promoção progressiva e rollback real: não autorizáveis sem credenciais, role `CLINICAL_APPROVER` provisionada com unidades e registro de pré-produção.
- Deep Security Scan gerenciado: o MCP recusou iniciar porque este ambiente não fornece um perfil de permissões de filesystem gerenciado. Nenhum scan foi iniciado; não há resultado verde a afirmar.
- Checks remotos da PR: o inventário atual não tem runners disponíveis; portanto ficam pendentes até o GitHub executar os workflows.

## Ação manual mínima para avançar

1. Provisionar, fora do repositório, uma credencial de migration de staging e uma role de aplicação sem DDL, com escopo explícito de unidades.
2. Provisionar o claim assinado de um `CLINICAL_APPROVER` que não seja autor das regras, mantendo as flags acima.
3. Registrar o gate de pré-produção e executar o runbook somente em staging; produção permanece somente leitura até métricas e rollback serem observados.
4. Se necessário, repetir o Deep Scan em um runner com perfil de filesystem gerenciado.

## Riscos residuais

- A ausência de banco impede provar no ambiente alvo os triggers, grants, readiness e rollback; os contratos e testes unitários estão presentes, mas não substituem essa prova.
- O console ainda carrega dependências históricas grandes; o orçamento inicial está verde, porém o custo de plugins do build deve ser monitorado.
- As 3 vulnerabilidades moderadas transitivas de Storybook permanecem em dependências de desenvolvimento e não entram no runtime de produção.
- O lockfile raiz de ferramentas mantém a dívida transitiva acima; atualizar Lighthouse/MCP em tranche própria é o caminho seguro.
- O smoke do launcher precisa ser repetido após o runtime privado estar estabilizado; não se deve reutilizar o log antigo do checkout compartilhado.

## Segurança operacional

Nenhuma execução arbitrária de shell, SSH, `eval`, mensagem, campanha, consentimento, escrita comercial, deploy, alteração de DNS/túnel, segredo ou banco externo ocorreu nesta tranche.
