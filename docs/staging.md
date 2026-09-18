# Staging

Staging é um ambiente isolado para validar o mesmo SHA que poderá ser
promovido depois. A branch `staging` não é uma linha paralela de
desenvolvimento e não autoriza deploy por si só.

## Fluxo

1. Validar localmente a mudança e abrir o PR.
2. Gerar candidato imutável a partir de `main`.
3. Publicar em staging com D1, KV, bindings e segredos próprios do ambiente.
4. Executar smoke, readback de identidade e rollback do mesmo artefato.
5. Promover somente após a evidência sanitizada estar completa.

## Superfícies

- Website: Pages/Worker do Website, publicado por `deploy-website-cloudflare.yml`.
- API e gateway: Workers do domínio API, com `/crm/*` encaminhando para o
  serviço externo; nenhum código do CRM é montado neste repositório.
- Ponto: Workers e Pages dedicados, publicados pelos workflows `ponto-*`.
- Atendimento: catálogo comercial read-only em
  `integration/atendimento/commercial-catalog`, sem escrita ou dados copiados.
- Escala, Financeiro, Inventário, Social, Mensageria e Booking: cada domínio
  conserva seu próprio artefato, banco, segredos e rollback.

IDs de recursos, URLs privadas, dados, tokens e recibos ficam fora do Git.
Ausência de binding, segredo ou evidência falha fechada e não produz deploy
parcial.
