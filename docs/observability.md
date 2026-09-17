---
title: Observabilidade e SLOs
---

# Observabilidade e SLOs

O monitor primário é o `SkincosObservabilityProbe`, executado fora do GitHub e
do Cloudflare. Ele grava estado, histórico e métricas sanitizadas em
`C:\CodexRuntime\operator\admin\skincos\observability`. O catálogo vigente
está em `ops/observability/catalog.json`.

## Princípios

- Monitor sintético não substitui telemetria de aplicação.
- Todo alerta possui owner, rota e runbook.
- Logs nunca contêm body integral, token, segredo, cookie, digest de request ou
  PII.
- Módulo não implantado permanece `disabled`; não é convertido em falso verde.

## Superfícies monitoradas

- Website: `/api/booking/status`.
- API/gateway: `/health` e rotas públicas de integração.
- Ponto: health/readiness dos Workers e Pages dedicados.
- Escala: `/api/escala/health`.
- Integrações de Atendimento: catálogo comercial read-only, quando habilitado.
- CRM externo: monitorado no próprio projeto; o monorepo somente verifica a
  disponibilidade do contrato de gateway.
- Plano de coordenação: `/v1/readyz` em staging e produção.

SLO de referência: disponibilidade mensal de 99,9%, p95 de 800 ms para APIs
de produto e alerta de 5xx igual ou superior a 1% em cinco minutos. O plano de
coordenação usa 99,95% e p95 de 500 ms.

## Operação

O catálogo exige duas leituras consecutivas fora do saudável para confirmar
um alerta e duas saudáveis para confirmar recuperação. O workflow
`.github/workflows/uptime-slo.yml` é complementar e não substitui o monitor
local. Alertas externos e credenciais de webhook são configurados fora do Git.

Para instalar o monitor local:

```powershell
powershell -ExecutionPolicy Bypass -File .\ops\observability\scripts\Install-SkincosObservability.ps1
```

Cada evento deve conter apenas rota, status, resultado, duração, ambiente,
recurso lógico e identificador público da chave. A resposta do CRM externo,
quando sondada, não é armazenada neste repositório.
