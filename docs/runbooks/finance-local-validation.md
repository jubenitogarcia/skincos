# Financeiro local production-like

O runtime local do Financeiro sobe a mesma cadeia que o navegador utiliza:

1. D1 local privado com migrations de `inventory` (identidade CRM) e `finance`;
2. gateway `api` local, montando o handler proprietário `finance`;
3. Pages Functions + Vite do CRM, com `/api/finance/*` encaminhado ao gateway
   local;
4. um único usuário local `finance-local` e grants mínimos do cenário escolhido.

Nenhuma credencial, cookie, snapshot ou dado de produção é copiado. O bypass
local só é aceito pelo gateway quando ele está em loopback e recebeu as variáveis
de runtime `LOCAL_FINANCE_AUTH_BYPASS` e `LOCAL_FINANCE_CSRF_TOKEN`; em qualquer
outro ambiente ele continua usando exclusivamente a sessão CRM normal.

## Comandos

```bash
npm run crm:local:finance
npm run crm:local:finance -- --scenario nh --browser
npm run codex:crm:finance-smoke -- --scenario both
npm run crm:local:finance:status
npm run crm:local:finance:ports
npm run crm:local:finance:stop
```

O launcher informa a URL confirmada, normalmente
`http://localhost:<porta>/?module=finance`. Ele seleciona uma porta livre perto
de `8792` para o gateway e usa a faixa própria `5192+` para Vite, separada do
launcher CRM genérico. Antes de escolher, verifica processos WSL e respostas
HTTP de relays Windows; Pages continua perto de `8793`. `--stop` só encerra
processos cuja linha de comando prova pertencer a este worktree.

## Cenários

| Cenário | Flag | Módulo | Grants |
| --- | --- | --- | --- |
| `disabled` | desligada | `finance` | nenhum |
| `no-module` | ligada | ausente | nenhum |
| `no-grant` | ligada | `finance` | nenhum |
| `nh` | ligada | `finance` | Novo Hamburgo |
| `bss` | ligada | `finance` | BarraShoppingSul |
| `both` | ligada | `finance` | as duas unidades |

O escopo pessoal não recebe grant em cenário algum e permanece inativo no D1.
Cada inicialização remove apenas grants do usuário `finance-local`, recria seu
registro mínimo no `crm_users` e atualiza a feature flag local. Não toca em
outros dados locais, e nunca conecta ao D1 remoto.

## Smoke headless

`--smoke` usa Playwright headless para validar navegação, bootstrap, grants,
isolamento do contexto pessoal, ausência de erros de console e resposta do
proxy `/api/finance`. Use `--exit-after-smoke` em CI ou em uma verificação
efêmera; o launcher encerra Gateway, Pages e Vite no fim.

Como o plugin Browser não está disponível neste ambiente, a validação local usa
o Playwright já instalado no runtime privado. Os artefatos ficam fora do Git em
`C:\CodexRuntime\operator\admin\skincos\runtime\finance-local`.
