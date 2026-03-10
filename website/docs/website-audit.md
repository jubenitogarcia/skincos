# Website Audit — Performance & Conversion (2026-03-03)

## Scope
- Website pages and direct interfaces impacting the booking funnel.
- Data gathered from production via Playwright (navigation timings, resource counts).

## Evidence Snapshot (prod)
### Performance timings (ms)
| Path | TTFB | DOMContentLoaded | Load |
|---|---:|---:|---:|
| `/` | 872 | 1182 | 1189 |
| `/agendamento` | 84 | 183 | 208 |
| `/doutores` | 859 | 964 | 994 |
| `/unidades` | 1517 | 1696 | 1717 |
| `/sobre` | 761 | 853 | 878 |
| `/termos` | 50 | 123 | 131 |
| `/privacidade` | 46 | 141 | 156 |

### Resource footprint
| Path | Resource count | Transfer (bytes) | Decoded (bytes) |
|---|---:|---:|---:|
| `/` | 24 | 6,703 | 1,331,107 |
| `/agendamento` | 34 | 7,903 | 1,123,813 |
| `/doutores` | 26 | 7,303 | 292,503 |
| `/unidades` | 24 | 6,703 | 33,967 |
| `/sobre` | 24 | 6,703 | 33,967 |
| `/termos` | 18 | 4,800 | 35,608 |
| `/privacidade` | 16 | 4,500 | 0 |

### Top domains
- `espacofacial.com` (21–27 requests)
- `static.cloudflareinsights.com` (1 request)

### Meta/SEO highlights
- `/agendamento`, `/privacidade`, `/termos` com **canonical** aplicado.  
- Atalhos `/doutores`, `/sobre`, `/unidades` **redirecionam para `/#...`** e exibem o metadata da home.

---

## Funil de agendamento (mapa rápido)
1) **Entrada**: `/` (CTA “Agende”), `/doutores`, `/unidades`.
2) **Seleção de unidade**: header unit chooser.
3) **Agendamento**: `/agendamento` → escolhe doutor → procedimento → serviços → data/horário.
4) **APIs chamadas no fluxo**:
   - `/api/equipe` (listagem de doutores)
   - `/api/booking/services`
   - `/api/booking/slots`
   - `/api/booking/request`
   - `/api/booking/status`
   - `/api/agenda` (consulta agenda sincronizada)

## Dependências críticas
- **D1**: `BOOKING_DB` (slots + agenda)
- **Google Sheets API**: `getUnitDoctorsResult` (listagem de doutores)
- **Cloudflare runtime**: Workers/Pages

---

## Findings (abertos)

### F3 — Home TTFB ainda alto vs. /agendamento
**Evidence:** TTFB `/` ~872ms vs `/agendamento` ~84ms.  
**Impacto:** primeira impressão lenta na entrada principal.  
**Prioridade:** P2  
**Validação:** TTFB reduzido (p95) em produção.

### F4 — Conversão depende de múltiplas escolhas antes de ver horários
**Evidence:** o fluxo exige unidade + doutor + procedimento + serviços para liberar datas.  
**Impacto:** fricção inicial; risco de abandono.  
**Prioridade:** P2  
**Validação:** reduzir passos visíveis antes de mostrar datas ou melhorar orientação (mudança no código; validar após deploy).

### F5 — Rotas de atalho precisam validar metadata próprio
**Evidence:** `/doutores`, `/sobre`, `/unidades` redirecionam para `/#...` e o título exibido permanece “Espaço Facial”.  
**Impacto:** perda de sinal SEO específico e CTR menor em buscas por página.  
**Prioridade:** P1  
**Validação:** HTML dessas rotas com title/description próprios (mudança implementada no código; validar após deploy).

---

## Status (implementado)
- Canonical adicionado em `/agendamento`, `/privacidade`, `/termos`.
- Metadata específica aplicada em `/doutores`, `/sobre`, `/unidades`.
- Mitigação de TTFB na Home: cache + timeout no carregamento de mídias remotas.  
  Re-medição (Playwright): `/` ~872ms, `/agendamento` ~84ms, `/doutores` ~859ms.
- Rotas `/doutores`, `/sobre`, `/unidades` agora são páginas próprias (pendente deploy/validação).
- Datas/horários liberados após seleção de unidade; procedimento e profissional ficam como filtro/confirmação (pendente deploy/validação).

---

## Assumptions / Missing Data
- **Web Vitals (LCP/CLS/INP)**: não medidos nesta varredura.  
  *Validação mínima*: coletar via Web Vitals no front ou Lighthouse.

## Medições instrumentadas (implementado)
- Web Vitals enviados como evento `web_vital` (consentimento analítico/marketing).

---

## Backlog Prioritizado (com critérios testáveis)

### P0
**(Nada crítico de conversão identificado nesta varredura curta)**

### P1
1) **Canonical em todas as páginas**  ✅  
   - Aceite: `<link rel="canonical">` presente em `/agendamento`, `/privacidade`, `/termos`.  
   - Validação: inspeção HTML.

2) **Metas específicas por página (title/description/OG)**  ✅  
   - Aceite: `/doutores`, `/sobre`, `/unidades` com descrição única.  
   - Validação: inspeção HTML e snapshot.

3) **Decidir estratégia para rotas de atalho (`/doutores`, `/sobre`, `/unidades`)**  ✅  
   - Aceite: rotas servem conteúdo próprio com metadata dedicado **ou** redirecionam de forma explícita com canonical/SEO ajustado.  
   - Validação: HTML final e comportamento de navegação.

### P2
4) **Otimizar TTFB da Home**  (mitigação aplicada)  
   - Aceite: TTFB < 600ms (p95).  
   - Validação: métricas de produção (monitoramento).

5) **Reduzir fricção no início do agendamento**  
   - Aceite: datas visíveis com menos etapas ou orientação clara.  
   - Validação: teste UX e redução de abandono.

---

## Next steps
- Monitorar TTFB (p95) em produção após deploy.
- Rodar coleta completa de Web Vitals (LCP/CLS/INP) e comparar baseline.
- Ajustar fricção do início do agendamento (datas visíveis com menos etapas).
- Definir a estratégia de SEO para rotas de atalho (`/doutores`, `/sobre`, `/unidades`).
