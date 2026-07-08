# Checklist contínuo de validação

## Comandos operacionais

- Suíte completa de qualidade:
  - `npm run quality:ci`
- Suíte local sem reinstalar dependências:
  - `npm run quality:check`
- Smoke isolado do funil público:
  - `npm run smoke:strict`
- Auditoria de governança de tracking/domínio:
  - `npm run tracking:governance`
- Auditoria 360 de UI/UX/SEO/perf/a11y:
  - `npm run audit:360`

## Cadência mínima

- Smoke por deploy:
  - rodar `npm run smoke:strict`
  - validar `x-app-build`
  - abrir o CRM em `Meta Ads > Tracking`
- Validação funcional semanal:
  - percorrer o funil completo do site
  - validar `Schedule` browser/server
  - validar clique WhatsApp via `/api/whatsapp/redirect`
- Auditoria quinzenal de cobertura:
  - revisar `% tracking_context`
  - revisar `% meta_event_id`
  - revisar `% fbp/fbc/fbclid`
  - revisar `% consentimento marketing`
  - revisar `Schedule CAPI OK vs failed`
  - revisar `Contact CAPI OK vs failed`

## URLs fixas para conferir

- Home:
  - `https://espacofacial.com/`
- Agendamento:
  - `https://espacofacial.com/agendamento`
- Unidades:
  - `https://espacofacial.com/unidades`
- Doutores:
  - `https://espacofacial.com/doutores`
- Privacidade:
  - `https://espacofacial.com/privacidade`
- Termos:
  - `https://espacofacial.com/termos`
- Robots:
  - `https://espacofacial.com/robots.txt`
- Sitemap:
  - `https://espacofacial.com/sitemap.xml`
- 404:
  - `https://espacofacial.com/nao-existe`

## Bateria manual recorrente

### Cenário 1: entrada com UTMs

- Abrir:
  - `https://espacofacial.com/agendamento?utm_source=meta&utm_medium=paid_social&utm_campaign=teste_tracking&utm_content=criativo_a`
- Aceitar cookies de marketing e analytics.
- Concluir um agendamento.
- Validar no CRM:
  - booking com `tracking_context`
  - booking com `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`
  - booking com `meta_event_id`

### Cenário 2: entrada com fbclid

- Abrir:
  - `https://espacofacial.com/agendamento?utm_source=meta&utm_medium=paid_social&utm_campaign=teste_fbclid&fbclid=teste-fbclid-validacao`
- Aceitar cookies de marketing e analytics.
- Concluir um agendamento.
- Validar no CRM:
  - booking com `fbclid`
  - booking com `fbp/fbc` quando aplicável
  - `Schedule via CAPI OK`

### Cenário 3: consentimento recusado

- Abrir o site em sessão limpa.
- Recusar cookies opcionais no banner.
- Concluir um agendamento.
- Validar:
  - booking confirmado normalmente
  - sem envio indevido de marketing
  - modal final mostra opt-in opcional de mensuração quando aplicável

### Cenário 4: consentimento previamente aceito

- Abrir o site em sessão com consentimento de marketing já salvo.
- Avançar até o modal final do agendamento.
- Validar:
  - checkbox opcional de mensuração não aparece
  - agendamento exige apenas o checkbox obrigatório de privacidade

### Cenário 5: clique para WhatsApp

- Abrir qualquer CTA público de WhatsApp do site.
- Validar:
  - navegação passa por `/api/whatsapp/redirect`
  - `Contact` aparece no CRM
  - `wa_click_id` é gerado

## Redirects e domínio

- `https://www.espacofacial.com/` deve responder `308` para `https://espacofacial.com/`
- `https://espacofacial.com/barrashoppingsul/faleconosco` deve cair em `/api/whatsapp/redirect` e depois no WhatsApp
- `https://espacofacial.com/novohamburgo/faleconosco` deve seguir a mesma trilha
- `npm run tracking:governance` não deve apontar `www.espacofacial.com` em conteúdo canônico

## Leitura esperada no CRM

- O bloco de saúde do tracking deve estar em:
  - `saudável`, quando não houver alertas
  - `degradado`, quando houver cobertura insuficiente ou falhas não críticas
  - `crítico`, quando houver indisponibilidade ou quebra séria de entrega
- O CRM deve exibir:
  - buckets de reconciliação
  - bookings com tracking incompleto
  - falhas retryable para reprocessamento
  - governança de campanhas e allowlist cross-domain

## Observações operacionais

- Campanhas de booking devem sempre apontar para `https://espacofacial.com`.
- `espacofacial.com.br` e `app.espacofacial.com.br` continuam como stacks oficiais separados.
- `crm.skincos.com.br`, `orb.skincos.com.br` e `wa.skincos.com.br` são domínios internos/técnicos e não devem ser destino público de mídia para este funil.
