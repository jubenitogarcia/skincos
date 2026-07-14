# Governança de URLs de campanha

## Regra principal

Toda campanha com objetivo de agendamento e otimização por `Schedule` deve apontar para `https://espacofacial.com`, nunca para `espacofacial.com.br`, `app.espacofacial.com.br` ou links diretos de WhatsApp.

## Parâmetros mínimos obrigatórios

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`

Parâmetro opcional, quando existir:

- `utm_term`

## Exemplos válidos

```text
https://espacofacial.com/agendamento?utm_source=meta&utm_medium=paid_social&utm_campaign=bss_botox&utm_content=video_a
https://espacofacial.com/novohamburgo?utm_source=meta&utm_medium=paid_social&utm_campaign=nh_avaliacao&utm_content=carrossel_1
```

## Exemplos inválidos

```text
https://espacofacial.com/agendamento
https://espacofacial.com.br/agendamento?utm_source=meta&utm_medium=paid_social
https://wa.me/message/MT7UGL6U6KYWA1
https://api.whatsapp.com/send?phone=5551980882293
```

## Regras operacionais

1. Qualquer CTA de mídia paga que queira otimizar por conversão deve cair primeiro no site.
2. O clique para WhatsApp deve acontecer apenas depois da passagem pelo site, para preservar `Contact`, `wa_click_id` e contexto first-party.
3. Links encurtados, landing pages auxiliares e redirecionamentos devem preservar query string.
4. O host canônico continua sendo `espacofacial.com`.
5. Se a campanha depender de stack externa da franquia, isso deve ser uma decisão intencional e fora do funil padrão deste projeto.

## Checklist rápido antes de publicar campanha

1. O domínio é `espacofacial.com`.
2. A URL contém `utm_source`, `utm_medium`, `utm_campaign` e `utm_content`.
3. O destino final não é `wa.me`, `api.whatsapp.com` ou `.com.br`.
4. A oferta/CTA leva o usuário ao site antes de qualquer conversa no WhatsApp.
