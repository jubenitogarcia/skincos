# Campaign Creative Creator — promoção Orb/n8n

Este registro documenta a promoção da execução do `production_manifest` para o
runtime n8n/Orb. Ele é operacional e não contém secrets, tokens, IDs de
credenciais ou valores de configuração privada.

## Release promovido

- Código e workflows gerados a partir de `main`: `34f840ee270bccd4efd1dc93e901450021477d95`.
- Release nativo promovido: `34f840ee270bccd4efd1dc93e901450021477d95`.
- Release anterior disponível para rollback: `fcfbc9537257a0ba807366bff840666e3e501516`.
- Builder contínuo: `4.1.4`.
- Builder Organizer: `1.0.2`.
- Workflow principal gerado: 97 nodes e 117 conexões.
- Error handler gerado: 10 nodes e 12 conexões.
- Organizer gerado: 5 nodes e 4 conexões.

Os exports foram regenerados pelos builders a partir da fonte privada do
workflow. Não houve edição manual do export final.

## Workflows n8n

| Função | Workflow ID | Estado final | Observação |
| --- | --- | --- | --- |
| Campaign Creative Creator | `TxE9eMS1xfE6kq38` | Inativo | ID original preservado |
| Error Handler / CCG-99 | `9j7WMFTNVNYmNZHC` | Ativo | Necessário para o `Error Trigger` receber falhas |
| Organizer | `ccg-orchestrator-001` | Inativo | Entrada operacional configurada para chamar o Creator |

O Creator e o Organizer não expõem webhook público e permanecem inativos após
os testes. O error workflow permanece ativo porque essa é a semântica do n8n
para um workflow iniciado por `Error Trigger`; isso não publica nem ativa
anúncios.

## Bootstrap nativo do CCG-99

O source candidate posterior a esta promoção mantém o mesmo contrato de
workflows e adiciona o bootstrap nativo necessário para a rota automática de
erro técnico:

- builder contínuo `4.1.5`, com 98 nodes e 118 conexões no Creator;
- o `CCG-00 Capture Recovery Context` registra somente lineage sanitizado antes
  da validação estrita do contrato;
- `orb.service` inicia n8n por `start-n8n-runtime.sh`, que pré-carrega o
  bootstrap de error workflow antes de `WorkflowRunner` ser resolvido pelo
  container de dependências;
- o bootstrap conserva o dispatcher nativo do n8n e acrescenta apenas o
  contexto permitido em `error.ccg_recovery_context`; não transporta request
  bruto, assets, claims, secrets ou binários;
- a guarda nativa evita que CCG-99 dispare a si próprio. Creator e Organizer
  continuam inativos; somente o CCG-99 permanece ativo para receber falhas.

O motivo do bootstrap é específico da versão instalada do n8n: a ordem de
imports CommonJS podia resolver `WorkflowRunner` como dependência indefinida
de `WorkflowExecutionService`, interrompendo a execução do error workflow
antes de qualquer CCG-99. O bootstrap falha fechado se os módulos nativos
esperados não existirem, em vez de iniciar Orb com a rota de recuperação
incompleta.

A importação usou o mecanismo existente:
`orb/engine/scripts/prepare-campaign-creative-creator-live-import.js` e
`n8n import:workflow --projectId=...`. As nove referências de modelos OpenAI
foram injetadas somente no ambiente n8n durante a importação. O source gerado
contém zero referências de credenciais; nenhum secret foi commitado.

## Contrato de execução

No CCG-80, o `production_manifest` passa por validação de política, dispatch,
polling, normalização, reconciliação por `job_id`, soma de custo, verificação
de artifact/checksum e entrega de `production_execution_results` ao CCG-90.

- `DRY_RUN` usa o executor mock determinístico e não faz chamadas pagas,
  storage externo ou publicação.
- `LIVE` exige provider explicitamente permitido, `max_cost` presente,
  limite de jobs/revisões e aprovação humana.
- O mesmo `run_id`, `production_id`, `content_id`, `campaign_id`,
  `request_hash` e `idempotency_key` percorre Organizer, Creator, executor e
  CCG-90.
- O executor retorna resultados por `job_id`, com status, provider, tempos,
  artifact/preview URI, MIME, dimensões, duração, tamanho, SHA-256, custo,
  warnings, erro e provenance quando aplicável.
- Copy, preço, CTA, logo e disclaimers são overlays determinísticos. A base
  visual gerada não recebe texto comercial nem logo por IA.
- `publish_allowed` e `publish_requested` permanecem `false`; aprovação
  humana continua obrigatória.

Durante a promoção foi removido o acesso a `$env` nos Code nodes e nas
expressões HTTP do n8n. O endpoint do executor vem do contrato de execução,
com fallback local controlado; isso evita a restrição de acesso a environment
variables observada no n8n instalado.

## Smoke 1 — STATIC_SINGLE / DRY_RUN

Execução nativa pelo Organizer, com provider mock, um deliverable, `max_jobs=4`,
`max_cost=0` e `require_human_approval=true`:

- execução Organizer: `396`;
- execução filha Creator: `397`;
- execução do executor: `ccg-execution-d87e53ea995ef39bc3bdb679`;
- status do executor: `COMPLETED`;
- custo total: `0 BRL`;
- jobs reconciliados: 4, todos `COMPLETED`;
- chamadas externas: nenhuma;
- pacote: `run-396:content-package`, estado `DRY_RUN_COMPLETE`;
- publicação: não publicada, `publish_allowed=false` e
  `publish_requested=false`.

Artifacts mock produzidos, todos com URI, MIME, tamanho e SHA-256:

| Job | MIME | Dimensões | SHA-256 |
| --- | --- | --- | --- |
| `fetch:logo` | `application/json` | — | `6adf9d58500b44f2bbd4e6507058b460d1dcad464dbb503d04f95d80e611772f` |
| `fetch:hero` | `application/json` | — | `ed661bb68bc842234c3fc7e7a4e5100d45180196ed1f069c96288d4fc1eceef7` |
| `fetch:background` | `application/json` | — | `cd0e346de522b5b702f8fd18ca6f22ff31d4c40cd95a3f34a57df90a993cf5bb` |
| `compose:...frame-1` | `image/svg+xml` | 1080x1080 | `80ab561f41f6db33f3767db5bf9a9428f81a93fa52f16f08ef1a43d87031db32` |

O resultado confirmou continuidade da mesma produção do CCG-00 ao CCG-90,
sem IDs de fixture intermediária.

## Validação direcionada e CI

- validação estrutural contínua: passou, 97 nodes e 117 conexões;
- testes dos builders/import/Organizer: 16 testes passaram (12 contínuos, 2 de
  import e 2 do Organizer);
- testes do executor: 16 testes passaram, cobrindo estático, carrossel, vídeo,
  dependências, idempotência, retry 429, falha permanente, custo excedido,
  artifact ausente, checksum divergente, provider fora da allowlist e
  consentimento ausente;
- a suíte completa exigida pelo CI foi executada uma vez no PR de release
  `#1158` e todos os checks obrigatórios passaram;
- nenhuma dessas validações fez chamada paga.

## Smoke 2 — HYBRID / DRY_RUN

Foi executado o harness de contrato direcionado, sem chamadas pagas e sem
alteração no n8n. Não há execution ID nativo para este smoke.

- planejamento: estático, carrossel e `SHORT_VIDEO`;
- módulos opcionais CCG-60 e CCG-70: `DONE`;
- jobs reconciliados: 7, todos `COMPLETED`;
- dependências de composição e renderização respeitadas;
- 7 artifacts mock com URI e SHA-256 verificados;
- composição determinística conferida com copy, CTA e logo overlay no SVG;
- CCG-90 produziu `CONTENT_PACKAGE`, `DRY_RUN_COMPLETE`, custo `0` e
  publicação desabilitada.

## Smoke 3 — compliance negativa

Foi executado o harness direcionado com preço sem evidência aprovada:

- factual foundation: `NEEDS_REVIEW`;
- routing: `PROCEED_WITH_GUARDRAILS`;
- oferta allowlisted: nenhuma;
- oferta blocklisted: `unsupported-price`;
- motivos rastreáveis para fato e oferta sem evidência;
- chamadas externas: nenhuma;
- CCG-99: não acionado, pois a decisão normal de compliance não é erro
  técnico;
- publicação: bloqueada.

## Canary live

O canary de uma imagem estática **não foi executado**. O bloqueio é objetivo:

- executor reporta `live_enabled=false`;
- `CCG_CANARY_MAX_COST` não está explicitamente configurado;
- não há evidência operacional reunida nesta promoção de storage real
  configurado e acessível, logo oficial aprovado e consentimento verificado
  para qualquer imagem pessoal.

Portanto, não houve chamada paga, canary automático ou publicação. O canary só
pode ser reavaliado depois que todos os gates acima forem evidenciados e a
requisição mantiver `require_human_approval=true` e `publish_allowed=false`.

## Comparação do export implantado

A exportação pós-importação foi comparada estruturalmente com os JSONs gerados:

- Creator: mesmo ID, 97 nodes, 117 conexões, zero diferenças de nodes/edges,
  error workflow `9j7WMFTNVNYmNZHC`, inativo;
- Error handler: mesmo ID, 10 nodes, 12 conexões, zero diferenças, ativo;
- Organizer: mesmo ID, 5 nodes, 4 conexões, zero diferenças, inativo;
- source: zero referências de credencial;
- runtime: nove referências de credencial esperadas apenas nos modelos OpenAI;
- nenhum acesso a environment variable no export implantado.

Os artifacts do Smoke 1 e Smoke 2 são `mock://` e comprovam o contrato,
checksum e reconciliação, mas não comprovam storage real. URI acessível,
MIME/dimensões e custo real de um provider permanecem gates do canary.

## Rollback e recuperação

- Rollback de código/release: `fcfbc9537257a0ba807366bff840666e3e501516`.
- Backup nativo: `/var/lib/skincos-runtime/orb/backups/daily/20260806T035620Z`.
- Banco no backup: `n8n_runtime`, 44 workflows e 376 executions.
- SHA-256 do dump do banco: `baff7ddf67d963a1a8c98cd2d336c42d592eaaa5b2e6e78c8820ad5feeb4b435`.
- SHA-256 do storage: `0951ef244255f34be12a1aefd1bdd2552911429e08c3706786a20135e180558c`.
- `restoreVerified=false` neste backup diário; a restauração deve ser
  validada antes de uma recuperação de desastre.

O rollback mantém os três IDs de workflow preservados. O workflow principal e o
Organizer podem continuar inativos durante a reversão; o error workflow deve
seguir a semântica de ativação exigida pelo `Error Trigger`.

## Riscos restantes

1. O bootstrap da rota automática de CCG-99 deve receber um smoke nativo
   controlado após a promoção do source candidate: uma falha técnica sintética
   precisa produzir exatamente um incidente, lineage sanitizado e nenhuma
   recursão. Até esse smoke, Creator e Organizer devem permanecer inativos.
2. Não existe evidência de canary live nesta promoção. Provider pago, storage
   real, URI acessível e custo real continuam não validados.
3. O backup corrente ainda não tem `restoreVerified`; executar um restore drill
   controlado é recomendável antes de qualquer ativação live.
4. Nenhuma publicação ou ativação de anúncio faz parte deste workflow; a
   aprovação humana continua pendente por desenho.
