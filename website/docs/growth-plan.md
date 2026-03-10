# Plano de crescimento (Marketing + Tracking)

## Objetivo
Aumentar conversão de *visita → escolha de unidade → clique em agendar → contato no WhatsApp*.

## Métricas mínimas
- Sessões / usuários (GA4)
- Page views por página principal (`/`, `/unidades`, `/doutores`, `/unidades/[slug]`)
- Eventos de conversão:
  - `cta_agendar_click` (principal)
  - `cta_escolher_unidade_click`
  - `unit_select`

## Instrumentação (já preparada no código)
- Variáveis (Cloudflare Workers env vars):
  - `NEXT_PUBLIC_GA4_ID` (opcional)
  - `NEXT_PUBLIC_GTM_ID` (opcional; se usar GTM)
- Onde testar:
  - Abra o site, selecione uma unidade e clique em “Agendar”.
  - No DevTools console, rode: `window.dataLayer` e verifique eventos.

## Eventos (nomenclatura sugerida)
- `cta_agendar_click`
  - props: `placement` (header|floating|doctor), `unitSlug`, `doctorName` (quando aplicável)
- `cta_escolher_unidade_click`
  - props: `placement`
- `unit_select`
  - props: `unitSlug`, `placement`

## Páginas de conversão (recomendadas)
1. `/unidades/[slug]` como landing principal por unidade
   - Conteúdo: endereço, mapa, horário, como chegar, procedimentos mais buscados, fotos reais.
   - CTA repetido: “Agendar agora” acima da dobra.
2. Páginas por procedimento (quando houver conteúdo)
   - Ex.: `/procedimentos/botox`, `/procedimentos/preenchimento-labial`
   - Cada uma com CTA para escolher unidade e agendar.

## UTMs (padrão)
- `utm_source`: instagram | google | meta | tiktok | whatsapp
- `utm_medium`: cpc | organic | referral
- `utm_campaign`: nome-curto-campanha
- `utm_content`: criativo/variação

## Check de consistência
- Sempre forçar canônico sem `www`.
- Para links curtos, usar `esfa.co/{sigla}/faleconosco` nos materiais.

## TODO (conteúdo)
- Definir lista oficial de unidades ativas e contatos.
- Confirmar claims (anos, número de unidades) antes de recolocar em copy.
