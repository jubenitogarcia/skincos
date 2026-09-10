# Ponte manual de secrets do Ponto Pages

O workflow `.github/workflows/ponto-pages-secret-bridge.yml` preenche somente
os cinco secrets que faltam nos environments dedicados do Ponto Pages. Ele é
manual, exige `apply=true`, aceita apenas `main` no SHA atual e não pode ser
acionado por `push`, `workflow_call`, agenda ou dispatcher.

Ele **não** publica Pages, chama a API Cloudflare, altera rota, muda
`PONTO_PAGES_PUBLISH_ENABLED`, faz backfill, muda o writer legado ou liga o
módulo. O publisher dedicado continua bloqueado enquanto
`PONTO_PAGES_PUBLISH_ENABLED=false` e enquanto faltarem a candidata Core,
smoke de staging e os demais receipts exigidos pelo contrato.

## Mapa imutável

| Escolha manual | Root de origem | Environment de destino | Projeto Pages |
| --- | --- | --- | --- |
| `staging` | `staging` | `ponto-pages-staging` | `skincos-ponto-staging` |
| `production` | `production` | `ponto-pages-production` | `skincos-ponto` |

O workflow não aceita outro mapa, projeto ou environment. Ele requer que o
environment de destino comece exatamente com os quatro secrets literais já
configurados: conta Cloudflare e os três alvos HTTPS. Qualquer secret extra ou
uma das cinco saídas já presente interrompe a execução, sem sobrescrever valor
desconhecido.

## O que é transportado

Dois valores de pipeline são copiados do escopo de repositório, para os nomes
isolados do Pages:

- `CLOUDFLARE_API_TOKEN` → `PONTO_PAGES_CLOUDFLARE_API_TOKEN`;
- `SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET` →
  `PONTO_PAGES_GLOBAL_COORDINATION_SHARED_SECRET`.

Os três valores restantes são derivados dentro do job do environment de origem
a partir de `PONTO_IDEMPOTENCY_KEY`, com os mesmos domínios da custódia legado:

- `skincos/ponto/actor/v1`;
- `skincos/ponto/network-context/v1`;
- `skincos/ponto/release-probe/v1`.

Assim, a ponte nunca copia `PONTO_IDEMPOTENCY_KEY`,
`PONTO_ACTOR_HMAC_KEY` ou `PONTO_NETWORK_CONTEXT_KEY` para o destino. Valores
não entram em argumentos de comando, arquivos temporários ou logs: cada escrita
usa o `gh secret set` com o valor somente pelo `stdin` de um processo isolado.

## Pré-condições reais

Antes de executar a ponte, precisa existir um run bem-sucedido e de primeira
tentativa de `.github/workflows/cloudflare-workers-sync-ponto-secrets.yml` para
o mesmo SHA atual de `main` e o mesmo target. O artifact
`ponto-root-custody-<target>-<sha>` é baixado e verificado; ele comprova a
separação do root e, em produção, também a separação de staging.

Para preparar **somente staging** sem iniciar um rollout, use o modo manual
`read-only-bridge-attestation` desse workflow com `target=staging`, o SHA
atual de `main` e todos os campos de coordenador vazios. Esse modo recusa
produção, tags e qualquer capability de release. Ele apenas confere a
custódia por nome, cria o compromisso criptográfico da raiz, lê as identidades
isoladas D1/KV e lista nomes de secrets remotos; não cria versão, não faz
deploy, não escreve D1/KV, não troca rota e não chama Pages. O título do run e
o artifact ficam vinculados explicitamente a esse modo, para que a ponte não
aceite por engano um filho de rollout.

O caminho de `production` continua dependente da cadeia governada de staging e
produção já existente. Não use o modo somente-leitura como atalho para
produção.

O metadata preflight exige:

- o envelope completo de roots canônico — `PONTO_PROFILE_DATA_KEY`,
  `PONTO_IDEMPOTENCY_KEY` e `PONTO_ROOT_ATTESTATION_KEY_SHARED` — somente no
  environment source (`staging` ou `production`), sem fallback de repositório;
- `PONTO_PROFILE_DATA_KEY_CUSTODY_REF` e
  `PONTO_IDEMPOTENCY_KEY_CUSTODY_REF` no environment source, com
  `PONTO_ROOT_ATTESTATION_KEY_ID` somente no repositório;
- `GH_TOKEN`, `CLOUDFLARE_API_TOKEN` e
  `SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET` no escopo de repositório, sem
  override no environment source;
- nenhum dos nove nomes `PONTO_PAGES_*` do contrato no escopo de repositório:
  eles pertencem somente aos environments dedicados, sem fallback implícito;
- um `GH_TOKEN` com leitura de metadata de Actions/Environments e permissão de
  criar secrets nos environments dedicados deste repositório;
- `PONTO_PAGES_PROJECT` literal correto e
  `PONTO_PAGES_PUBLISH_ENABLED=false` no environment de destino.

Se alguma dessas condições estiver ausente, a ponte falha antes de hidratar o
root. Não criar root, token ou configuração alternativa para contornar a falha.

## Sequência segura de staging

1. Faça merge da mudança que introduz o modo somente-leitura e confirme o SHA
   atual de `main`.
2. Em **Actions → Attest Ponto Worker secret custody**, execute
   `mode=read-only-bridge-attestation`, `target=staging` e o SHA atual; deixe
   todos os campos de coordenador vazios.
3. Confirme que o run terminou com sucesso e use seu ID como
   `root_custody_run_id` abaixo.
4. Em **Actions → Ponto Pages environment secret bridge**, escolha `staging`,
   repita o mesmo SHA, informe aquele ID e marque `apply`.
5. Baixe o recibo sanitizado e confirme que
   `PONTO_PAGES_PUBLISH_ENABLED` permanece `false`.

Esses passos preparam o environment dedicado do Pages, mas não publicam Pages
nem trocam tráfego. A promoção de staging continua sendo uma etapa posterior,
governada e separada.

## Execução da ponte e evidência

Após o merge, abra **Actions → Ponto Pages environment secret bridge**, escolha
o target, use o SHA exatamente atual de `main`, informe o ID do run canônico de
root-custody e marque `apply`. A execução faz uma leitura por nome antes e
imediatamente antes da escrita; ao fim exige exatamente os nove nomes previstos
no environment Pages e que a flag de publicação continue `false`.

O único artifact produzido é
`ponto-pages-secret-bridge-<target>-<sha>`. Ele registra nomes, SHA,
proveniência e digest SHA-256 verificado do artifact de root-custody, além do
fato de que nenhum deploy ou mutação Cloudflare ocorreu. Não inclui valores,
credenciais ou PII.

Uma interrupção depois de uma escrita pode deixar o destino parcial. Nesse caso
o workflow recusa nova tentativa automática para não substituir um valor que
não pode ler. Primeiro audite os nomes e faça uma rotação/reconciliação manual
autorizada do environment; só então restaure o baseline explícito e execute a
ponte novamente.
