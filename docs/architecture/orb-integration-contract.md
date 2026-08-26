# Contrato de integração com o Orb

O Orb/n8n é um produto externo ao SKINCOS. O código-fonte, workflows, proxy,
Workers, releases, migrations, banco e runtime são mantidos no
[repositório privado do Orb](https://github.com/jubenitogarcia/orb).

## O que permanece no SKINCOS

- contratos HTTP, webhook ou eventos usados pelos módulos SKINCOS;
- custody e leitura controlada de credenciais externas, quando aplicável;
- URLs públicas, health/readiness e observabilidade do consumidor;
- testes dos contratos do lado SKINCOS, sem importar workflow JSON ou código do
  Orb.

O SKINCOS não acessa tabelas do Orb, o SQLite/WAL/SHM do n8n, diretórios de
release do Orb, units do Orb ou o checkout do repositório independente. Não há
submodule, mirror ou cópia sincronizada neste repositório.

## Identidade operacional

- endpoint público inicial: `https://orb.skincos.com.br`;
- health público preservado: `https://orb.skincos.com.br/healthz`;
- o bearer operacional `TOKEN_VAULT_N8N_API_TOKEN`, quando necessário, é um
  contrato externo de integração e não dá acesso direto ao banco;
- os schemas, autenticação, idempotência e versionamento dos endpoints do Orb
  são publicados e testados no repositório independente.
- A configuração MCP do consumidor usa somente os nomes `orb_readonly`,
  `orb_workflows`, `orb_admin` e `orb_ops`, com hostnames publicados pelo Orb.
  Headers Access, OAuth e aprovações ficam no computador do Codex, nunca neste
  repositório consumidor.

## Gate de corte

O runtime Orb já foi separado em namespace próprio. A promoção de novas
releases e dos planos MCP continua elegível somente depois de reconciliar uma
exportação autenticada do n8n live com o ledger de execuções, restaurar e
validar o banco PostgreSQL próprio do Orb, testar import/export isolado e
executar smoke sintético em staging. A release anterior e o banco anterior
permanecem retidos durante a observação pós-corte.

Os diretórios privados `C:\CodexRuntime\n8n` e
`C:\CodexRuntime\operator\admin\skincos\orb` são legado retido: não fazem
parte do Git e não devem ser copiados, apagados ou tratados como fonte de
código. Cópias futuras verificadas pertencem exclusivamente ao namespace
`C:\CodexRuntime\operator\admin\orb`.
