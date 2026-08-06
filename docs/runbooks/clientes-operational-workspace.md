# Workspace operacional de Clientes

## Escopo

O módulo Clientes continua montado como `clientes` no shell do CRM, mas agora
possui rotas navegáveis e contratos de leitura separados. A implementação é
somente uma evolução de leitura/triagem; não abre canário comercial, não envia
mensagens e não concede permissão de contato.

Rotas suportadas:

- `/clientes/visao-geral`
- `/clientes/carteira`
- `/clientes/acoes`
- `/clientes/identidades`
- `/clientes/qualidade`
- `/clientes/governanca`
- `/clientes/cliente/:identityId`

`?module=clientes&clientesView=...` permanece aceito apenas como ponte de
compatibilidade e é normalizado para o pathname allowlisted. A URL preserva
somente filtros conhecidos (`unit`, `segment`, `priority`, `q`, `page`,
`pageSize`, `sort`, `direction`, `assigned`, `sla`, `permission`, `review`,
`stale`, `columns` e `view`). Contato, telefone, e-mail e outros campos de
PII não são aceitos como parâmetros operacionais.

## Carteira

A Carteira usa exclusivamente `GET /api/atendimento/commercial/wallet?server=1`.
O contrato de resposta é `crm-clientes-wallet/v1`, com `total`, `limit`,
`offset`, ordenação, `hasPrevious`/`hasNext` e agregados calculados no banco.
Se a resposta não confirmar `pagination.mode=sql`, o painel falha fechado e
não exibe uma primeira página enganosa.

Filtros combináveis: unidade, segmento, prioridade, busca, responsável, SLA
vencido, permissão expirando, identidade em revisão e dados stale. A busca e a
ordenação são executadas no SQL; a interface nunca limita silenciosamente o
conjunto aos primeiros 100 registros. O tamanho da página é bounded pelo
servidor e a navegação usa o total real.

Por padrão a listagem mostra uma referência segura (`Cliente XXXXXXXX`), sem
telefone ou e-mail. O perfil abre em uma rota própria, com drawer responsivo;
fechar o drawer retorna pelo histórico e preserva a URL dos filtros.

Visões salvas são locais ao usuário (`skincos:clientes:saved-views:<actor>`),
incluem filtros, ordenação e colunas, e nunca contêm contato. A seleção em lote
envia somente UUIDs de identidade e o responsável escolhido para
`POST /api/atendimento/commercial/actions/bulk-assign`; o servidor limita a 100
identidades, exige GESTOR, aplica escopo de unidade, trava as ações abertas,
resolve o profissional canônico e registra auditoria. Identidades sem ação
aberta retornam em `skipped` e não são criadas implicitamente.

## Segurança e fail-closed

- o shell continua usando o registry lazy e o mesmo RBAC `module.clientes.access`;
- as rotas comerciais exigem `GESTOR` (ADMIN normalizado para GESTOR);
- escopo de unidades permanece no store e é validado novamente em cada mutação;
- `commercialContactWritesEnabled` e o canário continuam sob a política já
  existente; esta tranche não concede contato, opt-out ou envio;
- o endpoint de carteira remove `phone` e `email` antes de serializar o perfil;
- erros de painel são isolados e diagnósticos não registram identidade ou
  contato;
- filtros desconhecidos são ignorados, nunca executados como SQL;
- o SQL usa colunas de ordenação allowlisted, parâmetros para valores e
  `for update` na atribuição em lote.

## Operação e rollback

1. Promova somente o SHA desta PR a um ambiente autorizado, com o schema de
   Atendimento já gerenciado.
2. Execute o smoke autenticado com um ator sintético GESTOR e uma unidade de
   teste. Confirme uma resposta `crm-clientes-wallet/v1`, `pagination.mode=sql`
   e ausência de `phone`/`email` nos perfis.
3. Compare a latência do SQL, erros por contrato, taxa de páginas vazias e
   `skipped` de atribuição. Não use nomes, telefones ou e-mails em métricas.
4. Para rollback, volte ao SHA anterior do console/API; o contrato legado de
   `/commercial/overview` permanece intacto e nenhuma migration destrutiva é
   necessária.

Validações locais:

```powershell
& .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path -WorkingDirectory 'crm/console' -NpmScript typecheck
& .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path -WorkingDirectory 'crm/console' -NpmScript test
& .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path -WorkingDirectory 'crm/console' -NpmScript build
& .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path -WorkingDirectory 'crm/api' -NpmScript test
```

O orçamento de bundle existente (`crm/console/scripts/check-bundle-budget.mjs`)
é a fonte de verdade; Clientes continua entrando pelo `ModuleHost` lazy e não
carrega o chunk antes de a permissão do módulo ser resolvida.
