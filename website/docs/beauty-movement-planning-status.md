# Cartas da Beleza em Movimento — estado técnico e de planejamento

**Atualizado em:** 2026-08-06
**Status:** implementação local auditada; campanha continua desativada e não está
apta para produção.

Este documento separa comportamento já implementado de conteúdo, infraestrutura
e aprovações ainda pendentes. Não autoriza carga real, ativação, deploy ou uso de
marca parceira.

## Decisões de produto consolidadas

- Rota pública futura: `/beleza-em-movimento`; prévia sintética:
  `/beleza-em-movimento/local-preview`.
- A unidade da ativação é **Novo Hamburgo** e o Header canônico a mantém fixa
  nesse contexto.
- Espaço Facial lidera visualmente; Velocity aparece apenas como nome textual
  até haver aprovação explícita de logotipo/ativo.
- A experiência é uma mesa única: Beleza, Movimento e Celebração aparecem como
  três mãos sucessivas, não como três páginas ou seções roláveis.
- O baralho fica abaixo da mão. A pessoa clica no próprio baralho para distribuir
  três cartas para cima; a badge apenas orienta a ação.
- Cada mão permite uma única carta. A selecionada revela, as demais são
  recolhidas e a sequência avança após cinco segundos ou pelo controle manual.
  `prefers-reduced-motion` elimina os avanços automáticos.
- Ao fim, as cartas retornam ao baralho e a confirmação, seguida do resultado,
  aparece inline. Não há modal e não há botão “Ver minha leitura”. O refresh
  restaura confirmação ou resultado conforme o estado persistido.
- O benefício é reservado previamente por `reward_id`, independente das cartas.
  A leitura apenas dá forma editorial à experiência; ela não sorteia nem indica
  cuidados.
- O Story é 9:16, usa a linguagem ilustrada das cartas e não inclui nome,
  contato, token, condição ou benefício individual.

## Implementação local comprovada

| Área | Estado | Evidência local de 2026-08-06 |
| --- | --- | --- |
| Fluxo visual | conforme | Prévia de produção local, gerada de cópia nativa sincronizada do worktree atual; baralho clicável, mãos sucessivas, timer de 5 s e resultado inline. |
| Header/Footer e unidade | conforme | Componentes canônicos reutilizados; `fixedUnitSlug="novo-hamburgo"` nas duas rotas. |
| Acessibilidade de interação | conforme localmente | Progresso usa alvo mínimo de 44 px no mobile; grades de cartas são grupos nomeados, sem semântica de lista inválida. |
| Benefícios | conforme no contrato | `reward_id` é validado contra catálogo privado, paleta e procedimento canônico; D1 protege a combinação por trigger. |
| Privacidade | conforme localmente | preview é sintético; URLs, analytics e Story não recebem benefício, paleta, token ou contato. |
| Migrations | conforme localmente | executor usa `wrangler d1 migrations apply --local`; duas execuções consecutivas foram idempotentes. |
| Importação/relatório | conforme localmente | dry-run completo, importação de duas linhas sintéticas e relatório privado sem cartas individuais. |
| Testes | comprovados nesta auditoria | suíte local: 125 testes aprovados, cobrindo convite, recompensa, confirmação, relatório, privacidade e prévia. |
| Tipagem e lint | comprovados nesta auditoria | `tsc --noEmit --incremental false` e `eslint .` concluídos sem falha. |
| Build | comprovado nesta auditoria | Sem servidor concorrente, `next build` e `opennextjs-cloudflare build` concluíram com código 0 em cópia temporária nativa do WSL; o bundle gerou `.open-next/worker.js`. O único aviso foi a sugestão de atualizar a `compatibility_date` global do Wrangler. |

## Correções realizadas nesta auditoria

1. Corrigida a assinatura incompleta de `requireDryRunArguments`, que impedia o
   build TypeScript.
2. Substituído o executor manual de migrations pelo mecanismo oficial e
   idempotente do Wrangler.
3. Removidos `BEGIN`/`COMMIT` explícitos do SQL de importação: o D1 local os
   rejeita, enquanto o arquivo é aplicado pelo Wrangler como batch atômico. Um
   probe sintético confirmou rollback integral quando a última instrução falha.
4. Mantidas as correções anteriores de concorrência de confirmação, rate limit
   token+IP, origem runtime, sanitização de tracking e ausência de contexto de
   conversão no WhatsApp da campanha.
5. O Story passou a usar fonte carregada pela marca e ilustrações editoriais por
   carta; os controles de progresso ganharam alvo de toque mínimo e as grades
   tiveram a semântica ARIA corrigida.
6. O estado público deixou de carregar qualquer prévia de procedimento, desconto
   ou benefício antes da confirmação; apenas o texto genérico de presente
   reservado aparece nesta etapa.
7. O tracking da campanha passou a permanecer first-party e agregado, sem
   encaminhar eventos ao `trackEvent` genérico. O rate limit usa somente o IP
   fornecido pela borda Cloudflare e não cria chaves de token depois de um bloqueio
   por IP.
8. O relatório operacional passou a incluir somente convites confirmados. A
   validação do CSV também rejeita CPF e marcadores clínicos em `invite_ref`, não
   apenas em colunas conhecidas.

## Revalidação independente desta montagem

- Os dois Brand Guides foram reabertos: a página mantém logo em fundo claro,
  paleta `#303030`/`#505050`/`#D0D0D0`/`#FAFAFA`, tipografia de marca, grid de
  8 px, sombras leves e comunicação sem promessas clínicas.
- A prévia local atual usa a build de produção da cópia nativa sincronizada do
  worktree, com `SKINCOS_LOCAL_PREVIEW=true` apenas no processo local. Isso
  mantém a rota sintética disponível sem ativar a campanha. O servidor de
  desenvolvimento no volume Windows/WSL ficou bloqueado em I/O e foi parado;
  ele não é a fonte da prévia entregue. Desktop, tablet e mobile não
  apresentaram overflow horizontal; a unidade exibida pelo Header canônico é
  Novo Hamburgo.
- No navegador, foram validados baralho clicável, três mãos, carta única,
  retorno ao baralho, timer de cinco segundos, avanço manual e automático,
  confirmação inline, benefício posterior ao aceite, CTA de WhatsApp simulado e
  ausência de erros ou avisos de proporção do logo.
- Com `prefers-reduced-motion`, o timer automático não é criado e o controle de
  continuação permanece disponível para a pessoa escolher o avanço manual.
- Em D1 estritamente local, um dry-run e uma carga sintética de duas linhas
  passaram; uma linha confirmada gerou relatório privado de uma única linha. O
  trigger rejeitou uma tentativa de associar recompensa Radiância à paleta
  Ritmo. Os arquivos permanecem no runtime privado, protegido por ACL do
  operador no Windows.

## Gates que continuam bloqueando staging e produção

| Grupo | Gate pendente |
| --- | --- |
| Conteúdo | data, horários, capacidade, endereço, mensagens, regras, validade e versão final das condições. |
| Operação | número oficial de WhatsApp, suporte para correção de dados, regra de aula Velocity e procedimento de resgate. |
| Marca | autorização pública de Velocity e de qualquer logo/ativo adicional. |
| Privacidade/jurídico | base legal, transparência de paleta baseada em dados preexistentes, retenção + 90 dias e classificação promocional. |
| Infraestrutura | D1 dedicado por ambiente, binding `BEAUTY_MOVEMENT_DB`, chaves distintas, origens exatas e rollback ensaiado. |
| Staging | configuração privada, convites sintéticos, Worker local/staging smoke e verificação de rate limit na borda. |
| Publicação | revisão pré-produção, flag habilitada apenas na janela aprovada e monitoramento. |

## Guardrails mantidos

- `BEAUTY_MOVEMENT_ENABLED=false` em produção e staging.
- Nenhum CSV real, CPF, histórico clínico, token real, segredo ou contato real
  foi usado nesta auditoria.
- Não houve deploy, D1 remoto, CRM, analytics real, WhatsApp real, commit, push,
  merge ou PR.
- Arquivos privados de teste ficaram somente em
  `C:\CodexRuntime\operator\admin\skincos\beauty-movement\audit-synthetic`.

## Próxima ação segura

Preparar o pacote de aprovação da Fase 1 a partir de
`docs/beauty-movement-phase1-input-template.md`, mantendo lista real e
configuração privada fora do repositório. Após as aprovações, criar o ambiente
de staging dedicado e executar o mesmo roteiro com convites sintéticos.
