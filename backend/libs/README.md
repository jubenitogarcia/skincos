# libs

Bibliotecas/utilitários compartilhados entre módulos do `backend/`.

- `google.py` — integrações Google (Drive/Sheets/Auth).
- `scheduler_config.py` — helpers de config do Scheduled Posting.
- `whatsapp.py` — client + sender para APIs WhatsApp (compat: `libs.whatsapp_integration` reexporta).

Compatibilidade:
- Google: preferir `from libs.google import ...` (o caminho antigo `libs.integrations.google.auth` foi removido).
- WhatsApp: preferir `from libs.whatsapp import WhatsAppClient, MessageSender` (legado `libs.whatsapp_integration.*` continua funcionando).
- Scheduled Posting: preferir `from libs.scheduler_config import ConfigManager, scheduled_dir, ...`.
