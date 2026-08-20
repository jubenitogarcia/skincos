# Contrato do classificador canônico de risco

**Status:** obrigatório para o classificador central
**Schema:** `2`
**Implementação:** `scripts/codex-risk-classifier.mjs` e
`scripts/codex-autonomy-lib.mjs`
**Política versionada:** `ops/codex/risk-policy.json`

Este contrato é a única classificação de impacto produzida pelo classificador
central. A integração dos campos em workflows consumidores é uma etapa separada;
este documento define a forma e a semântica do relatório sem alterar esses
consumidores.

## Entrada

`classifyFiles(policy, files)` recebe uma política v2 e uma lista de caminhos ou
registros de mudança. Um caminho simples representa uma alteração `M`. Registros
podem usar o formato Git (`A`, `C100`, `D`, `M`, `R100`, `T`, `U`, `X` ou `B`)
com `paths`, ou `oldPath`/`newPath` para cópias e renomeações.

Todo caminho é normalizado para separadores `/`, Unicode NFC e um caminho
relativo ao repositório. Caminhos vazios, absolutos, com `.`/`..`, segmentos
vazios, controles ou tipos diferentes de string são indeterminados e causam
falha. Renomeações e cópias sempre classificam os dois lados; isso impede que o
lado sensível de uma mudança desapareça do relatório.

O CLI usa `git diff --name-status -z`, não `--name-only`, para preservar a
estrutura de renome/cópia e nomes com espaços. Saída Git truncada, status
desconhecido ou token vazio também falha fechado.

## Relatório

O relatório v2 contém, no mínimo:

| Campo | Semântica |
| --- | --- |
| `risk` | Maior nível observado: `low`, `medium`, `high` ou `critical`. |
| `surfaces` | Superfícies únicas e ordenadas; `unclassified` identifica caminho sem superfície explícita. |
| `languages` | Linguagens únicas da política; `unknown` é usado para extensão não mapeada. |
| `dependencies_changed` | Algum caminho bateu em uma regra de manifesto/lockfile/dependência. |
| `shared_contracts_changed` | Algum caminho bateu em contrato compartilhado, governança ou classificador central. |
| `production_sensitive` | Algum caminho pode alterar runtime, integração, deploy ou dado de produção. |
| `security_sensitive` | Algum caminho toca autenticação, sessão, permissão, segredo, credencial, criptografia ou segurança. |
| `status` | `classified` para classificação normal; `fallback` para saída de contenção. |
| `fallback` | `null` em classificação normal; objeto `{ active, code, reason }` quando a contenção foi usada. |

`affectedSurfaces` permanece no relatório como alias de leitura para os
consumidores existentes. `classification_status` acompanha `status` com os
valores `ok` e `failed` para facilitar a transição de consumidores que já
serializam esse nome.

Os campos de risco e sensibilidade são derivados da união de todos os caminhos,
com regras da política comparadas de forma determinística e sem confiar na
ordem de entrada. Uma lista de mudanças efetivamente vazia é uma classificação
válida de diff vazio; ela não é confundida com um caminho vazio ou uma entrada
malformada.

## Matriz de risco

- `low`: documentação e conteúdo estático sem superfície executável.
- `medium`: código comum, UI ou alteração isolada cujo impacto é conhecido.
- `high`: autenticação, sessão, permissões, segredos, migrações, pagamentos,
  workflows, Workers, infraestrutura, tracking ou integrações externas.
- `critical`: caminho explicitamente excepcional, destrutivo, irreversível,
  de dado real, ledger financeiro ou exposição de credencial.

O risco agregado é sempre o maior risco entre os caminhos. A política não usa o
nome da ferramenta para reduzir o risco: uma mudança de workflow comum continua
`high`, enquanto um caminho explicitamente destrutivo é `critical`.

## Fallback fail-closed

A biblioteca valida a política e as entradas e lança erro quando não consegue
determinar o impacto. O CLI captura esse erro e grava um relatório completo com:

- `risk: "critical"`;
- `status: "fallback"` e `classification_status: "failed"`;
- `surfaces: ["unclassified"]` e `languages: ["unknown"]`;
- todas as sensibilidades conservadoras como `true`;
- checks do nível crítico e `fallback.active: true`;
- código e razão sanitizados, sem conteúdo de arquivo ou segredo;
- status de processo `2`.

Assim, falha de leitura da política, diff sem forma interpretável, caminho
inseguro ou status Git desconhecido não pode entrar silenciosamente na fast lane
low-risk.
