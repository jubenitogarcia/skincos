# Onboarding Identity → Workforce → convite

## Estado anterior observado

1. Inventory validava cargo/unidades e cifrava os contatos.
2. Inventory sincronizava o funcionário no Workforce por service binding HMAC.
3. Workforce gravava o funcionário como `ACTIVE`, inclusive para `PENDING_ACCESS`.
4. Inventory criava o convite e tentava enviá-lo por SMTP.
5. Só depois persistia o ledger `crm_employee_onboarding`.

Uma falha entre os passos 2–5 podia deixar funcionário Workforce ativo, convite revogado ou ledger ausente.

## Contrato atual

O ledger é criado primeiro com `provisioning_state=PROVISIONING`. Cada etapa atualiza o estado e mantém `correlation_id`, sem registrar PII nos eventos. O Workforce recebe o estado canônico e mapeia estados não operacionais para o status técnico existente `LEAVE`:

| Identity | Workforce `access_state` | Workforce `status` | Operacional |
|---|---|---|---|
| `PENDING_ACCESS` | `PENDING_ACCESS` | `LEAVE` | não |
| `INVITED` | `INVITED` | `LEAVE` | não |
| `ACTIVE` | `ACTIVE` | `ACTIVE` | sim |
| `SUSPENDED` | `SUSPENDED` | `LEAVE` | não |
| `TERMINATED` | `TERMINATED` | `TERMINATED` | não |

Falha no Workforce marca o ledger como `FAILED` sem criar convite. Falha de entrega revoga o convite, rebaixa o Workforce para `PENDING_ACCESS` e registra a compensação. O token é mantido apenas cifrado para retomada idempotente; seu hash continua sendo o único valor usado para consumo.

O consumo do convite cria o usuário Identity inativo, ativa o Workforce por chamada HMAC idempotente e só então ativa o usuário e fecha o ledger. Se a ativação falhar, a conta permanece inativa e o Workforce não recebe acesso operacional.

## Escopo de staging

O fluxo de staging do Ponto usa o projeto Pages dedicado `skincos-ponto-staging` e sua origem imutável `skincos-ponto-staging.pages.dev`. Nenhuma rota do CRM independente ou do monorepo é usada como compatibilidade.
