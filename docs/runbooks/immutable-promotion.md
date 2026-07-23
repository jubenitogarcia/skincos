# Promoção imutável por unidade operacional

## Regra

Cada publisher canônico usa `.github/workflows/promotion-gate.yml`. A cadeia é
`preview -> staging -> production` para o mesmo `release_sha` (commit Git de
40 caracteres, portanto imutável). O gate publica evidência de preview e exige
o `preview_run_id` correspondente antes de staging; após um staging bem-sucedido,
o workflow publica `promotion-evidence-<unit>` e produção exige tanto o
`staging_run_id` quanto o mesmo `release_sha`.

O job de produção faz checkout do SHA atestado, nunca do HEAD atual da `main`.
As configurações, bindings e secrets continuam sendo selecionados exclusivamente
pelo environment do destino.

## Operação

1. Execute o publisher da unidade com `target=preview`; registre o run id e o
   SHA exibido no artefato de evidência.
2. Execute `target=staging`, com `release_sha` e `preview_run_id`. Não use uma
   branch ou SHA diferente.
3. Depois da validação funcional de staging, execute `target=production`, com
   o mesmo `release_sha` e `staging_run_id`. A aprovação do environment de
   produção continua obrigatória.

Não use `workflow_dispatch` nesta mudança. Esta PR altera apenas o mecanismo.

## Cobertura e bloqueios explícitos

- Core Workers (inclui Inventory e Financeiro), CRM Pages (inclui Financeiro),
  Escala, Ponto e Meta Ads Report têm staging configurado e podem cumprir a
  cadeia quando seus secrets e aprovações estiverem presentes.
- Social Publisher, Website e runtime nativo foram convertidos para o mesmo
  contrato, mas staging falha explicitamente até que recebam recursos isolados.
  Eles não podem ir para produção por esse pipeline enquanto esse bloqueio
  existir.
- O runtime nativo já usa releases em `/opt/skincos/releases/<sha>`; a falta é
  um host de staging isolado, não uma segunda forma de publicar produção.

## Evidência e rollback

`promotion-evidence-<unit>` contém unidade, estágio, SHA, árvore Git, run e
timestamp, sem secrets. Preserve o run de staging com a evidência de smoke e o
SHA anterior. Rollback continua pelo publisher canônico usando o SHA anterior
que já tenha evidência de staging válida; migrations permanecem aditivas.
