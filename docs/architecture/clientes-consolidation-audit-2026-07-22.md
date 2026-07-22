# Auditoria de consolidação — Clientes

Data da auditoria: 22/07/2026. Referência integrada analisada: `origin/main` em
`f9a22cde`. Este documento distingue código integrado, código em ramos locais e
dados existentes somente no banco PostgreSQL local `skincos_crm_local`; não
declara nenhum destes últimos como publicado.

## Checklist de estado

### Concluído e integrado antes desta consolidação

- Importação auditável do Caixa: PR #703 (`96487709`) e ajuste de unidade PR
  #706 (`17410e84`). Inclui o endpoint de prévia/importação Google Sheets e o
  domínio persistente de vendas/itens.
- A `main` contém a API e a interface do Caixa, mas não contém os registros
  importados: a presença dos 5.338 registros foi observada somente no banco
  local.

### Implementado, testado e trazido nesta consolidação

- `75cc1f48` e `f8af4b04`: clientes canônicos do Atendimento, sugestões de
  grafia e fusões apenas quando existe uma âncora confiável.
- `00fff65e` e `0becbcf9`: correlação com cadastro exportado do app e
  persistência de identidades globais, sem usar intervalo entre venda e
  procedimento como evidência.
- `4567bdbc`: importação de perfis da planilha complementar e ligações
  conservadoras com app/Caixa.
- `050805f1`: perfil comercial 360º, segmentos e fila de ações assistidas no
  módulo Clientes. A recência é calculada somente a partir de atendimento
  realizado; vendas antecipadas permanecem separadas.
- `df20ae25` a `db6917e6`: exportador read-only do cadastro do app, com
  paginação, checkpoint, retomada de sessão e verificação da unidade.

Esses commits foram aplicados sobre a `main` atual neste ramo, preservando o
módulo Financeiro que já existia na navegação. A única divergência foi em
`crm/console/App.tsx`: o resultado mantém simultaneamente `finance` e
`clientes` entre os módulos habilitados.

### Somente banco local na data da auditoria

- 5.338 vendas e 5.903 itens do Caixa: 2.648 classificados e 3.255 pendentes.
- 8.436 atendimentos; 1 data futura é excluída da recência comercial.
- 2.779 identidades globais e 8.144 membros: 2.802 de cadastro do app, 1.531
  de Atendimento, 2.299 do Caixa e 1.512 da planilha complementar.
- 36.424 perfis complementares, com 3.652 ligações ao app e 1.854 ao Caixa.
- Política comercial criada localmente, sem cadências clínicas aprovadas e sem
  ações comerciais registradas.

Não foi executada nesta consolidação qualquer carga, fusão, migração ou deploy
em ambiente remoto.

### Incompleto ou propositalmente bloqueado

- A seção de revisão humana de sugestões/ambiguidade ainda não foi exposta no
  módulo Clientes. As sugestões existem no banco local, mas não há interface
  de aprovação nesta entrega.
- Não há fonte canônica ligada às identidades para consentimento, não-contato e
  descadastro. A fila não envia WhatsApp/e-mail automaticamente, mas também não
  pode ainda bloquear a criação de uma ação com base nessas preferências.
- Não há regra de afinidade/ticket entre procedimentos aprovada pela equipe
  clínica e comercial; por isso não há recomendação de cross-sell.
- Cadências clínicas começam como rascunho e só aparecem como referência após
  aprovação explícita. Não inferem saldo de pacote, necessidade clínica nem
  procedimento realizado.

### Dependências e decisões para ativação posterior

1. Escolher o ambiente de destino, aplicar as migrações do Atendimento e
   executar as importações/reconciliações de forma auditada naquele ambiente.
2. Definir uma fonte única e verificável de consentimento e não-contato, além
   da regra de precedência para conflitos entre canais.
3. Disponibilizar a revisão humana das sugestões antes de qualquer nova fusão
   fora das regras automáticas conservadoras.
4. Aprovar por procedimento/unidade as cadências clínicas e, separadamente,
   as regras comerciais de oportunidade de ticket.
5. Antes de um piloto, definir unidade, responsável, grupo de comparação,
   mensagens aprovadas e métricas de venda recuperada, agendamento e retorno
   clínico como eventos distintos.

## Validação desta consolidação

- API: `npm --prefix crm/api test` — 99 testes aprovados.
- Console: `npm --prefix crm/console test -- --run crmRoleAccess.test.ts` —
  11 testes aprovados.
- Exportador do app: 5 testes aprovados no ambiente Python privado existente.
- Verificação estática: `git diff --check` sem erros.

O build completo do Console não foi usado como sinal de sucesso nesta auditoria:
no worktree Windows/WSL isolado o compilador TypeScript ficou pendente sem
produzir resultado e foi encerrado. Os processos temporários foram removidos;
o build precisa ser repetido no pipeline/ambiente de release antes de deploy.
