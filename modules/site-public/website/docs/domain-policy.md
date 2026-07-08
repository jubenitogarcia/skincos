# Política operacional de domínios

## Escopo

Esta política define qual domínio pertence a qual stack e como cada host deve ser usado na operação de mídia, site, agendamento e ferramentas internas.

## Matriz oficial

| Domínio | Papel | Stack | Regra operacional |
|---|---|---|---|
| `espacofacial.com` | Site público + agendamento | Este projeto `modules/site-public/website/` | Host canônico para navegação, SEO deste app e campanhas com objetivo de booking |
| `www.espacofacial.com` | Alias de entrada | Este projeto `modules/site-public/website/` | Deve redirecionar com `308` para `https://espacofacial.com` |
| `espacofacial.com.br` | Domínio oficial da franquia | Stack separada | Não deve ser tratado como continuação automática do tracking/cookies deste app |
| `app.espacofacial.com.br` | App oficial da franquia | Stack separada | Pode existir como integração operacional, mas não como host do funil público deste site |
| `skincos.com.br` | Hub jurídico/institucional | SKINCOS | Páginas legais e institucionais da SKINCOS |
| `crm.skincos.com.br` | CRM | SKINCOS | Acompanhamento operacional e visualização de tracking |
| `orb.skincos.com.br` | Orquestração / n8n | SKINCOS | Automação e fluxos internos |
| `wa.skincos.com.br` | Stack WhatsApp | SKINCOS | APIs e integrações técnicas de mensagens |

## Regras de atribuição e tracking

1. Campanhas com objetivo de agendamento e otimização por `Schedule` devem apontar para `https://espacofacial.com`.
2. `espacofacial.com.br` e `app.espacofacial.com.br` devem ser tratados como ambientes oficiais separados.
3. Não assumir compartilhamento de:
   - cookies
   - consentimento
   - `_fbp`
   - `_fbc`
   - UTMs persistidas
   - sessão
4. Qualquer navegação do site público para outro domínio oficial deve ser intencional e documentada.
5. O CRM em `crm.skincos.com.br` é um destino de observabilidade operacional, não de entrada de campanha do funil público.

## Regras de canonicalização

1. `espacofacial.com` é o canônico deste projeto.
2. `www.espacofacial.com` deve apenas redirecionar para o apex.
3. URLs públicas, snapshots e metadados deste projeto não devem apontar para `www.espacofacial.com` quando o destino real for o próprio site.

## Regras de operação

1. Se uma campanha tiver como meta booking rastreado neste app, o destino deve ser `espacofacial.com`.
2. Se um fluxo depender de sistema externo da franquia, isso deve ser modelado como integração entre stacks, não como host equivalente.
3. Mudanças futuras de domínio devem atualizar:
   - `site-config.ts`
   - middleware/redirecionamentos
   - snapshots públicos
   - checklist de validação
   - documentação de tracking

## Allowlist operacional de saídas públicas aceitáveis

1. `espacofacial.com.br`
   - permitido apenas quando a navegação pública precisar apontar explicitamente para a stack oficial da franquia
2. `app.espacofacial.com.br`
   - permitido apenas quando houver necessidade explícita de integração com o app externo da franquia
3. `crm.skincos.com.br`
   - não deve ser destino público de campanhas ou CTAs do funil deste site
4. `orb.skincos.com.br`
   - uso exclusivamente técnico/interno
5. `wa.skincos.com.br`
   - uso exclusivamente técnico/interno
