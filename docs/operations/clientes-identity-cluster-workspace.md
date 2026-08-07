# Workspace de clusters de identidade

## Limite operacional

O workspace `Clientes > Identidades` organiza revisões em componentes
transitivos do grafo de Atendimento, Caixa, cadastro do app e leads. Ele não
cria ações comerciais, permissões, contatos, mensagens ou campanhas.

Os endpoints são exclusivos de `GESTOR` e preservam o escopo de unidade:

- `GET /commercial/identity-clusters`
- `GET /commercial/identity-clusters/:clusterKey`
- `POST /commercial/identity-clusters/bulk/preview`
- `POST /commercial/identity-clusters/bulk/apply`
- `POST /commercial/identity-clusters/:clusterKey/reveal`

Uma unidade limitada só recebe um cluster quando todas as unidades conhecidas
do componente pertencem ao seu escopo. Proveniência de unidade ausente falha
fechada.

## Privacidade e auditoria

- Telefones e e-mails são mascarados na listagem e no detalhe.
- IDs técnicos não são enviados para a interface.
- Reveal exige campos, justificativa, confirmação explícita e versão esperada.
- Reveal expira visualmente após cinco minutos.
- O ledger guarda apenas chaves opacas de cluster, referências de ator derivadas
  por HMAC, digest de justificativa e resultados agregados.
- Valores de contato e justificativas não entram em logs, métricas ou no novo
  ledger operacional.

O runtime deve possuir `ATENDIMENTO_ACTOR_HMAC_KEY` (ou um dos fallbacks já
autorizados para assinatura de ator), com pelo menos 32 caracteres. Sem essa
chave, reveal e lote retornam
`IDENTITY_CLUSTER_AUDIT_KEY_REQUIRED`; a leitura continua disponível.

## Critério de lote seguro

O servidor revalida sob o lock do grafo:

1. versão do componente e das arestas;
2. escopo de unidade;
3. contato validado compartilhado por método allowlisted;
4. candidato único e arestas determinísticas;
5. ausência de conflito forte, stale ou decisão incompatível;
6. ausência de histórico comercial, consentimento ou auditoria que impeça a
   materialização/desfazimento;
7. checkpoints completos e válidos das fontes que compõem o cluster e do
   grafo global; ausência, snapshot parcial, reconciliação pendente ou mais de
   48 horas sem validação tornam o componente stale;
8. idempotency key por ator, componente e requisição.

O timestamp de um registro individual não é evidência de freshness da fonte.
O workspace lê somente os checkpoints operacionais permitidos; quando eles
não existem, leitura continua segura, mas lote é bloqueado de forma
fail-closed.

Casos ambíguos continuam na fila individual. Confirmações usam as mesmas
travas de migração, reconciliação, grafo e membro do fluxo de identidade
existente. Undo continua bloqueado quando existe dependência posterior.

## Ativação local ou staging isolado

1. Execute as migrations de pré-requisito do workflow de revisão de
   identidades.
2. Execute somente no destino estrito autorizado:

   ```text
   cd crm/api
   npm run migrate-identity-clusters -- --apply
   ```

3. Verifique que o endpoint de leitura carrega clusters com dados sintéticos.
4. Verifique que `workspace.ready` e `workflow.writesReady` são verdadeiros.
5. Faça preview de um componente sintético determinístico.
6. Exercite confirmação e idempotência somente no espelho local ou staging
   isolado.
7. Exercite reveal sintético e confirme a remoção visual após cinco minutos.

Não execute a migration ou escrita em produção nesta tranche.

## Rollback

O rollback é não destrutivo:

```text
cd crm/api
npm run migrate-identity-clusters -- --rollback
```

Ele registra a migration como revertida e bloqueia reveal/lote, mantendo
operações, reveals, decisões, lineage e materializações para auditoria. A
leitura de clusters continua disponível.
