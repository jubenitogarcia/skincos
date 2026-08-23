# Decisões arquiteturais — Content Studio v2

## AD-001 — Builder é a fonte de verdade

O builder legado continua preservado para comparação. O builder v2 gera os exports CCG e nenhum JSON gerado é fonte editável.

## AD-002 — Contratos bloqueados antes de criatividade

`factual_foundation` e `content_constitution` congelam fatos, claims, oferta, marca e compliance. Marketing e conversão só podem selecionar entre fatos aprovados.

## AD-003 — Texto comercial é determinístico

Providers generativos produzem clean plates e componentes visuais. Preço, CTA, logo, disclaimer e copy final entram por overlay/renderer determinístico.

## AD-004 — Dry-run fail-closed

`dry_run=true` força providers mock. Um adapter HTTP real rejeita chamadas quando o modo é dry-run; não há fallback silencioso para uma chamada paga.

## AD-005 — Artefatos circulam por referência

O controle usa URI, checksum, mime type e metadados. Base64 não é aceito em `production_request`, pinData ou ledger.

## AD-006 — QA distingue bloqueio de revisão

Preço/claim/procedimento sem evidência, arquivo inválido, promessa proibida e texto comercial incorreto são `FAIL` bloqueante. Problemas corrigíveis de composição são `NEEDS_REVIEW`.

## AD-007 — Sem contrato inventado para organizador/postagem

O repositório não contém um contrato confiável para esses workflows. Os adapters v2 são neutros e documentam o mapeamento mínimo sem inventar IDs.
