# Troubleshooting

- **Schema inválido:** rode `npm run workflow:campaign-creative:v2:schemas` e depois o validator; não edite JSON gerado.
- **Workflow não importa:** confira IDs únicos, `Execute Sub-workflow Trigger` e se os workflows filhos foram importados primeiro.
- **Provider bloqueado:** esperado quando `dry_run=true`; configure mock para testes.
- **NEEDS_REVIEW:** examine conflitos, evidências e `blocking_issues`; não tente corrigir um problema factual só com regeneração visual.
- **Execução repetida:** compare `production_id`, `module`, `component_id`, `revision` e `input_hash` no ledger.
- **Renderer:** stills são SVG determinísticos; vídeo dry-run é fixture JSON. Encoding FFmpeg deve ocorrer no runtime aprovado, não no n8n Code node.
