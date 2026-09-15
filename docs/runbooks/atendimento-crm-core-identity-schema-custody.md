# Custódia do schema de identidade de Atendimento para CRM Core

Este runbook cobre exclusivamente a migration aditiva
`20260910_atendimento_crm_core_identity_materialization_v1` em **staging**.
Ela cria o schema que uma futura projeção poderá ler, mas não cria identidades,
não materializa links, não faz backfill, não concede roles, não entrega eventos,
não chama Cloudflare e não muda rota, produção ou writer legado.

O executor é instalado fora do checkout como
`/usr/local/sbin/skincos-run-atendimento-crm-core-identity-schema-staging`.
Ele aceita somente `verify` ou `apply`, fica preso ao source imutável que foi
instalado e grava o recibo completo apenas em custódia root-owned. Não há opção
de destino, URL, lote, schema, rollback ou entrada de dados fornecida pelo
operador.

## Admissão antes do executor

Uma aplicação só é admissível quando todos estes fatos forem verdadeiros:

1. O SHA completo em `main` é o mesmo que foi arquivado, teve a closure de
   Atendimento gerada e foi preparado como release imutável no host nativo.
2. O helper e sua regra sudoers literal foram instalados a partir desse mesmo
   release; o runner de custódia recebeu os diretórios privados de recibo e de
   checkpoint necessários.
3. O ambiente GitHub
   `crm-atendimento-identity-schema-staging` está protegido e o dispatch está
   vinculado ao SHA atual de `main`. O workflow é uma alternativa manual
   custodiada; ele não roda em push, pull request ou agendamento.
4. A custódia nativa da coordenação global e o arquivo privado do migrator
   existem com dono e permissões corretos. Valores de conexão e de coordenação
   nunca entram no workflow, no checkout, no recibo sanitizado ou no terminal.
5. Para `apply`, o controle isolado de Atendimento está em manutenção,
   somente-sintético e somente-leitura; o serviço de runtime de staging está
   inativo. O helper confirma ambos antes de adquirir a lease e aplicar.
6. O preflight ainda mostra um alvo novo: a migration atual não está registrada
   nem ativa e nenhuma relação alvo já existe. Uma tentativa repetida falha
   fechada, em vez de reutilizar o mesmo ID de migration.

O helper obtém a lease `deploy:atendimento:staging`, faz uma cópia de segurança
privada única antes do `apply`, usa o lock compartilhado de migração e confirma
o contrato de schema depois da transação. A cópia de segurança não é exposta
como artifact ou log.

## Operação controlada

O caminho preferido é executar a sequência através do Codex no host de
custódia, sempre depois de validar o SHA e preparar o release. O workflow
manual em
`.github/workflows/atendimento-crm-core-identity-schema-staging.yml` existe
como limite reproduzível para o mesmo helper; não deve ser despachado enquanto
o Codex for a via operacional escolhida.

O preflight de leitura, quando autorizado no host, é fixo:

```bash
sudo -n /usr/local/sbin/skincos-run-atendimento-crm-core-identity-schema-staging verify
```

Depois de todos os requisitos de manutenção e do checkpoint terem sido
confirmados independentemente, a única aplicação permitida é:

```bash
sudo -n /usr/local/sbin/skincos-run-atendimento-crm-core-identity-schema-staging apply
```

Os dois comandos geram apenas um resumo sanitizado: SHA do release, alvo,
identificador da migration, contagens de relações, flags de contrato, digest do
checkpoint quando houver e digest do recibo. O recibo privado completo continua
fora do Git. O workflow, se usado, valida a forma e o digest e publica somente
essa versão sanitizada como artifact.

## Limites após uma aplicação bem-sucedida

Concluir este schema não autoriza uma mutação de negócio. O catálogo continua
com `automaticApplicationAllowed: false`, `dataMutationAllowed: false` e
`automaticExecutionAllowed: false`. Ainda faltam uma revisão humana de lote
UUID-only, o principal e os grants dedicados do materializador, uma rota de
materialização opt-in separada, prova V2 sintética no CRM Core e a custódia de
backfill por domínio. Nenhuma dessas etapas é invocada pelo executor.

Não há down migration destrutiva. Se a aplicação falhar antes do commit, a
transação é desfeita e o recibo privado registra a tentativa. Se uma mudança
aditiva já tiver sido confirmada e mais tarde precisar ser retirada de serviço,
preserve o checkpoint, mantenha o runtime desligado e use somente o processo
de restauração aprovado ou uma nova migration aditiva revisada. Isso continua
separado de qualquer decisão de cutover para produção.
