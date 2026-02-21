# Workflow de Criação de Artes e Campanhas (WhatsApp)

> Status: **módulo em construção** (isolado dos demais módulos do CRM).
>
> Escopo desta entrega: apenas contrato de prompt/workflow e governança documental.
> Não há alteração de runtime, rotas, banco, integrações ou comportamento dos módulos existentes.

Este documento formaliza o workflow de produção de criativos para WhatsApp com foco em:
- consistência estética mensal,
- redução de poluição visual,
- legibilidade de oferta,
- e repetibilidade operacional.

## 1) Diagnóstico do sistema atual

### Arquitetura do prompt (vazamentos observados)
- Lock de estilo ainda abstrato demais (`"seguir exatamente"`) abre espaço para invenções (dark/luxo/3D/brilho/pedestal/partículas).
- Falta checklist obrigatório com **componentes mensais objetivos**.
- Falta regra numérica de densidade visual (camadas/elements).
- Falta fallback claro quando o layout estoura.
- Falta anti-repetição operacional de SKUs/packshots.

### Workflow/automação
- Falta protocolo padrão de iteração (1 variação por vez).
- Falta observabilidade (versionamento de prompt/campanha/assets por peça).
- Falta QA gate separado para revisão final.

### Qualidade
- Texto em imagem é ponto de falha recorrente (R$, números, âncoras).
- Falta regra anti-cinematográfica explícita (menos brilho/efeito/card/metal/3D).

### Segurança/compliance
- Guardrails atuais são bons, mas precisam reforço para injetáveis:
  - não destacar agulha/seringa;
  - não sugerir procedimento médico no visual;
  - manter “Avaliação individual” e “Resultados variam”.

### Deploy e formatos
- 4:5 (1080x1350) é formato padrão para mensagem no WhatsApp.
- Status deve ser tratado como variação dedicada (9:16).
- Falta comando de export pack (1:1 + 4:5 + 9:16) sem redesenho total.

## 2) Backlog priorizado

### P0 (bloqueadores)
- **T1 — Checklist visual do mês (componentização)**
- **T2 — QA Gate (prompt revisor)**
- **T3 — Fallback de texto (modo seguro)**

### P1 (escala/performance)
- **T4 — Protocolo de iteração 1-variação**
- **T5 — Anti-repetição operacional por SKU**
- **T6 — Export pack (formatos derivados)**

### P2 (governança)
- **T7 — Versionamento de prompt + changelog**
- **T8 — Registro de performance (observabilidade)**

## 3) Próximo passo padrão (Fase 0)

A primeira entrega recomendada é **T1 — Checklist visual do mês** com:
1. variáveis travadas de assinatura visual do mês,
2. contagens máximas explícitas,
3. contrato objetivo embutido no prompt principal.

Critério de pronto (T1):
- seção “Componentes do mês” presente;
- limites numéricos ativos (decor ≤ 2, camadas ≤ 2, sombras ≤ 1);
- exemplos claros de assinatura da campanha.

## 4) Template A — geração principal (1 peça minimal para WhatsApp)

> Use este template como comando-base operacional.

```txt
Fontes e tons institucionais (brand guide): Eurostile/Eurostile modificada e Cicle Fina; cores institucionais em escala de cinza (K=26/80/90)

========================
ENTRADA (preencha só isto)
========================

#ASSETS (anexos obrigatórios)
{ASSETS_LOGOS}: [anexar]
{ASSETS_ICONES}: [anexar | opcional]
{ASSETS_PRODUTOS}: [anexar]
{ASSETS_BRINDES}: [anexar | opcional]
{REFS_CAMPANHA_MES}: [anexar 3–8 artes]

#CAMPANHA
{MARCA}: Espaço Facial
{CAMPANHA_MES_NOME}: Carna Beleza (Festival do Preenchimento)
{CANAL}: WhatsApp (mensagem)
{CTA}: Chamar no WhatsApp

#OFERTA (texto exato)
{OFERTA_HEADLINE}: Condição VIP no WhatsApp
{OFERTA_INCLUI}: 1 Sculptra + 2mL Restylane Kysse
{ANCORA}: de R$ 4.797
{PRECO_FINAL}: por R$ 2.499
{CONDICAO_PAGAMENTO}: Somente no Pix
{BRINDES}: Brindes: necessaire Sculptra + 1 gloss labial Espaço Facial
{DISCLAIMER}: Avaliação individual. Resultados variam.

#FORMATO
{LARGURA}: 1080
{ALTURA}: 1350
{PROPORCAO}: 4:5
{SAFE_AREA}: 6%

#LOCK DO MÊS (componentes objetivos)
{BG_LOCK}: copiar o gradiente/fundo das referências do mês (não inventar outro)
{DECOR_LOCK}: usar APENAS elementos decorativos do mês em modo MINIMAL:
- 1 cluster roxo (apenas 1 canto)
- 1–2 elementos dourados no máximo
{LAYER_BUDGET}: máximo 2 camadas de fundo (gradiente + textura leve opcional)

#ANTI-POLUIÇÃO (hard rules)
{INFO_BUDGET}: máximo 5 blocos de texto + CTA
{EFFECTS_BUDGET}: máximo 2 efeitos (gradiente simples + sombra suave)
{REPETICAO_SKU}: proibida (cada produto/brinde 1x; se packshot já tem 2 frascos, NÃO adicionar frascos extras)
{PROIBIDO}: pedestal 3D, glitter/partículas, flare, bevel, múltiplos cards/caixas, fundo dark cinematográfico

#LOGO
{LOGO_VARIANTE}: AUTO (POSITIVO em fundo claro | NEGATIVO em fundo escuro/colorido)
{LOGO_POSICAO}: TOPO_CENTRO
{LOGO_TAMANHO}: 8–12% da largura
{LOGO_CLEARSPACE}: {SAFE_AREA}

#TIPOGRAFIA (brand)
{FONT_PRIMARIA}: Eurostile (títulos/preço)
{FONT_SECUNDARIA}: Cicle Fina (apoio/rodapé)

#LAYOUT
{LAYOUT_OPCAO}: B
A: produtos à esquerda + texto/preço à direita
B: texto/preço em cima + produtos embaixo (mais minimal)

#OUTPUT
{OUTPUT_MODE}: MASTER+FINAL
MASTER+FINAL = entregar (A) master sem texto + (B) final com texto
APENAS_FINAL = entregar apenas final com texto
GUIA_DE_LAYOUT = entregar master sem texto + guia curto de aplicação de texto

========================
PROMPT (não edite abaixo)
========================

Você é Diretor de Arte de Performance para {CANAL}. Gere UMA peça minimalista, consistente com {CAMPANHA_MES_NOME}, com legibilidade instantânea e sem poluição visual.

0) CHECKPOINT (interno)
- Use EXCLUSIVAMENTE os anexos. Se algum asset faltou, não inventar: deixar espaço reservado limpo.

1) ESTILO DO MÊS (LOCK)
- Fundo: {BG_LOCK}
- Decoração: {DECOR_LOCK}
- Respeitar {LAYER_BUDGET}. Visual vibrante, mas clean.

2) COMPOSIÇÃO
- Tamanho exato: {LARGURA}x{ALTURA} ({PROPORCAO})
- Safe area: {SAFE_AREA} em todos os lados
- Logo: {LOGO_POSICAO}, {LOGO_TAMANHO}, {LOGO_VARIANTE}, com {LOGO_CLEARSPACE}
- Produtos: 1 agrupamento único (Sculptra + Restylane). NÃO duplicar SKUs.
- Brindes: 1 linha pequena/miniaturas (necessaire + gloss), sem pedestal e sem repetir.

3) TEXTO (usar exatamente)
{OFERTA_HEADLINE}
{OFERTA_INCLUI}
{ANCORA} {PRECO_FINAL}
{CONDICAO_PAGAMENTO}
{BRINDES}
CTA: {CTA}
Rodapé: {DISCLAIMER}

4) ANTI-POLUIÇÃO (hard)
- {INFO_BUDGET}; {EFFECTS_BUDGET}; {REPETICAO_SKU}; {PROIBIDO}
Se estourar budget: remover (1) textos secundários (2) decor extra (3) ícone extra; manter sempre: PREÇO + CTA + OFERTA.

5) HIERARQUIA (2s mobile)
Headline → preço final → âncora → tag Pix → CTA → brindes → disclaimer

6) SAÍDA
- Se {OUTPUT_MODE}=MASTER+FINAL: entregar A) master sem texto B) final com texto
- Se {OUTPUT_MODE}=GUIA_DE_LAYOUT: entregar master + guia curto
- Se {OUTPUT_MODE}=APENAS_FINAL: entregar só final
```

## 5) Template B — QA Gate (revisão antes de publicar)

```txt
Você é QA de criativos de performance para WhatsApp.

Analise a imagem final e devolva um relatório PASS/FAIL com correções objetivas, sem enrolar.

Checklist (marque PASS/FAIL e diga como corrigir):
1) Legibilidade em 2s (headline + preço + CTA)
2) Safe area {SAFE_AREA} respeitada (nenhum texto/CTA colado na borda)
3) Anti-poluição: {INFO_BUDGET} e {EFFECTS_BUDGET}
4) Repetição de produto: {REPETICAO_SKU}
5) Estilo do mês: fundo/gradiente + decor assinatura minimal (sem dark cinema)
6) CTA com contraste e sem glow pesado
7) Preço escrito corretamente ({PRECO_FINAL}) e âncora correta ({ANCORA})

Se qualquer item der FAIL, escreva:
- “Correção 1 (mais importante)”
- “Correção 2”
- “Correção 3”
E finalize com um prompt curto de correção (1 tentativa) mantendo o estilo do mês e reduzindo poluição.
```

## 6) Template C — Depollute/Minimalizar

```txt
Objetivo: pegar a imagem atual e REFAZER em versão minimalista, mantendo a campanha do mês.

Regras:
- Remover pedestais/3D excessivo, partículas, glow, múltiplos cards.
- Manter: 1 logo, 1 headline, 1 preço, 1 tag Pix, 1 CTA, 1 grupo de produtos, 1 linha de brindes.
- Decor do mês: somente 1 cluster roxo + 1–2 dourados, fundo igual às referências.
- Não repetir produtos. Não inventar novos assets.

Saída: 1 arte final em {LARGURA}x{ALTURA} ({PROPORCAO}) mais clean e sofisticada.
```

## 7) Protocolo recomendado de execução

1. **Composição primeiro**: gerar MASTER sem texto e aprovar.
2. **Tipografia depois**: gerar FINAL com texto apenas após aprovação da composição.
3. **Sempre 1 variação por vez** (`{N_VARIACOES}=1`).
4. **Rodar QA Gate** antes de publicar.
5. Em falha de texto/preço, usar fallback `MASTER+GUIA_DE_LAYOUT`.

## 8) Governança mínima

- Identificador de prompt (ex.: `EF_WA_MIN_v3`).
- Changelog curto por versão.
- Registro por criativo (planilha/DB):
  - `prompt_id`
  - `campanha`
  - `criativo_id`
  - `headline`
  - `preco`
  - `resposta` (CTR/conversa)


## 9) Critérios para incorporação no CRM (aba dedicada)

Para reduzir risco de regressão nos demais módulos, a incorporação ao CRM deve seguir este contrato:

- Feature flag de UI (ex.: `VITE_ENABLE_CREATIVE_WORKFLOW_TAB`) para liberar a aba de forma controlada.
- Novas APIs, quando existirem, devem ficar sob namespace próprio (ex.: `/api/creative-workflow/*`) sem alterar contratos existentes.
- Persistência desacoplada (tabela/coleção própria para `prompt_id`, `campanha`, `criativo_id`, metadados de QA).
- Rollout por ambiente (dev → staging → produção), com fallback simples: ocultar aba e manter fluxos atuais intactos.
- Definição de pronto para merge funcional: zero impacto em testes/smokes dos módulos atuais e checklist de QA aprovado.
