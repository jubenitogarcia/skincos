# Evidência de compatibilidade de community packages

Data: 2026-07-28. Candidato: n8n 2.32.5. Ambiente: PostgreSQL sintético,
listener loopback e nenhum workflow/credencial de produção.

## Resultado

O método provisório de apontar `N8N_CUSTOM_EXTENSIONS` diretamente aos 11
diretórios de package não qualifica compatibilidade de workflow. O processo
iniciou com `/healthz` 200, mas `export:nodes` encontrou 903 tipos e não
encontrou os tipos presentes no snapshot sanitizado:

- `n8n-nodes-base.executeCommand`;
- `n8n-nodes-cloudinary.cloudinary`;
- `n8n-nodes-evolution-api-en.evolutionApi`.

Os sources de Cloudinary e Evolution informam respectivamente `cloudinary` e
`evolutionApi` como identificadores diretos. Portanto, o loader de extensão
crua não preserva o namespace esperado pelo workflow instalado.

## Gate

`BLOQUEADO_POR_PACOTE`. O próximo ensaio deve usar o mecanismo canônico de
instalação/registro de community packages do n8n (`PackageDirectoryLoader`),
com a dependência `pkce-challenge` isolada, e repetir importação, catálogo e
execução exclusivamente sintética. Este resultado não autoriza upgrade,
migration, restart ou outra alteração em produção.
