# Change set Orb/n8n — proposta para aprovação humana

## Estado

Classificação: **PR_BLOQUEADO**.

O pedido menciona “qualificação aprovada”, mas a evidência privada mais recente
(`QUALIFICATION-STAGING-20260728.md`) classifica o staging como `BLOQUEADO`.
Este PR preserva essa verdade e entrega somente o pacote revisável; não altera
produção, não reinicia serviços, não aplica migration e não promove binário.

## Versão fixa

- atual: n8n 2.8.3;
- alvo proposto: n8n 2.32.5;
- razão: correção OAuth por `upsert` para `(userId, clientId)` e validação do MCP;
- correção oficial observada: commit `26ecadcf94`;
- Node: `>=22.22`, baseline observada `22.23.1`;
- PostgreSQL: baseline observada `16.14`, manter PostgreSQL 16.x e confirmar a
  faixa oficial no preflight;
- tarball e integridade npm fixados em `ops/runtime/n8n-upgrade/VERSION_MANIFEST.json`;
- wrapper observado no staging: SHA-256 registrado no manifesto, sem tratá-lo
  como substituto da integridade do tarball;
- migrations: baseline 143, candidato observado 227; nunca executar em produção
  sem backup restore-verified;
- MCP/OAuth: Streamable HTTP e 9 ferramentas readonly; `execute_workflow` proibido;
- packages: 11 pins, layout direto obrigatório; caminhos declarados presentes,
  mas jornadas funcionais ainda são gate aberto.

## Conteúdo

- manifesto fixado e fontes oficiais;
- scripts de preflight, checkpoint, backup, verificação, upgrade, migration,
  smoke, OAuth, MCP, status, rollback e coleta de evidência;
- fixture OAuth sintética transacional;
- teste de dry-run/sintaxe/manifesto;
- runbooks de promoção, rollback e observação;
- evidência sanitizada de resiliência isolada;
- nenhum backup, dump, credencial, token, cookie, PII, dado clínico ou log bruto.

## Gates executados neste pacote

Além de `bash -n`, validação do manifesto e dry-run de todos os scripts, foram
executados ensaios isolados de morte/reinício, porta ocupada, indisponibilidade
do banco no gateway e filesystem somente leitura. Não foi executado o script de
upgrade, migration, parada, startup, backup live ou rollback live. Baixo espaço,
matriz completa de recuperação, OAuth/MCP real, jornadas funcionais e
persistência WSL permanecem gates pendentes e bloqueiam merge/promote.

## Aprovações ainda necessárias

1. reclassificação formal da qualificação staging;
2. aprovação da versão-alvo e janela;
3. confirmação do SHA Git e tarball/integridade;
4. backup restore-verified e checkpoint;
5. aprovação operacional para desativar triggers e parar apenas Orb;
6. gates MCP/OAuth, Booking/CRM/WhatsApp/Meta/content, quatro serviços e
   persistência WSL;
7. decisão humana manter/reverter após observação.
