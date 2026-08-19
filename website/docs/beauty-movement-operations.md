# Cartas da Beleza em Movimento — operação de campanha

Este módulo é deliberadamente desligado por padrão (`BEAUTY_MOVEMENT_ENABLED=false`).
Ele não deve receber lista real, publicar rota ativa ou criar mensagens até que todos os
gates abaixo estejam concluídos.

## Dados e privacidade

- A planilha de entrada fica somente no runtime privado do operador, em
  `C:\CodexRuntime\operator\admin\skincos\beauty-movement\` (ou equivalente
  privado no ambiente de release). Não copie CSV, URLs de entrega, CPF, histórico
  ou relatórios para este repositório.
- O importador aceita exclusivamente a lista sanitizada documentada no próprio
  comando. CPF, procedimentos, histórico clínico e colunas não reconhecidas são
  rejeitados antes de qualquer escrita.
- A paleta apenas escolhe o deck editorial; ela não escolhe nem pré-reserva a
  oferta. Nenhum dado pessoal, procedimento ou histórico clínico é enviado ao
  D1 ou ao navegador para decidir o resultado.
- A condição comercial moderna é propriedade do resolver determinístico das
  três cartas. `reward_id` é opcional na importação e só é lido para manter
  compatibilidade com convites legados; nunca é aceito do navegador como
  autoridade. O resultado persistido inclui `outcome_key`, versão do protocolo
  e snapshot estruturado da oferta.

## Infraestrutura exigida antes de staging

1. Criar um D1 exclusivo de staging e outro de produção, sem reutilizar
   `BOOKING_DB`, e configurar a binding `BEAUTY_MOVEMENT_DB` para cada ambiente.
   Os IDs não são versionados porque ainda não existem neste repositório.
2. Configurar chaves diferentes por ambiente: `BEAUTY_MOVEMENT_TOKEN_HMAC_KEY`
   e `BEAUTY_MOVEMENT_PII_KEY`. Nenhum valor é versionado.
3. Configurar `BEAUTY_MOVEMENT_ALLOWED_ORIGINS` com a origem exata do ambiente.
4. Declarar `migrations_dir = "migrations/beauty-movement"` na binding dedicada
   e aplicar as migrations `0001_initial.sql`, `0002_rewards.sql` e
   `0003_reward_integrity.sql` e `0004_card_outcomes.sql` pelo mecanismo oficial do Wrangler. O helper
   local executa `wrangler d1 migrations apply --local`; nunca aplique os SQLs
   manualmente em sequência, pois a segunda migration possui alterações
   aditivas. Registrar checkpoint/export e validar schema. Rollback operacional
   é desativar a campanha, não apagar convites.
5. Manter `BEAUTY_MOVEMENT_ENABLED=false` até o smoke sintético passar.

## Importação privada

O comando abaixo deve rodar por meio do wrapper WSL e com caminhos fora do
worktree. Sem `--apply`, ele só valida e produz contagens redigidas.

```text
npm run beauty-movement:import -- --dry-run --input <caminho-privado>
  [--reward-catalog <json-privado> --procedure-catalog <json-privado>]
  --campaign <id> --campaign-config <json-privado>
  --campaign-ends-at <ISO-8601>
```

Uma escrita exige, além de uma validação limpa, `--apply`, alvo explícito
(`--local` somente para dados sintéticos ou `--remote` somente no ambiente
aprovado), `--confirm-campaign <id>`, database e diretório privado. A saída com
links de entrega deve ir para diretório privado; nunca para `website/tmp`, Git
ou logs de CI.

A primeira carga também exige um JSON privado de configuração da campanha. Ele
mantém o conteúdo editorial e as condições fora da lista de contatos e permite
ao importador criar apenas uma campanha em rascunho completa. Os campos exigidos
são `title`, `description`, `invitationTitle`, `invitationText`, `partnerName`,
`whatsappMessageCourtesy`, `whatsappMessageCommercial`, `whatsappLabel`,
`conditionsLabel`, `conditionsText`, `velocityBenefitLabel` e
`velocityBenefitText`; pode incluir `startsAt` em ISO-8601. O importador não ativa a campanha e não altera
o conteúdo de uma campanha já ativa. A ativação é uma etapa manual, revisada e
posterior ao smoke sintético.

O relatório operacional é privado e exige alvo explícito (`--local` para dados
sintéticos ou `--remote` para o ambiente aprovado), confirmação do identificador
e a chave de PII para descriptografar somente o CSV de saída. Não existe endpoint
público ou painel administrativo para essa consulta. O relatório não consulta
nem mostra cartas individuais.

Um convite marcado como `revoked` permanece revogado mesmo se o mesmo
`invite_ref` voltar em uma reimportação. Para entregar novo acesso após uma
revogação, crie um novo `invite_ref` sob o fluxo privado aprovado; não reutilize
o link anterior.

## Roteiro local sintético

Use uma configuração privada de Wrangler com um D1 local dedicado e
`migrations_dir` apontando para `migrations/beauty-movement`. Nunca reutilize
`BOOKING_DB`, um ID remoto ou dados reais nesta etapa.

```text
npm run beauty-movement:migrate:local -- --database <d1-sintetico>
  --config <wrangler-privado>

npm run beauty-movement:import -- --apply --local ...
  --database <d1-sintetico> --config <wrangler-privado>
  --out-dir <diretorio-privado>

npm run beauty-movement:report -- --local --database <d1-sintetico>
  --campaign <id> --confirm-campaign <id>
  --config <wrangler-privado> --out-dir <diretorio-privado>
```

O importador gera um arquivo SQL privado sem `BEGIN`/`COMMIT` explícitos: o
Wrangler envia o arquivo ao D1 como batch atômico, comportamento que também
funciona no runtime local. Se o batch falhar, não publique links de entrega nem
repita a carga sem inspecionar o resumo privado.

## Evidência de auditoria local em 2026-08-06

- migrations aplicadas duas vezes no mesmo D1 sintético sem reaplicar schema;
- probe de batch com instrução final inválida confirmou rollback integral;
- dry-run completo validou duas linhas sintéticas;
- importação local registrou um cuidado gratuito e uma condição percentual;
- após confirmar sinteticamente uma única linha, o relatório privado retornou
  exatamente essa linha confirmada, sem coluna de cartas; a linha não confirmada
  não foi exportada;
- trigger de D1 recusou uma tentativa de combinar recompensa e paleta de famílias
  diferentes;
- uma revalidação independente criou outro D1 local sintético, reaplicou as
  migrations, carregou duas linhas, confirmou sinteticamente uma delas e gerou
  relatório de uma única linha confirmada; a tentativa de alterar a família de
  recompensa já referenciada foi bloqueada pelo trigger e a família original
  permaneceu preservada;
- em volume Windows/WSL, permissões POSIX aparentam `777`; a restrição efetiva
  é a ACL NTFS herdada do runtime privado, limitada a `Administrators`, `SYSTEM`
  e ao operador `admin`;
- nenhuma credencial, CSV real ou D1 remoto foi utilizado.

## Checklist de publicação

- [ ] Logo/uso público da Velocity confirmado e fornecido como ativo aprovado.
- [ ] Número de WhatsApp de Novo Hamburgo confirmado.
- [ ] Datas, encerramento, texto, validade, regras e versão das condições
      comerciais aprovados para a planilha sanitizada.
- [ ] Catálogo privado de recompensas aprovado por família, com procedimento
      canônico, tipo de desconto e `approvedAt`.
- [ ] CSV sanitizado pode omitir `reward_id`; quando presente, ele é tratado
      apenas como compatibilidade. Nenhum procedimento, CPF ou histórico clínico
      foi incluído.
- [ ] Gate de privacidade concluído para qualquer origem de paleta baseada em
      dados pré-existentes.
- [ ] Migration e smoke com convites sintéticos concluídos em staging.
- [ ] Rate limits de borda sincronizados e verificados.
- [ ] Campanha criada inicialmente como `draft`, com data de encerramento e
      plano de retenção de 90 dias registrados; ativação ainda depende da
      revisão de release.
- [ ] Flag server-side ativada somente para a janela aprovada.

## Rollback e retenção

Para parar a ação sem novo deploy, marque a campanha como `disabled` ou revogue
o lote de convites. Preserve registros pelo período da campanha + 90 dias e só
então execute a eliminação ou anonimização aprovada. O rollback de Worker usa a
versão anterior comprovada; ele não substitui a preservação de dados da
campanha.
