# Auditoria histórica do journal Meta Ads Publish — 2026-07-29

## Método e limite

Consulta remota somente leitura correlacionou cada run não terminal com jobs,
operations, events e locks. Nenhum registro tinha `activate_batch` concluído
nem job de anúncio concluído. Todos os locks persistidos já estavam vencidos.

Em seguida, a reconciliação registrada no D1 acrescentou o evento imutável
`operational_closeout_20260729_v1` aos 49 runs e preservou os JSONs existentes
com uma seção `historical_audit`. Não houve chamada à Graph API, criação,
ativação, pausa, rollback ou exclusão de recurso Meta.

## Resultado por classe

| Classificação | Runs | Evidência e decisão |
| --- | ---: | --- |
| `failed_execution_error` | 6 | A execução n8n correspondente terminou em `error`; não houve staging ou ativação. Estado atualizado para `failed`. |
| `abandoned_after_creative_before_stage` | 7 | Há `create_creative` concluído, mas não há job, `stage_batch` ou ativação. Estado atualizado para `failed`; possíveis criativos ficam apenas para auditoria futura de órfãos, sem autorização de exclusão. |
| `abandoned_before_stage` | 33 | Sem staging/ativação e sem evidência de execução resumível. Inclui uploads parciais, falhas pré-criativo e tentativas sem operação. Estado atualizado para `failed`. |
| `reconciliation_required` | 3 | Há job staged e/ou `stage_batch` concluído, mas nenhuma ativação. Mantido para lookup Graph somente leitura antes de qualquer decisão. |

### `failed_execution_error` (6)

`map_e598dd9017d3893886a5259c`, `map_a396ec0636cff91725ccf909`,
`map_aef903671f0dfe750ddc6585`, `map_87682bc8fe125353ddb89818`,
`map_587c803d15d59a1a83bfb8f6`, `map_7fbaff7fc92dade2ebeba381`.

### `abandoned_after_creative_before_stage` (7)

`map_7a194a62f6857da25d7410ab`, `map_5dbc775d57aca9b7763c2a94`,
`map_1daef02d9ecf930e25ce58c9`, `map_38f6fb03c97af6ca400e259e`,
`map_f8fb759a457297d11f923af8`, `map_b99794e03812e1f3fc20b1ca`,
`map_e0a60a90b43ad274e0ac9873`.

### `abandoned_before_stage` (33)

`map_88e6c3887308c4172303877a`, `map_28ec407ccc2fb9171e6b928a`,
`map_30805e14198313c22b54b1bb`, `map_a2820ea8eb8c5e349a01a586`,
`map_2eeef65b6924cbe67f68ea7f`, `map_126c288f615c40218d6b1790`,
`map_43cc75af3bfea8442eab4a5a`, `map_fb4ba292253b51829f49787c`,
`map_22a2f5ffc3f1069ea78081aa`, `map_7d1422498b0fd97dee944ff5`,
`map_789413a2ae76fe5817506b59`, `map_1e56cde22ffac6485915e3d2`,
`map_d296385f4a2ec2f21fe8458a`, `map_5dac5049a57bb0c01c1b515c`,
`map_37633db8166a258de21c8c2a`, `map_fadc2f771f04e70beee75c36`,
`map_cce7a331a08ec28840106ea8`, `map_40886b9059c5d5792bd53253`,
`map_1278131b492d92d6016685ad`, `map_31642d0852b9933e5274ae02`,
`map_b4696e19c958bf6a7f09e46c`, `map_129f7524c0956d7a62943a4b`,
`map_6305863962461a505384058f`, `map_3f33b690cff5b76e25105978`,
`map_e9e715950dca0d05630e2292`, `map_a756471ca1a54b87aee1083e`,
`map_0a44167a7cc4cbeb15826dca`, `map_4adefe1116481df5afcd5fb6`,
`map_b88c753275b87ef7c96ede65`, `map_e82044cd6a6b35e8482fd60e`,
`map_3aad73dc83808d2c607a5349`, `map_eb77e6bd8d937da867358b3c`,
`map_6092f48cd6942488052a434b`.

### Casos que permanecem em `reconciliation_required` (3)

| Run | Evidência persistida | Responsável | Próximo passo |
| --- | --- | --- | --- |
| `map_9c175ce1ed571ccd158ef509` | 1 job staged; `create_creative` e `stage_batch` concluídos; sem `activate_batch`. | Operador Meta Ads | Lookup Graph somente leitura por resource/operation key; registrar se há anúncio físico e decidir ativar ou rollback com autorização. |
| `map_d4162ea2a7e9660512796dcb` | 1 job staged; `stage_batch` concluído; sem `activate_batch`. | Operador Meta Ads | Mesmo procedimento. |
| `map_7464107b2ee04e0cab6a27cf` | 1 job staged; `stage_batch` concluído; sem `activate_batch`. | Operador Meta Ads | Mesmo procedimento. |

## Contagem confirmada depois da reconciliação

- `calibration_archived`: 1
- `completed`: 52
- `failed`: 54
- `reconciliation_required`: 3
- locks ativos: 0
- eventos de auditoria gravados: 49

Os três casos restantes não podem ser encerrados sem a evidência externa
específica indicada acima. Não há execução comercial em andamento e esta
auditoria não alterou anúncios, campanhas, conjuntos ou criativos.
