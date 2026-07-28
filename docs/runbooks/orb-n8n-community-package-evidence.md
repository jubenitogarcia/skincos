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

## Ensaio canônico

O carregamento pelo próprio n8n, com versões e integridades fixadas, confirmou
que o prefixo é preservado quando `PackageDirectoryLoader` é usado. Porém, a
instalação de `n8n-nodes-evolution-api-en@1.0.2` falhou após
`n8n-nodes-evolution-api@1.0.4`: ambos registram o tipo `Evolution API`, e a
tabela `installed_nodes` recusou o segundo registro por chave primária
duplicada. O mesmo ensaio também recusou `n8n-nodes-mcp@0.1.29` como package
que não pôde ser carregado, reproduzindo o problema de dependência já visto.

## Gate

`BLOQUEADO_POR_PACOTE`. O próximo ensaio deve usar o mecanismo canônico de
instalação/registro de community packages do n8n (`PackageDirectoryLoader`),
com a dependência `pkce-challenge` isolada e uma decisão de substituição ou
consolidação do package Evolution sem perda de workflow, e repetir importação,
catálogo e execução exclusivamente sintética. Este resultado não autoriza upgrade,
migration, restart ou outra alteração em produção.
