# Contrato de integração

O repositório não contém um contrato versionado confiável do workflow organizador nem do workflow de postagem. Por isso o v2 usa adapters neutros.

## Entrada

`adapter-organizer-input` aceita um objeto com `production_request` ou campos equivalentes explicitamente fornecidos pelo organizador. Ele não cria IDs de workflow, IDs de pasta, preços ou credenciais.

Campos mínimos: `schema_version`, `production_id`, `content_id`, `campaign_id`, `content_type`, `production_tier`, `objective`, `requested_deliverables`, `provider_policy`, `dry_run` e `organizer_context`.

O único atalho manual do workflow unificado é `Manual safe dry-run smoke`. Ele não aceita dados do operador: cria uma fixture fixa com `dry_run=true`, `provider_policy.mode=mock`, orçamento/custo zero e `organizer_context.fixture=true`. Esse caminho existe apenas para validação segura e não substitui o contrato do organizador.

## Saída

`adapter-posting-output` recebe somente `content_package` aprovado e devolve uma estrutura neutra com `package_id`, `deliverables`, `captions`, `alt_text` e `review_status`. Ele não chama API de rede social, não agenda e não ativa anúncios.

Quando o contrato real for disponibilizado, deve ser adicionado como fixture e validado sem alterar o núcleo CCG.
