# Fluxo de desenvolvimento e validação do SKINCOS

Este documento descreve o caminho padrão depois da otimização de CI dos issues
#1528--#1535. A regra é proporcionalidade com fail-closed: uma mudança pequena
ganha uma validação curta somente quando o classificador consegue provar que a
superfície é pequena.

## Arquitetura operacional

```text
diff imutável base/head
        |
        v
1 classificador canônico (risco + surfaces + languages + flags)
        |
        v
validadores proporcionais em paralelo
        |
        v
1 aggregate required gate
        |
        v
1 mutação serial de main (global-merge-authority + lease + readback)
```

O classificador é `scripts/codex-risk-classifier.mjs` e o contrato mínimo é:
`risk`, `surfaces`, `languages`, `dependencies_changed`,
`shared_contracts_changed`, `production_sensitive` e `security_sensitive`.
Qualquer erro de classificação vira `critical`, `unclassified`,
`classification_status=failed` e exige a matriz completa.

## Política por risco

| Risco | Exemplos | Validação esperada |
| --- | --- | --- |
| LOW | texto, CSS, layout ou componente local sem contrato compartilhado | `diff --check`, lint/format e typecheck focal, testes afetados, secret scan do delta; CodeQL, E2E e suites de domínios não relacionados são omitidos |
| MEDIUM | lógica funcional de módulo ou API isolada | pacote afetado, integração/E2E focal e SAST proporcional |
| HIGH | auth, tracking, workflow, dependência, segurança, shared contract ou closure elevada | `verify:full`/matriz ampla proporcional, scans e suites de dependência afetadas |
| CRITICAL | produção, secrets/custody, migration, permissões, infra ou mutação irreversível | fail-closed, staging, rollback, lease, custody, release imutável, evidência e validação live quando aplicável |

### O que deixa de rodar em um micro-change LOW

Não são reconstruídos nem executados por justificativa genérica:

- histórico completo do Git em checkout de rotina;
- auditoria de dependências, Python SAST/CodeQL ou Semgrep de superfícies sem relação;
- build/instalação do Website quando apenas CRM mudou;
- E2E de Escala, Ponto, Finance, Influencer Intelligence ou outros domínios sem closure afetada;
- full Gitleaks histórico; o delta continua sendo escaneado;
- preflight de produção, staging/live evidence, lease ou custody antes de uma fase que não toca esses recursos;
- hooks locais indiscriminados de frontend + Website + API + Python.

Isso não desativa segurança. Workflow, auth, tracking, secrets, migrations,
dependências, contratos compartilhados, produção e qualquer fallback
`unclassified` sobem para HIGH/CRITICAL.

## Hooks e checkout

Use `npm run verify:changed` para uma mudança focal e `npm run verify:full` para
uma validação completa. Pre-commit e pre-push consomem o mesmo classificador e
validam somente staged/pushed refs; um hook de produção continua separado.

Workflows de rotina usam checkout raso e
`scripts/codex-bounded-diff.mjs`, que busca apenas os SHAs imutáveis necessários,
resolve o merge-base em profundidade limitada e falha fechado se não puder
provar a faixa. Histórico completo fica reservado a funções que realmente
precisam dele, como full-history security scan em main/schedule/dispatch ou
risco HIGH/CRITICAL.

## Freshness e merge

`Codex merge freshness shadow` mede se o avanço de `main` e a closure de um PR
são disjuntos. O artefato pode indicar `shadow-reuse-candidate`, mas não altera
branch, required checks, ruleset ou autoridade. Enquanto `main` exigir branch
up-to-date e o repositório não tiver uma Organization/App compatível com merge
queue, a nova matriz é revalidada e a mutação permanece serial em
`global-merge-authority`.

## Métricas

Baseline representativa: PR #1542, alteração pequena de CRM/UI (4 arquivos,
`+32/-15`), coletada antes da adoção desta matriz. A primeira amostra posterior
é a própria PR de documentação #1555 (head
`02acf33020cb4cb9ac56e8605225208be19fb763`), que é LOW e não toca código de
produto.

| Medida | Antes (#1542) | Depois (PR de documentação #1535) |
| --- | ---: | ---: |
| workflows/check runs iniciados | 26 check runs | 20 check runs |
| critical path CI/SAST | 222 s | 221 s (head `727922ae`; amostra parcial; segurança global residual) |
| required aggregate incluindo autoridade | 304 s | gate em 22 s; autoridade é executada somente após a medição do PR |
| suites explicitamente não relacionadas | não separado na baseline | Ponto, Finance, Influencer Intelligence, Staging, Cloudflare e Global architecture foram omitidos |
| checkout/install/build repetidos | não instrumentado | nenhum CodeQL, Website build ou E2E foi iniciado para o docs-only; segurança global ainda instalou/analisou superfícies sem relação |
| revalidações por avanço de `main` | não instrumentado | a branch ainda precisou de uma atualização de base; o shadow registra a decisão, sem bypass |

Na primeira execução da amostra #1555, o critical path foi `226 s`
(`05:28:31Z--05:32:17Z`). Após a atualização final para
`main@9f28f947`, o head `727922ae` fechou em `221 s`
(`06:18:49Z--06:22:30Z`); portanto ainda não atingiu 60--120 s. Esse número é
deliberadamente reportado como adoção parcial: o workflow antigo de segurança
executou Dependency Audit JS/TS, Pip Audit, Bandit, Semgrep e Gitleaks mesmo
para documentação, pois a otimização de #1528/#1549 permanece bloqueada por
131 achados históricos no Gitleaks remoto (133 na reprodução local, somente
metadados redigidos). A remoção segura dessa cauda depende da validação,
rotação e remediação pelos responsáveis; não há allowlist ampla nem downgrade.

O alvo de 60--120 s para LOW permanece uma meta de capacidade, não um motivo
para degradar gates. O critical path final deve ser lido dos timestamps dos
checks e dos jobs que realmente rodaram no SHA; congestionamento de runner é
reportado separadamente.
