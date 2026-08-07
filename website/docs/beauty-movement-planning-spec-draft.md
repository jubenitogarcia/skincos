# Cartas da Beleza em Movimento — especificação de planejamento (rascunho)

**Status:** rascunho colaborativo, não aprovado para release
**Data:** 2026-08-04
**Escopo:** completar os 20 entregáveis de planejamento solicitados na thread,
separando o que foi confirmado do que ainda exige decisão, conteúdo ou
evidência operacional.

Este documento não transforma recomendações em requisitos definitivos. Valores
de evento, benefício, contato, marca parceira, privacidade e publicação só se
tornam válidos após confirmação explícita e evidência correspondente.

## Legenda de estado

- **Consolidado:** definido no plano explícito desta thread.
- **Evidência:** encontrado no código/documentação atual, mas pode não ser o
  valor final da campanha.
- **Recomendação:** proposta para facilitar a decisão; não é aprovação.
- **Pendente:** falta decisão, conteúdo, credencial, ambiente ou validação.

## 1. Resumo executivo

Ativação digital pré-evento da Espaço Facial Novo Hamburgo em parceria com a
Velocity, destinada a pessoas convidadas por WhatsApp. A experiência apresenta
um baralho editorial com três atos — Beleza, Movimento e Celebração — e usa a
leitura como caminho para confirmar a entrada em uma lista exclusiva.

O resultado é lúdico e editorial. Não há sorteio, diagnóstico, recomendação
clínica, promessa de resultado ou previsão real do futuro. O benefício é sempre
propriedade do convite previamente configurado, nunca das cartas.

**Pendente:** datas, turmas, endereço/horários específicos da ação, condições,
benefício final e aprovação do uso público da parceria.

## 2. Objetivo principal e objetivos secundários

**Principal — consolidado:** confirmar a entrada de uma pessoa convidada em uma
lista exclusiva do evento.

**Secundários — consolidados:**

- organizar o contato operacional da unidade;
- revelar, após confirmação, a condição previamente vinculada ao convite;
- oferecer uma leitura curta e compartilhável;
- incentivar compartilhamento orgânico sem expor dados individuais.

**Fora do escopo do MVP:** CRM, painel administrativo público, mídia paga com
conversões, RSVP por turma e recomendação de procedimentos.

## 3. Público e jornadas de uso

### Jornada online de convite válido

1. A pessoa recebe um link opaco por WhatsApp.
2. O fragmento é trocado por sessão segura e removido da URL.
3. A pessoa percorre os três atos e escolhe uma carta em cada um.
4. Confirma os dados vinculados ao convite e o consentimento operacional.
5. Vê sua leitura, convite, benefício configurado e condições.
6. Pode falar com a equipe ou preparar o Story.

### Jornadas de falha e repetição

- convite inválido, expirado ou revogado: redirecionamento institucional genérico;
- retorno à mesma sessão: leitura e escolhas restauráveis apenas para a pessoa;
- confirmação repetida: operação idempotente;
- correção de contato: direcionamento para suporte da unidade, sem atualização
  pública pelo frontend.

### Prévia local

Usa dados sintéticos, não chama API/D1/analytics real e simula o CTA de
WhatsApp. Serve para revisão visual e de conteúdo, não para validar a sessão
online real.

**Pendente:** confirmar se haverá somente uso pré-evento por convite ou também
ativação presencial por QR Code/tablet e jornada pós-evento.

## 4. Narrativa e direção criativa

**Nome consolidado:** Cartas da Beleza em Movimento.
**Abertura consolidada:** “Beleza que se move com você.”
**Tom:** editorial, lúdico, acolhedor e promocional com moderação; sem estética
de cassino, horóscopo genérico, jogo infantil ou esoterismo pesado.

**Direção visual consolidada:**

- fundo `#FAFAFA`;
- títulos e CTAs da campanha em `#303030`;
- textos secundários em `#505050`;
- bordas/divisores em `#D0D0D0`;
- tipografia `--font-brand-ui` e `--font-brand-text`;
- grid de 8 px, cantos de 8–12 px e sombras discretas;
- verde reservado ao CTA `AGENDE` do Header real;
- Velocity apenas como texto até aprovação de logo/uso público.

**Evidência de marca verificada em 2026-08-04:** o `Brand Guide 1.pdf`
identifica Eurostile/Eurostile modificada/Cicle Fina e as referências de branco,
cinza claro e cinza escuro; o `Brand Guide 2.pdf` confirma o sistema
monocromático, o logo em fundo claro com área de respiro, a paleta hexadecimal
`#303030`/`#505050`/`#D0D0D0`/`#FAFAFA` e o grid de 8 px com cantos de 8–12 px e
sombras leves. O segundo guia é operacional e declara que materiais oficiais da
franqueadora prevalecem; por isso a aprovação/licença dos ativos finais continua
um gate antes de publicação.

**Pendente:** aprovação final da presença nominal da Velocity e eventual ativo
visual fornecido pela parceira.

## 5. Mecânica completa

- Uma única mesa, sob um único heading dinâmico: não há páginas nem seções de
  cartas separadas.
- Beleza é a primeira mão; Movimento e Celebração permanecem bloqueados até a
  mão anterior ser concluída.
- O baralho fica abaixo das três posições. O próprio baralho é o controle que
  distribui a mão de baixo para cima; a badge apenas explica o gesto.
- Cada mão tem três cartas, uma única escolha e nenhuma troca. A selecionada
  revela, as demais são recolhidas e a próxima mão é distribuída.
- Após a revelação há barra regressiva de cinco segundos e avanço manual. O
  avanço automático é cancelável; `prefers-reduced-motion` não agenda avanço.
- A navegação compacta no hero evidencia em amarelo somente a etapa atual e só
  ela pode receber clique.
- Após a terceira carta, todas voltam ao baralho e a confirmação aparece inline.
  A confirmação idempotente troca a mesma área pelo resultado completo.
- Não há modal nem CTA “Ver minha leitura”. O refresh restaura confirmação ou
  resultado conforme o estado da sessão.

**Consolidado no produto local:** sim.
**Pendente para release:** validar a experiência com conteúdo final e dispositivos
reais do público convidado.

## 6. Mapa das cartas

Cada paleta possui seis cartas comuns (duas por ato) e uma assinatura própria
por ato, totalizando nove cartas por paleta.

| Ato | Comuns | Radiância | Ritmo | Conexão |
| --- | --- | --- | --- | --- |
| Beleza | Presença, Autocuidado | Radiância | Autoria | Harmonia |
| Movimento | Constância, Potência | Leveza | Ritmo | Sintonia |
| Celebração | Confiança, Renovação | Brilho | Impulso | Encontro |

As mensagens são editoriais e não geram recomendação clínica nem benefício.

**Pendente:** decidir se a paleta será sempre atribuída manualmente na lista
sanitizada (recomendação para o MVP) ou se haverá classificação privada baseada em
dados preexistentes após gate de privacidade.

## 7. Fluxo de telas

1. Header real do site.
2. Hero da campanha e assinatura textual da parceria.
3. Navegação compacta de progresso, com a etapa atual em amarelo.
4. Mesa única: baralho clicável, primeira mão e revelação.
5. Recolhimento e distribuição da segunda e terceira mão.
6. Confirmação inline com WhatsApp mascarado, e-mail opcional e aceite.
7. Resultado inline: três cartas finais ilustradas, síntese, convite, benefício
   reservado, condições, CTA de equipe e Story.
8. Footer real do site.

**Consolidado:** Header/Footer são componentes reais reutilizados diretamente nas
rotas online e local.

## 8. Momento e campos do cadastro

O cadastro ocorre após a terceira carta.

| Campo/estado | Tratamento planejado |
| --- | --- |
| WhatsApp | já vinculado ao convite e exibido mascarado |
| E-mail | opcional; não substitui e-mail pré-registrado |
| Consentimento | um aceite operacional para lista e comunicações do evento |
| CPF | nunca chega ao D1, frontend, URL, relatório ou analytics |
| Histórico de procedimentos | somente ambiente privado, se houver gate aprovado |
| Correção de dados | suporte da unidade; sem edição pública |

**Pendente:** redação jurídica final do aceite, finalidade e retenção, além da
decisão formal sobre qualquer uso de dados preexistentes.

## 9. Lógica de resultados

O resultado contém:

- três cartas escolhidas;
- síntese editorial curta;
- convite da campanha;
- benefício previamente configurado no convite;
- condições da campanha após confirmação;
- CTA para falar com a equipe;
- preparação do Story.

Para `aula_cortesia_evento`, o texto informa a aula-cortesia e a confirmação
posterior de turma. Para `evento_condicao_comercial`, exibe a condição exata
importada e sua versão. Nenhuma dessas decisões é sorteada pelas cartas.

**Pendente:** textos, validade e regras finais dos dois status de benefício.

## 10. Estratégia de compartilhamento

- formato Story 9:16;
- três cartas e assinatura das marcas;
- Web Share API quando disponível;
- download local como fallback;
- nenhum nome, contato, token, status, benefício individual ou link individual;
- prévia local não abre aplicativo externo.

**Consolidado no produto local:** sim.
**Pendente:** aprovação editorial da assinatura final e teste em aparelhos que
serão usados no evento.

## 11. CTAs

**Consolidados:**

- `Clique no baralho` (badge de orientação; o baralho é o controle);
- avanço manual da mão atual;
- `Confirmar minha entrada`;
- `Falar com a equipe`;
- `Preparar Story para compartilhar`;

O CTA online usa o redirecionamento rastreável de WhatsApp existente, sem o
envelope de conversão Meta/Google do MVP. O CTA local apenas simula a abertura.

**Pendente:** texto oficial das mensagens de WhatsApp para os dois benefícios e
confirmação do número da ação.

## 12. Dados e integrações

### Fonte privada

CSV sanitizado com nome, WhatsApp, e-mail opcional, paleta, status de benefício,
texto/validade/regras da condição e versão dos termos. CPF e histórico ficam
fora do D1 e do repositório.

### D1 dedicado

O schema prevê campanhas, convites, sessões, escolhas, rate limits e execuções
de importação. O relatório operacional é privado e não exibe cartas individuais.

### Integrações preservadas

- sessão e APIs dedicadas da campanha;
- consentimento e tracking do site;
- UTMs e identificadores de mídia conforme consentimento;
- redirecionamento rastreável de WhatsApp;
- sem CRM, painel público ou conversões Meta/Google no MVP.

**Pendente:** criar/configurar D1 por ambiente, binding, chaves, origens e
primeiro dry-run privado.

## 13. Analytics

Eventos previstos:

- abertura;
- visualização agregada de seção;
- revelação;
- confirmação;
- resultado;
- abertura de condições;
- WhatsApp;
- compartilhamento.

Os parâmetros permitidos são somente estágio, índice do ato e método de
compartilhamento. Token, CPF, contato, paleta, elegibilidade e condição
individual não entram nos eventos.

O tracking é bloqueado sem consentimento analítico; IDs de mídia seguem as
regras gerais de consentimento.

**Pendente:** validação em staging da ausência de PII e confirmação de que não
haverá envio de conversões externas no MVP.

## 14. Privacidade e segurança

Guardrails consolidados no desenho:

- troca de token opaco por cookie de sessão `HttpOnly`;
- expiração, revogação e confirmação idempotente;
- validação de origem;
- rate limit por token/IP;
- mensagens genéricas para convites inválidos;
- sem atualização pública de contato;
- dados pessoais cifrados no D1;
- CPF/histórico fora do site e do D1;
- retenção de campanha + 90 dias.

**Pendente:** gate formal de finalidade/necessidade/transparência para dados
preexistentes, decisão eliminação versus anonimização e evidência de rate limit
de borda em staging.

## 15. Arquitetura técnica proposta

- rota online `/beleza-em-movimento`;
- prévia `/beleza-em-movimento/local-preview` protegida por flag local;
- `BeautyMovementCampaign` para sessão online;
- `BeautyMovementExperience` para a jornada compartilhada;
- APIs `/session`, `/state`, `/reveal` e `/confirm`;
- migration D1 isolada em `migrations/beauty-movement/`;
- importador e relatório privados;
- flag server-side `BEAUTY_MOVEMENT_ENABLED`, default `false`;
- rollback operacional por desativação/revogação e retorno da versão anterior.

**Estado atual:** schema, importador privado, relatório e contratos foram
exercitados somente com D1 local sintético. `BEAUTY_MOVEMENT_DB` ainda não está
configurado por ambiente no Wrangler; não há staging aplicado.

## 16. Componentes reutilizáveis

- `Header` e `Footer` reais;
- variáveis tipográficas e ativos oficiais da Espaço Facial;
- consentimento e tracking do site;
- redirecionamento rastreável de WhatsApp;
- helpers de sessão, segurança e cifragem;
- padrões de testes, build e lint do website;
- `BeautyMovementExperience` compartilhado entre online e prévia local.

## 17. Riscos e pendências

| Risco | Prioridade | Mitigação/estado |
| --- | --- | --- |
| benefício ou condição ainda não aprovados | P0 | não importar lista real nem ativar |
| contato ou endereço da ação divergirem da unidade atual | P0 | confirmar pacote operacional |
| uso público indevido da marca parceira | P0 | manter Velocity textual |
| dados preexistentes de saúde sem gate | P0 | paleta manual no MVP ou aprovação jurídica/privada |
| D1/segredos/origens ausentes | P0 | criar ambiente dedicado antes do staging |
| rate limit/rollback sem evidência | P1 | smoke e release record obrigatórios |
| conteúdo editorial ainda sofrer alterações | P1 | campanha em `draft` até revisão |
| diferença entre prévia e sessão online | P1 | smoke com convites sintéticos |

## 18. Fases de implementação

| Fase | Estado |
| --- | --- |
| 1. aprovar conteúdo, logo, condições e lista sanitizada | pendente |
| 2. D1 isolado, importador, sessão e relatório | código criado; ambiente ainda pendente |
| 3. jornada, cartas, resultado, WhatsApp e Story | concluída localmente |
| 4. consentimento, analytics e testes | concluída localmente |
| 5. staging sintético, carga privada, publicação controlada | não iniciada |

## 19. Critérios de aceite

### Produto/local — evidência já obtida

- Header/Footer reais presentes;
- mesa única, baralho abaixo e três mãos distribuídas;
- bloqueio/desbloqueio progressivo e apenas uma etapa navegável por vez;
- carta selecionada imutável, recolhimento e nova mão;
- regressiva de cinco segundos, avanço manual e movimento reduzido;
- confirmação e resultado inline restauráveis;
- Story sem dados individuais;
- WhatsApp local sem navegação externa.

### Release — ainda não comprovado

- migration aplicada em D1 dedicado de staging;
- convites sintéticos válidos, expirados e revogados;
- ambos os benefícios configurados;
- dry-run privado do CSV;
- rate limits e origens verificados;
- smoke pós-rollback;
- condições e contato oficiais aprovados;
- flag/coorte e janela de ativação registrados.

## 20. Complexidade relativa

**Média-alta.** A camada visual é controlada e já foi prototipada. O maior
esforço restante está na integridade dos convites, preparação de dados privados,
configuração D1/segredos, validação de staging e operação reversível.

## MVP recomendado e evoluções

### MVP recomendado

Manter três atos, três escolhas em mesa única, paleta manual na lista
sanitizada, benefício pré-configurado, confirmação operacional e resultado
inline, Story e WhatsApp, sem CRM, sem histórico clínico e sem conversões
externas.

### Evoluções posteriores

- RSVP e turmas quando agenda estiver fechada;
- CRM integrado;
- novas paletas;
- fotografia/vídeo do evento;
- mídia paga com conversões aprovadas;
- continuidade pós-evento.

## Próximas decisões bloqueadoras

1. Confirmar o pacote final de datas, turmas, contato, benefício e condições.
2. Confirmar Velocity somente como texto ou fornecer aprovação/ativo de logo.
3. Confirmar paleta manual para o MVP ou abrir o gate privado de dados
   preexistentes.

Até essas decisões e evidências existirem, o documento permanece rascunho e a
campanha deve continuar desativada.
