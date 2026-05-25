# Tooltips no CRM

## Objetivo
`@/tooltip` é a base oficial para ajuda contextual curta no CRM. Use tooltip para reduzir ruído visual sem esconder contexto importante.

## Quando usar
- Botões `icon-only`
- Siglas e métricas abreviadas
- Badges de status ou labels ambíguos
- Cabeçalhos curtos de tabela
- Texto truncado
- Ações sensíveis quando uma dica curta reduz erro operacional

## Quando não usar
- Explicações longas, críticas ou com múltiplos passos
- Conteúdo que precisa de ação dentro da própria ajuda
- Informação essencial para completar uma tarefa

Nesses casos, prefira:
- `Popover` para conteúdo mais rico ou acionável
- `Dialog` para contexto crítico
- texto inline para instrução indispensável

## Comportamento padrão
- Desktop: abre em `hover` e `focus`
- Teclado: abre em `focus`, fecha de forma previsível e responde a `Escape`
- Mobile/tablet: toque abre tooltip; toque fora fecha
- Posicionamento: automático via Radix, com `collisionPadding` centralizado

## Acessibilidade mínima
- O gatilho deve ser focável quando o conteúdo precisar ser acessado por teclado
- Ícones e botões devem manter `aria-label` quando aplicável
- Tooltips devem ser curtos e legíveis, não substituir labels obrigatórias
- Não depender de `title=` nativo como solução padrão

## Exceções permitidas
- `title` em `iframe` quando exigido por acessibilidade/semântica do elemento
- props chamadas `title` em componentes internos, desde que não sejam tooltip nativo do navegador

## Componentes oficiais

### `TooltipLabel`
Use para badges, siglas, cabeçalhos e elementos curtos.

```tsx
<TooltipLabel label="CTR" description="Taxa de cliques sobre impressões.">
  <span tabIndex={0}>CTR</span>
</TooltipLabel>
```

### `TooltipButton`
Use para botões de ícone e ações rápidas.

```tsx
<TooltipButton label="Atualizar">
  <Button size="icon" aria-label="Atualizar">...</Button>
</TooltipButton>
```

### `TooltipIcon`
Use para um ícone autônomo de ajuda/estado.

```tsx
<TooltipIcon
  label="Conexão ativa"
  description="A conta está pronta para operar."
  icon={<CheckCircle className="h-4 w-4" />}
/>
```

### `TooltipTruncate`
Use para texto com truncamento visual.

```tsx
<TooltipTruncate text={fileName} className="max-w-[180px]" />
```

## Regras de conteúdo
- Priorize um título curto
- Use descrição apenas quando ela realmente evita dúvida
- Evite tooltips longos, genéricos ou redundantes
- Se o texto já estiver completamente claro na interface, não adicione tooltip

## Regra para Popover
`Popover` não substitui tooltip. Mantenha `Popover` apenas quando houver:
- múltiplas linhas com estrutura rica
- interação interna
- navegação, seleção ou ação
