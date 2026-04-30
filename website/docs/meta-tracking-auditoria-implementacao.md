# Meta Tracking, Pixel, CAPI e WhatsApp - Espaço Facial

## 1. Diagnóstico atual

- Stack real do site público: `website/` em `Next.js 15 App Router`, deploy via `OpenNext + Cloudflare Workers`, persistência de agendamento em `Cloudflare D1`.
- O ponto real de conversão confirmada no site é `POST /api/booking/request`. O backend grava o booking e responde com `status = "confirmed"`.
- Havia consentimento, GTM/GA4 e Meta Pixel no browser, mas o tracking Meta estava incompleto:
  - sem `Conversions API`;
  - sem `event_id` para deduplicação browser/server;
  - sem persistência robusta de atribuição até o backend;
  - com espelhamento indiscriminado de eventos customizados para `fbq('trackCustom', ...)`.
- O host canônico deste projeto público é `https://espacofacial.com`. `www.espacofacial.com` continua roteado e redireciona para o apex.
- `espacofacial.com.br` é um domínio oficial separado da franquia, operado fora deste app.
- `app.espacofacial.com.br` é um ambiente/aplicação separado, também fora deste app.
- `skincos.com.br` é o domínio institucional/operacional da SKINCOS, com subdomínios como `orb.skincos.com.br`, `crm.skincos.com.br` e `wa.skincos.com.br`.

## 2. Problemas encontrados

- Ausência de `Conversions API` para o evento final do booking.
- Ausência de deduplicação `event_id` entre browser e server.
- `PageView` da Meta dependia da carga inicial do Pixel, sem cobertura explícita de navegação client-side.
- Contexto de origem (`utm_*`, `fbclid`, `fbp`, `fbc`, landing/referrer) não chegava ao backend do booking.
- Clique para WhatsApp saía por links externos ou redirects simples, sem `wa_click_id`, sem log server-side e sem `Contact` deduplicado.
- Parte dos CTAs de agendamento ainda navegava sem `Lead` consistente.
- Havia referências internas residuais para `www.espacofacial.com`.
- `espacofacial.com.br` permanece ativo em stack separado, com finalidade própria da franquia. O risco não é “legado”; o risco é haver links, campanhas ou navegação cruzada entre stacks sem política operacional explícita.

## 3. Implementações realizadas

### Tracking e atribuição

- Criei uma camada dedicada de atribuição em first-party com persistência de:
  - `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`
  - `gclid`, `gbraid`, `wbraid`, `msclkid`, `fbclid`
  - `fbp`, `fbc`
  - `landingUrl`, `landingPath`, `referrer`
  - `firstTouch` e `lastTouch`
- A persistência continua condicionada ao consentimento atual do banner.
- Removi o espelhamento genérico de eventos customizados para a Meta. A Meta agora recebe apenas eventos modelados explicitamente.

### Meta Pixel no browser

- Mantive o carregamento do Pixel condicionado a consentimento de marketing.
- Separei o `PageView` em um tracker client-side por navegação.
- Modelei disparos browser-side para:
  - `PageView`
  - `ViewContent`
  - `Lead`
  - `InitiateCheckout`
  - `Contact`
  - `Schedule`

### Conversions API

- Implementei helper server-side de Meta CAPI com:
  - `event_name`, `event_time`, `event_id`
  - `action_source = website`
  - `event_source_url`
  - `fbp`, `fbc`
  - `client_ip_address`, `client_user_agent`
  - `em`, `ph`, `external_id` com hashing
  - suporte a `META_CAPI_TEST_EVENT_CODE`
  - flag de debug
- O evento principal `Schedule` agora é enviado server-side imediatamente após a confirmação do booking.
- O evento `Contact` de WhatsApp também é enviado server-side pela nova rota first-party.

### Booking / backend

- `POST /api/booking/request` agora aceita:
  - `trackingContext`
  - `metaEventId`
- O booking persistido em D1 agora guarda:
  - `tracking_context_json`
  - `attribution_first_touch_json`
  - `attribution_last_touch_json`
  - `meta_event_id`
  - `marketing_consent`
  - `analytics_consent`
  - `fbp`, `fbc`, `fbclid`
  - `landing_page`
  - `referrer`
- Adicionei tabela de auditoria `meta_capi_delivery_logs`.
- O webhook `booking.created` agora leva `metaEventId` e `trackingContext`.

### WhatsApp first-party

- Criei `GET /api/whatsapp/redirect`.
- Essa rota:
  - recebe o destino real do WhatsApp;
  - gera `wa_click_id`;
  - injeta token curto `Ref:EF-XXXXXXXX` na mensagem;
  - registra o clique em `whatsapp_click_events`;
  - dispara `Contact` via CAPI com o mesmo `event_id` usado no browser;
  - redireciona para `wa.me` / `api.whatsapp.com`.
- Os atalhos `faleconosco` agora passam pela camada first-party.
- Atualizei CTAs importantes para usar a nova camada:
  - confirmação de booking;
  - modal de mapa/unidade;
  - atalho de alteração de reserva no hero do agendamento;
  - CTA do cadastro/roleta.

### Funil / páginas

- Adicionei `ViewContent` nas páginas de unidade e doutor.
- Adicionei `ViewContent` na primeira seleção de procedimento do fluxo de booking.
- Adicionei `InitiateCheckout` na abertura do modal final do agendamento.
- Corrigi CTAs de agendamento sem tracking em pontos relevantes do site.

### CRM / n8n

- Atualizei a migration `db/migrations/20260217_wa_n8n.sql` para suportar:
  - `external_id` em `wa_n8n.contacts`
  - `wa_click_id` e `source_tracking` em `wa_n8n.conversations`
  - `wa_click_id` e `source_tracking` em `wa_n8n.appointments`
- Atualizei os workflows:
  - `WORKFLOW_01_INBOUND_TRIAGEM.json` agora reconhece o token `Ref:EF-XXXXXXXX`, persiste `wa_click_id` e carrega `source_tracking`;
  - `WORKFLOW_02_AGENDAMENTO.json` agora propaga `wa_click_id` e `source_tracking` para `appointments`.

## 4. Arquivos alterados

### Website

- `website/src/lib/attribution.ts`
- `website/src/lib/campaign.ts`
- `website/src/lib/metaBrowser.ts`
- `website/src/lib/metaConversionsApi.ts`
- `website/src/lib/whatsappTracking.ts`
- `website/src/lib/analytics.ts`
- `website/src/lib/conversions.ts`
- `website/src/lib/bookingDb.ts`
- `website/src/components/CampaignAttribution.tsx`
- `website/src/components/MarketingPixels.tsx`
- `website/src/components/MetaPageTracker.tsx`
- `website/src/components/MetaMountEvent.tsx`
- `website/src/components/TrackedWhatsappLink.tsx`
- `website/src/components/BookingFlow.tsx`
- `website/src/components/BookingConfirmationCard.tsx`
- `website/src/components/BookingHeroExperience.tsx`
- `website/src/components/UnitMapsModal.tsx`
- `website/src/components/CadastroWheelExperience.tsx`
- `website/src/components/HeaderMobileMenu.tsx`
- `website/src/components/AboutUsSection.tsx`
- `website/src/components/UnitDoctorsGrid.tsx`
- `website/src/app/api/booking/request/route.ts`
- `website/src/app/api/whatsapp/redirect/route.ts`
- `website/src/app/[unit]/faleconosco/route.ts`
- `website/src/app/faleconosco/[sigla]/route.ts`
- `website/src/app/[unit]/page.tsx`
- `website/src/app/unidades/[slug]/page.tsx`
- `website/src/app/doutores/[slug]/page.tsx`
- `website/src/data/doctors.ts`

### Testes

- `website/tests/attribution.test.ts`
- `website/tests/whatsappTracking.test.ts`

### CRM / n8n

- `db/migrations/20260217_wa_n8n.sql`
- `n8n/workflows/WORKFLOW_01_INBOUND_TRIAGEM.json`
- `n8n/workflows/WORKFLOW_02_AGENDAMENTO.json`

## 5. Eventos implementados

| Evento | Tipo | Trigger | Origem | Parâmetros principais | Objetivo |
|---|---|---|---|---|---|
| `PageView` | Standard | navegação em páginas com consentimento de marketing | browser | `page_path`, `page_query` | base de visita e audiência |
| `ViewContent` | Standard | página de unidade, página de doutor, seleção de procedimento | browser | `content_type`, `content_name`, `content_ids`, `unit_slug`, `doctor_slug` | qualificar interesse no conteúdo/serviço |
| `Lead` | Standard | clique de alta intenção para iniciar agendamento | browser | `source`, `placement`, `unitSlug` | otimização de topo/meio de funil |
| `InitiateCheckout` | Standard | abertura do modal final do booking | browser | `content_type`, `service_id`, `service_name`, `unit_slug`, `doctor_slug`, `date`, `time` | identificar entrada na etapa final |
| `Contact` | Standard | clique para WhatsApp | browser + server | `placement`, `source`, `unit_slug`, `doctor_name`, `booking_id`, `wa_click_id` | medir saída para atendimento |
| `Schedule` | Standard | `POST /api/booking/request` concluído com sucesso | browser + server | `booking_id`, `unit_slug`, `doctor_slug`, `service_id`, `service_name`, `date`, `time`, `currency` | evento principal de otimização |

### Evento principal para otimização

- Recomendação atual: `Schedule`
- Justificativa:
  - representa a confirmação efetiva do agendamento;
  - nasce no backend do site;
  - suporta browser + CAPI com deduplicação;
  - independe de pagamento online.

## 6. Variáveis de ambiente necessárias

### Browser / site

- `NEXT_PUBLIC_META_PIXEL_ID`
- `NEXT_PUBLIC_GOOGLE_ADS_ID` (se continuar usando)
- `NEXT_PUBLIC_GOOGLE_ADS_LEAD_SEND_TO` (opcional)
- `NEXT_PUBLIC_GOOGLE_ADS_CONTACT_SEND_TO` (opcional)
- `NEXT_PUBLIC_SITE_URL=https://espacofacial.com`

### Server / CAPI

- `META_ACCESS_TOKEN`
- `META_PIXEL_ID` (opcional se quiser separar do `NEXT_PUBLIC_META_PIXEL_ID`)
- `META_API_VERSION` (opcional, default `v22.0`)
- `META_CAPI_TEST_EVENT_CODE` (opcional, para testes no Events Manager)
- `META_CAPI_DEBUG=1` (opcional)

### Booking e webhooks

- `BOOKING_DB`
- `BOOKING_WEBHOOK_URL` (opcional)
- `BOOKING_WEBHOOK_SECRET` (opcional)
- `BOOKING_STATUS_SECRET` ou `BOOKING_DECISION_SECRET`
- `BOOKING_WHATSAPP_WEBHOOK_URL` / `BOOKING_WHATSAPP_WEBHOOK_SECRET` se a operação continuar usando envio transacional atual

## 7. Como publicar em produção

1. Configurar secrets/envs do Worker.
2. Aplicar a migration do Postgres do stack n8n:
   - `psql \"$DATABASE_URL\" -f db/migrations/20260217_wa_n8n.sql`
3. Reimportar/publicar os workflows n8n alterados:
   - `WORKFLOW_01_INBOUND_TRIAGEM.json`
   - `WORKFLOW_02_AGENDAMENTO.json`
4. Fazer deploy do `website/`.
5. Validar com `META_CAPI_TEST_EVENT_CODE` ativo antes de remover o modo de teste.

## 8. Como validar no Meta Events Manager

### Teste completo

1. Entrar por URL com `utm_*` e `fbclid`.
2. Aceitar cookies de marketing.
3. Navegar por home, unidade e doutor.
4. Abrir `/agendamento`.
5. Selecionar procedimento, data e horário.
6. Confirmar o booking.
7. Verificar no Meta:
   - `PageView`
   - `ViewContent`
   - `Lead`
   - `InitiateCheckout`
   - `Schedule`
8. Confirmar que `Schedule` aparece deduplicado entre browser/server.
9. Clicar em um CTA de WhatsApp e validar `Contact`.
10. Confirmar no banco:
   - `booking_requests.meta_event_id`
   - `booking_requests.fbp`
   - `booking_requests.fbc`
   - `booking_requests.fbclid`
   - `booking_requests.tracking_context_json`
   - `whatsapp_click_events.wa_click_id`
   - `meta_capi_delivery_logs`

### Teste de consentimento

1. Recusar marketing.
2. Repetir navegação.
3. Confirmar que Pixel/CAPI não enviam eventos de marketing.

### Teste n8n / WhatsApp

1. Clicar em CTA de WhatsApp do site.
2. Abrir a conversa e enviar a mensagem com `Ref:EF-XXXXXXXX`.
3. Disparar o webhook do Evolution no `WORKFLOW_01`.
4. Confirmar persistência de `wa_click_id` em `wa_n8n.conversations`.
5. Completar o agendamento via `WORKFLOW_02`.
6. Confirmar `wa_click_id` também em `wa_n8n.appointments`.

## 9. Pendências externas

- `espacofacial.com.br` e `app.espacofacial.com.br` continuam fora deste app e devem ser tratados como ambientes oficiais separados.
- O que precisa de decisão operacional não é extinguir o domínio `.com.br`, e sim definir regras claras de:
  - mídia paga para `espacofacial.com` quando o objetivo for booking/Meta tracking do site;
  - canonicalização/SEO por stack;
  - preservação de atribuição quando houver navegação entre stacks.
- Os redirects legados de shortlinks/atalhos no Worker ainda precisam de migração total para a camada first-party se a operação quiser fechar 100% das saídas antigas de click-to-WhatsApp.
- Fechamento offline de WhatsApp para Meta além do n8n atual ainda depende de decisão operacional:
  - usar o próprio n8n para enviar `Schedule` offline/CAPI;
  - ou integrar CRM final responsável pelo status/venda.

## 10. Recomendação de configuração de campanhas na Meta

- Evento de otimização principal: `Schedule`
- Janela inicial recomendada:
  - atribuição padrão da Meta para conversão no site
  - foco em campanhas para conversão no site, não click-to-WhatsApp
- Estrutura sugerida:
  - campanhas com destino `espacofacial.com/agendamento`
  - conjuntos por unidade ou macro-oferta quando o volume permitir
  - criativos com CTA para agendamento no site
  - remarketing usando visitantes de unidade/doutor e iniciadores de booking sem `Schedule`
- Manter campanhas click-to-WhatsApp apenas como trilha paralela de teste/controlado, agora com `Contact` first-party e correlação por `wa_click_id`.

## 11. Próximos passos prioritários

1. Publicar Worker + envs Meta e validar com `test_event_code`.
2. Aplicar migration Postgres e republicar os workflows n8n alterados.
3. Validar `Schedule` deduplicado no Events Manager.
4. Validar `wa_click_id` no fluxo site -> WhatsApp -> n8n -> agendamento.
5. Manter a política operacional já definida:
   - `espacofacial.com` para site público, booking e mídia do funil rastreado;
   - `espacofacial.com.br` e `app.espacofacial.com.br` como ambientes oficiais separados;
   - `crm.skincos.com.br`, `orb.skincos.com.br` e `wa.skincos.com.br` como subdomínios operacionais da SKINCOS.
6. Migrar gradualmente os redirects legados do Worker que ainda levam direto ao WhatsApp para a camada first-party.
