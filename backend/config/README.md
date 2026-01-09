# Config (skincos)

Padrão:
- Versionar apenas exemplos: `*.example.*`
- Arquivos reais: `*.local.*` (ignorado) ou `.env` (ignorado)

Estado/dados locais:
- sempre em `var/` (ignorado)

Sugestão prática:
- copie `config/templates/modules/workspace/workspace.env.example` → `config/workspace.local.env`

Nota:
- O pacote Python `config/` (ex.: `config/manager.py`) continua aqui por compatibilidade de imports.
- Templates e exemplos ficam em `backend/config/templates`.
- Scheduled Posting: preferir `backend/libs/scheduler_config.py`.
