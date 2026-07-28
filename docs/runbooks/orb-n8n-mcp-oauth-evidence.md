# Evidência MCP/OAuth do candidato

O pacote n8n 2.32.5 contém controllers para metadata OAuth e registro dinâmico,
incluindo `/.well-known/oauth-authorization-server`, `/mcp-oauth/register` e
`/oauth/register`. Isso foi verificado por inspeção do artefato fixado.

Em boot isolado com PostgreSQL sintético, loopback e as variáveis de gestão MCP
habilitadas, o candidato respondeu `/healthz` 200. Os caminhos OAuth retornaram
404 porque o snapshot não possuía recurso MCP protegido registrado (workflows
permaneceram desabilitados). Nenhum cliente ou consentimento foi criado.

Conclusão: compatibilidade de boot e presença de código PASS; transporte
Streamable HTTP, registro dinâmico e consentimento real continuam **OPEN** e
devem ser demonstrados em staging dedicado antes de qualquer promoção.
