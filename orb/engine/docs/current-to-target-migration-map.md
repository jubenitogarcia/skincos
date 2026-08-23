# Mapa de migração — legado para CCG v2

| Legado | Destino v2 | Tratamento |
|---|---|---|
| `Configuracao Inicial` | `CCG-00` + adapter de entrada | Remover IDs/valores; receber `production_request` |
| `Search Campaign Files`, `Download Campaign File` | `CCG-10 Grounding` | Adapter de storage e limites configuráveis |
| `Prepare Campaign Inputs` | `CCG-10` / `services/media-prep` | Retornar referências e checksums; sem base64 persistente |
| `Campaign Interpreter` | `CCG-10` | Separar fatos, claims, evidências, marca e compliance |
| `Campaign Brief Parser` | contratos v2 | AJV/JSON Schema fechado |
| `Build Variation Plan` | `CCG-20` + `CCG-30` | Planner de blueprint/layout, não arte final textual |
| `OpenAI Image Generation` | `CCG-40 Asset Factory` | Provider adapter; mock por padrão |
| `Build Image Binary` / `Upload Generated Asset` | `CCG-40` | Persistência por URI/checksum |
| `QA Reviewer` / `Finalize QA Status` | `CCG-90 QA and Package` | QA factual, visual, audiovisual, técnico e objetivo |
| `Build Campaign Manifest` / `Relatorio Final` | `CCG-00` + `CCG-90` | Collector explícito e `content_package` |
| Execute Fase 1–4 | `CCG-00` | Subworkflows versionados e checkpoints no ledger |
| qualquer publicação | nenhum destino | Fora do escopo e proibido |
