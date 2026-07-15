# Messaging WhatsApp

`engine/` is the only supported WhatsApp implementation in this repository.
It is built into a native Linux release and started by
`messaging-whatsapp.service`; repository checkouts are never runtime roots.

- source: `messaging/channels/whatsapp/engine`
- release: `/opt/skincos/current/messaging-whatsapp`
- mutable state: `/var/lib/skincos-runtime/messaging-whatsapp`
- private configuration: `/etc/skincos/messaging-whatsapp.env`
- logs: `/var/log/skincos/messaging-whatsapp`
- local API: `http://127.0.0.1:8080`
- public ingress: `https://wa.skincos.com.br`

CRM uses the private `/etc/skincos/crm-whatsapp.env` overlay and always talks
to the local engine. The compatibility adapter in
`crm/api/services/whatsappOrchestrator.js` delegates to the same engine and
does not spawn a second service.

Build and runtime checks:

```bash
npm --prefix messaging/channels/whatsapp/engine test
npm --prefix messaging/channels/whatsapp/engine run lint:check
npm --prefix messaging/channels/whatsapp/engine run build
systemctl is-active messaging-whatsapp.service
```

Do not add session data, API keys, `.env` files, browser profiles, generated
storage or alternative WhatsApp runtimes to the repository.
