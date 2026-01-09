# Dependabot Configuration

Este projeto utiliza o Dependabot para automatizar atualizações de dependências npm, reduzindo riscos de segurança por dependências desatualizadas.

## Configuração Atual

### Atualização de Dependências NPM
- **Frequência**: Semanal (segunda-feira às 06:00 UTC)
- **Limite de PRs**: Máximo de 5 PRs simultâneos
- **Escopo**: Todas as dependências npm no diretório raiz
- **Formato de commit**: `chore(deps): update dependency [package]`

### Atualização de Dev Containers
- **Frequência**: Semanal
- **Escopo**: Configurações de desenvolvimento em containers

## Como Funciona

1. **Verificação Automática**: Todo segunda-feira às 06:00 UTC, o Dependabot verifica por atualizações disponíveis
2. **Criação de PRs**: Cria Pull Requests para cada dependência que pode ser atualizada
3. **Limite Inteligente**: Nunca cria mais de 5 PRs simultaneamente para evitar sobrecarga
4. **Commits Padronizados**: Utiliza formato consistente de commits para facilitar tracking

## Benefícios

- 🔒 **Segurança**: Mantém dependências atualizadas, reduzindo vulnerabilidades conhecidas
- 🤖 **Automação**: Elimina necessidade de verificação manual de dependências
- 📊 **Controle**: Limite de PRs evita spam de notificações
- 🔄 **Consistência**: Formato padronizado de commits para melhor rastreabilidade

## Configuração do Arquivo

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "06:00"
    open-pull-requests-limit: 5
    commit-message:
      prefix: "chore(deps)"
      include: "scope"
```

## Próximos Passos

Quando a migração para monorepo for concluída, a configuração poderá ser expandida para incluir:
- Múltiplos diretórios de workspace (`packages/*`, `apps/*`)
- Configurações específicas por package
- Agrupamento de atualizações relacionadas