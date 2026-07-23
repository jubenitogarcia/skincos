# Catálogo de módulos

`module-catalog.json` é o contrato versionado dos módulos do SKINCOS. Ele cobre
os domínios de produto e os domínios operacionais transversais definidos em
`target-domain-map.md`: `shared`, `platform` e `ops` também são catalogados
porque podem afetar continuidade operacional.

Cada módulo declara obrigatoriamente:

- identificador, estado oficial e owner;
- dados sob sua responsabilidade;
- dependências rígidas e opcionais;
- serviços, bancos/armazenamentos, rotas e health checks;
- comandos de teste, feature flag, fallback, SLO e rollback.

Uma feature flag ausente é registrada como `not-yet-implemented`. Isso é uma
lacuna explícita, não uma autorização implícita para publicar uma capacidade:
uma mudança que exponha comportamento novo precisa introduzir uma flag
desligada por padrão antes de produção.

## Estados oficiais e promoção

Os únicos estados permitidos são `experimental`, `staging`, `pilot`,
`operational` e `critical`. A ordem é estrita. O merge em `main` não muda o
estado nem liga uma funcionalidade. Uma promoção precisa registrar evidência
revisada em [`ops/module-governance/promotion-evidence.json`](../../ops/module-governance/promotion-evidence.json).

Para avançar, o CI exige permissões, testes, feature flag, backup,
observabilidade, fallback, documentação, restore e rollback. `pilot` acrescenta
grupo piloto, treinamento e suporte; `operational` exige SLO e canary; `critical`
exige recuperação offsite, on-call e exercício de RTO. Até existir essa prova,
o estado permanece `experimental`.

## Dependências autorizadas

`authorizedDependencies` é a lista dirigida e revisável de contratos entre
módulos. Uma dependência declarada por um módulo só é válida quando existe uma
aresta idêntica (origem, destino e tipo) nessa política. A lista também não pode
autorizar uma aresta que nenhum módulo usa. Assim, ampliar acoplamento exige
uma alteração explícita e revisável no mesmo PR.

Dependências rígidas são indisponibilidades que impedem a função principal;
opcionais devem degradar para o fallback declarado. O gateway `api` não declara
domínios como dependências: ele é a fronteira de transporte e cada domínio
continua dono de suas regras e dados.

## CI e atualização

O workflow `Architecture governance` executa:

```text
npm run architecture:validate
npm run module-catalog:validate
```

O segundo comando rejeita schema incompleto, módulos ausentes ou duplicados,
rotas de dependência desconhecidas/não autorizadas, auto-dependências, ciclos e
o grafo Mermaid desatualizado. O arquivo
`module-dependency-graph.mmd` é derivado do catálogo; antes do PR, confira a
saída com:

```text
node .github/scripts/validate-module-catalog.mjs --print
```

e atualize o arquivo gerado na mesma mudança. As linhas contínuas no grafo são
dependências rígidas; linhas pontilhadas são opcionais.
