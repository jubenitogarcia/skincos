# Atendimento — custódia da assinatura Pages → runtime

O Pages Function de Atendimento e o runtime nativo isolado precisam usar a
mesma `ATENDIMENTO_ACTOR_HMAC_KEY` para a assinatura v2. A chave é um segredo
interno gerado, não deve entrar no Git, em logs ou em artefatos.

## Reconciliação governada

O workflow manual
`.github/workflows/cloudflare-pages-sync-atendimento.yml` propaga a chave
privada do GitHub Environment para as configurações `production` e `preview`
do projeto Pages canônico `skincos`. Ele exige o gate geral de Pages, o lease
`global:crm-cloudflare-writer` e verifica somente a presença do binding como
`secret_text`; o valor nunca é lido de volta.

Antes de executar:

1. confirme que o valor em `ATENDIMENTO_ACTOR_HMAC_KEY` é exatamente o valor
   atualmente aceito pelo runtime nativo, sem gerar uma segunda chave;
2. registre o motivo operacional sem incluir segredo, PII ou token;
3. mantenha o runtime em `active`, read-only e no SHA qualificado;
4. após o workflow, execute o smoke assinado do runtime e a jornada autenticada
   do CRM. Health e presença de secret não provam a assinatura funcional.

O rollback desta reconciliação é a contenção do módulo para `maintenance` e o
retorno do Pages ao deployment imutável anterior. Não há fallback para
`CRM_API_TARGET`, `ESCALA_ACTOR_HMAC_KEY` ou o gateway compartilhado.
