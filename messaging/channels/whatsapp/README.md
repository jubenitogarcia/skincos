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
- service and release owner: `@jubenitogarcia` (Messaging)

CRM uses the private `/etc/skincos/crm-whatsapp.env` overlay and always talks
to the local engine. The compatibility adapter in
`crm/api/services/whatsappOrchestrator.js` delegates to the same engine and
does not spawn a second service.

The future `skincos-whatsapp-adapter` cut is constrained by two executable
pre-cut controls: the monorepo baseline and an isolated candidate/archive gate.
The portable closure can move only the CRM HTTP adapter and its tests; it has a
private pre-cut package template and cannot move Evolution source, CRM
conversation metadata, a second runtime, or a publisher. The current native
custody scripts remain a baseline to rewrite against a pinned upstream artifact,
not code that may be copied unchanged.

Native promotion and rollback use only a Linux-native
`release-source-<SHA>` artifact with its `messaging-whatsapp` closure. A
promotion requires an installed attested predecessor; rollback accepts only that
recorded predecessor, then verifies `messaging-whatsapp.service` and the local
`/health` endpoint. The mutable checkout is never a runtime or release input.
Before either `--apply` path can be enabled, the service owner must provision an
external authenticated custody verifier that binds the GitHub workflow run,
artifact identity and source-archive digest; the current scripts deliberately
fail closed and do not accept self-attested environment flags or files.

Build and runtime checks:

```bash
npm --prefix messaging/channels/whatsapp/engine test
npm --prefix messaging/channels/whatsapp/engine run lint:check
npm --prefix messaging/channels/whatsapp/engine run build
systemctl is-active messaging-whatsapp.service
```

Do not add session data, API keys, `.env` files, browser profiles, generated
storage or alternative WhatsApp runtimes to the repository.
