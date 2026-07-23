# Meta Ads - Publish: operação e diagnóstico

## Preflight

Use `Orb > Meta Ads Publish Preflight` no Codex App antes de concluir uma
correção ou iniciar uma publicação controlada. O comando é somente leitura:
ele não reinicia serviços, não salva o workflow e não executa mutações na Meta.
Ele pode consultar health, configuração, inventário e placements pelo gateway.

O preflight confirma a saúde local e pública do Orb, o schema estruturado, a
versão que será executada e a sincronização entre os Code nodes live e os
arquivos em `workflow-src/meta-ads-publish/`. Também exige mapa de landing page
não vazio e validado para cada destino; contrato antigo ou incompleto é NO-GO.

## Fonte de verdade

1. Para uma falha, inspecione primeiro a execução real. Quando a execução foi
   manual e `saveManualExecutions` está desativado, os dados não ficam no banco;
   preserve a saída do editor e consulte logs/runtime enquanto ainda existem.
2. Para código, trate `workflow-src/meta-ads-publish/` como fonte editável e
   compare-o com o workflow live usando o preflight. Não conclua a correção por
   nomes de nodes ou por uma aba antiga do navegador.
3. Para runtime, valide `C:\CodexRuntime\n8n` e os serviços `skincos-*`; o
   `Orb Validate` é a verificação ampla após alterações de infraestrutura.

## Regras que evitam recorrência

- O node OpenAI `typeVersion >= 1.3` usa Responses API por padrão. A ausência
  de `responsesApiEnabled` no JSON significa o valor padrão `true`; somente
  `false` explícito é uma falha.
- Workflows inativos executam a versão atual; workflows ativos usam sua versão
  publicada. Compare a versão de execução, não apenas `activeVersionId`.
- A URL principal é resolvida exclusivamente de
  `metadata.meta_ads_publish.landing_pages_by_creative_group`, por destino e
  `creative_group_key`. O CTA é `BOOK_NOW` ("Agende agora"); a IA não escolhe nenhum dos dois.
- Landing page ausente, fora da allowlist, indisponível ou redirecionada ao
  WhatsApp bloqueia o lote antes da Meta. Links opcionais do Advantage+
  continuam sujeitos à allowlist.
- O creative solicita em `v25.0` apenas features allowlisted. Música depende
  de placement Instagram elegível, mídia flexível depende de múltiplas
  proporções/regras e `site_extensions` exige de 2 a 4 links válidos.
- Readback ausente é `not_reported`/inconclusivo, nunca evidência de que um
  aprimoramento foi aplicado.
- Não publique na Meta para diagnosticar uma falha. Reproduza com testes e
  finalize com o preflight; uma rodada live exige autorização explícita.

## Critério de aceite

Uma correção está pronta somente quando há: causa baseada em execução/runtime,
teste que reproduz o cenário, fontes sincronizadas com o live, preflight verde
e uma declaração clara sobre o que não foi validado em produção.
