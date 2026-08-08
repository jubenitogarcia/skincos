# Atendimento — release independente e fail-closed

## Estado atual

O código contém um entrypoint Node independente, unidades systemd, release por
SHA, controle estrito, smoke HMAC v2, rollback e templates de túnel. Isso é
**preparação técnica**, não evidência de ambiente: esta alteração não instala
serviço, não provisiona banco, não executa migration, não cria túnel/DNS e não
promove staging ou produção.

O worker contínuo de Clientes/Harmonia permanece no processo próprio
`crm-jobs.service`; o entrypoint `atendimentoRuntime.js` não importa o servidor
HTTP monolítico ou código de worker. O processo HTTP isolado é somente leitura.

## Contrato de release

| Item | Regra |
| --- | --- |
| Origem | Apenas release nativa `/opt/skincos/releases/<sha-40>/source`, com SHA exatamente igual ao `origin/main` buscado e predecessor ancestral registrado. |
| Processo | `crm-atendimento-staging.service` ou `crm-atendimento-production.service`; nenhum instalador toca `crm.service`, `crm-jobs.service`, Orb ou túnel compartilhado. |
| Shutdown | `SIGTERM` fecha o listener antes do pool e do ledger de replay; o timeout força apenas conexões do processo dedicado. |
| Health | público, PII-free e independente do banco. |
| Readiness | loopback + token; verifica arquivo de controle, ledger de replay, banco, database/role esperados, schema, fontes, domínio clínico e ausência efetiva de privilégios persistentes de escrita. |
| Ator | HMAC `atendimento-actor/v2`, timestamp de cinco minutos e nonce persistido; replay ou falha de ledger negam a requisição. |
| Escrita | Edge e runtime limitam a `GET`, `HEAD`, `OPTIONS`; controle exige `readOnly:true`, `syntheticOnly:true` e escrita comercial `false`. |
| Staging | O app usa `skincos_staging_crm_app` com `default_transaction_read_only=on`, apenas `SELECT`/`USAGE`; migration fica no login separado `skincos_staging_migrator_login`. Após cada fluxo de migration, um selador fixo operado como `postgres` remove DML, DDL, sequence, grants por coluna, memberships `SET ROLE`, atributos privilegiados e `EXECUTE` efetivo em funções `SECURITY DEFINER` de schemas de aplicação; também bloqueia leitura direta de `harmonia.contacts`. |

## Workflows e GitHub Environments

Os workflows podem apenas atestar SHA, ref `main` e evidência predecessor. Eles
não recebem nem interpretam comandos de shell, SSH, `eval` ou uma linha de
comando de GitHub Environments. O executor nativo usa caminhos/argumentos
allowlisted e arquivos privados de localização fixa.

O contrato de deployment é específico por alvo: staging usa
`/etc/skincos/atendimento-staging/module-control.json` e liveness nativa em
`http://127.0.0.1:8111/health`; produção usa
`/etc/skincos/atendimento-production/module-control.json` e, somente após a
instalação do túnel dedicado, `https://crm-atendimento.skincos.com.br/health`.
Staging não possui rota pública nesta tranche. Portanto Actions hospedadas
atestam apenas o contrato de staging e nunca chamam ou registram como saudável
um hostname público de staging não provisionado; a verificação de loopback
ocorre no runtime nativo autorizado. Nenhum fluxo usa
`/etc/skincos/atendimento/module-control.json` ou `crm.skincos.com.br` como
fallback.

Enquanto `ENABLE_ATENDIMENTO_DEPLOY=false`, qualquer workflow deve permanecer
sem alteração de runtime. Uma variável de Environment não pode mudar o
entrypoint, host/porta, domínio, modo de escrita, worker, SHA ou arquivo de
controle porque esses valores são fixados depois do `EnvironmentFile` pela
unidade systemd. Variáveis capazes de carregar código (`NODE_OPTIONS`,
`LD_PRELOAD` e equivalentes) são removidas explicitamente.

Os comandos privilegiados do contrato usam caminhos absolutos e ambiente
limpo; o validador de staging desabilita proxy no health loopback e só atesta
sucesso quando a unit renderizada, o PID/cwd/linha de comando e o SHA da
release são os esperados. Antes de qualquer migration aplicável, o controle
precisa estar em `maintenance` com o SHA exato e a unidade isolada precisa
estar inativa; o runner obtém lock advisory no banco durante todo o fluxo.

## Gaps que bloqueiam ativação

1. Staging precisa ter as migrations aditivas de fontes e aprovação clínica
   aplicadas e validadas. Até isso ocorrer, `readiness` deve responder `503`.
2. O banco de produção dedicado e os roles separados precisam de backup,
   provisionamento e prova de grants mínimos; o app não pode ter DDL nem acesso
   a contato bruto de Harmonia/Caixa.
3. São necessários arquivo de controle, HMAC do ator, token de readiness e
   credenciais do túnel nos caminhos privados fixos. Nunca os registre no Git.
4. O túnel dedicado, rota DNS e `ATENDIMENTO_API_TARGET` precisam apontar só ao
   processo isolado; não há fallback ao CRM compartilhado.
5. É necessário smoke sintético do SHA efetivamente instalado, incluindo
   health durante falha de banco, readiness `503`, replay, método de escrita
   bloqueado, SIGTERM e rollback.

Enquanto qualquer item faltar, mantenha `maintenance`, canário vazio e todas as
escritas/automação de mensagem desabilitadas.

O controle de staging está em
`/etc/skincos/atendimento-staging/module-control.json`, não no controle legado
compartilhado. O provisionamento cria somente `maintenance`, com
`readOnly:true`, `commercialContactWritesEnabled:false` e `syntheticOnly:true`.
Antes de instalar uma unidade de SHA específico, grave o mesmo SHA nesse
controle pelo escritor nativo; o instalador recusa iniciar se o controle não
for estrito e correspondente. O token de readiness é gerado no arquivo privado
`/etc/skincos/crm-atendimento-staging.env` e nunca deve entrar em logs.

`scripts/runtime/add-atendimento-staging-tunnel-route.sh` foi aposentado: ele
não pode modificar nem reiniciar o `cloudflare-runtime.service` compartilhado.
Até existir uma unidade de túnel de staging dedicada e revisada, mantenha a
rota externa do runtime isolado ausente e valide somente por loopback.

## Operação e rollback

Consulte [clientes-production-readonly-runtime.md](clientes-production-readonly-runtime.md)
para a sequência de dry-run, backup, migração de staging, smoke e rollback. A
ação emergencial mínima é `maintenance`/`disabled` no arquivo de controle. O
rollback por SHA requer um manifest de release anterior já preparado; nenhum
script tenta “adivinhar” checkout, shell ou destino a partir de uma variável.
O preparador de staging grava a linhagem imutável (`releaseId`, predecessor e
árvore de origem) antes de a unidade poder ser instalada.
