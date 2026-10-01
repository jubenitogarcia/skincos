# Isolamento entre domínios

O CI executa `npm run domain-boundaries:validate` no workflow **Architecture
governance**. Ele percorre importações estáticas JavaScript/TypeScript e Python
nos domínios catalogados e aplica estas regras:

1. uma implementação não pode importar outra implementação de domínio;
2. um consumidor só pode importar `shared/**` quando o caminho for um contrato,
   SDK ou adapter registrado em `shared/domain-boundaries.json` e autorizar
   aquele consumidor;
3. `shared` não pode importar código de produto, exceto em um adapter registrado
   com `providesFor`: esse adapter é a única fachada autorizada para a
   implementação do domínio dono;
4. toda violação nova falha indicando `arquivo:linha`, fronteira, contrato
   recomendado e forma de uso.

O manifesto é a única lista de contratos permitidos. Cada item informa tipo,
owner, caminhos públicos e consumidores autorizados. Não adicione uma pasta de
implementação de domínio a ele: a solução é publicar uma interface mínima em
`shared/` ou usar a fronteira HTTP/service binding do domínio dono.

## Migração controlada

As importações históricas em `legacyDirectImports` não são novos contratos. São
dívidas com arquivo, specifier, motivo, contrato de substituição e prazo. O CI
emite uma anotação para cada uma e passa a falhar após o prazo; quando a
migração termina, a entrada precisa ser removida no mesmo PR.

Baseline atual: não há importações diretas históricas registradas. A
compatibilidade stateful API -> Inventory fica em `statefulServiceBindings`,
com consumer/produtor, service binding/entrypoint, DTO, capability de health,
ordem de deploy/rollback, revisão até 2026-11-30 e condição de aposentadoria
validados. Ela preserva os
Durable Objects legados da API enquanto a regra de negócio da fila passa para
Inventory; não é uma autorização para novos imports diretos. A sessão Identity
usa o adapter registrado `identity-runtime-adapter-v1`, sem exceção permanente
para Inventory.
