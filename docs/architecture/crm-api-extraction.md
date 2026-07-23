# Extração progressiva do CRM API

## Estado atual e primeiro corte

`crm/api/server.js` ainda é a borda de compatibilidade do CRM. Ele concentra
middleware HTTP, autenticação local legada, correlação, proxies e mounts de
domínios, mas não deve continuar sendo requisito de disponibilidade para loops
ou jobs pesados.

O primeiro corte é operacional e reversível:

| Unidade | Entrada independente | Modo compatível | Corte externo |
| --- | --- | --- | --- |
| Harmonia worker contínuo | `npm --prefix crm/api run start:harmonia-worker` | `CRM_HARMONIA_WORKER_MODE=embedded` | `external`: o API não inicia o loop |
| Jobs pesados | `npm --prefix crm/api run start:jobs-worker` | `CRM_JOBS_MODE=embedded` | `CRM_JOBS_MODE=external` + `CRM_JOBS_WORKER_URL` |
| Harmonia/Atendimento/Caixa HTTP | `npm --prefix crm/api run start:domain` com `CRM_DOMAIN` | mounts atuais em `/api/<domínio>` | processo privado por domínio, atrás do gateway |

Os entrypoints de domínio escutam apenas loopback. Em produção, o gateway é o
único componente exposto e valida transporte, autenticação, autorização,
correlação e roteamento. A chamada interna deve usar service identity/HMAC; o
domínio continua dono da regra de negócio e do banco.

## Ordem de mudanças

1. **P0 — Harmonia worker:** publicar o processo contínuo separado em staging,
   com `CRM_HARMONIA_WORKER_MODE=external`; validar claim, retry e stop limpo.
   Rollback: retornar a `embedded` sem alterar a fila PostgreSQL.
2. **P0 — Jobs:** subir `crm-jobs` no mesmo host privado, configurar a URL
   interna e mudar `CRM_JOBS_MODE=external`; validar disparo, logs e término.
   Rollback: remover a URL e voltar a `embedded`.
3. **P1 — Harmonia HTTP:** ativar `CRM_DOMAIN=harmonia` atrás do gateway,
   mantendo cookie/rotas públicas compatíveis. Só então remover o mount local.
4. **P1 — Atendimento e Caixa:** repetir um domínio por release, com pools e
   roles PostgreSQL próprios já preparados.
5. **P2 — WhatsApp e integrações pesadas:** mover o adaptador de canal para
   `messaging`, e importações Google/Meta para workers/Orb; não iniciar
   subprocessos a partir da API de transporte.

Critério de aceite de cada corte: health privado, smoke autenticado pelo
gateway, correlação preservada, nenhuma regra de negócio duplicada, e retorno
ao processo anterior sem migration nem perda de job em execução.
