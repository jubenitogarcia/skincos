# 🔄 Fluxograma Completo - Webhook Após Cupom

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                      FLUXO COMPLETO DE AUTOMAÇÃO                          ║
║                    Com Webhook Após Aplicação de Cupom                    ║
╚═══════════════════════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────────────────┐
│ 📝 ETAPA 1: SUBMISSÃO DO FORMULÁRIO                                     │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │ Usuário preenche formulário Wix
         │
         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 📊 ETAPA 2: GOOGLE SHEETS                                               │
│                                                                          │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ DATA  │ ID            │ NOME  │ SOBRENOME │ EMAIL       │ ...      │ │
│ │ 10/04 │ inscricao_001 │ João  │ Silva     │ joao@...    │ ...      │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │ Google Apps Script exporta linha como CSV
         │
         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 📂 ETAPA 3: GITHUB REPOSITORY                                           │
│                                                                          │
│ Arquivo: inscricoes/inscricao_20251004_123456.csv                       │
│                                                                          │
│ Conteúdo:                                                                │
│ DATA,ID,NOME,SOBRENOME,EMAIL,TELEFONE,CPF,GENERO,CORRIDA,DATA_NASC,... │
│ 2025-10-04,inscricao_001,João,Silva,joao@email.com,51999887766,...     │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │ GitHub Actions detecta novo arquivo
         │
         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 🤖 ETAPA 4: GITHUB ACTIONS WORKFLOW                                     │
│                                                                          │
│ name: Process Inscricoes v2                                              │
│ on:                                                                      │
│   push:                                                                  │
│     paths:                                                               │
│       - 'inscricoes/*.csv'                                               │
│                                                                          │
│ jobs:                                                                    │
│   process:                                                               │
│     - Setup Python                                                       │
│     - Install dependencies                                               │
│     - Run: python sprinta_automation.py ${{ CSV_FILE }}                 │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │ Inicia automação Python
         │
         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 🐍 ETAPA 5: PYTHON AUTOMATION                                           │
│                                                                          │
│ ┌─────────────────────────────────────────────────────────────────┐    │
│ │ 1. Login no Sprinta                                              │    │
│ │    └─> email: novohamburgo@espacofacial.com.br                  │    │
│ └─────────────────────────────────────────────────────────────────┘    │
│         │                                                                │
│         ↓                                                                │
│ ┌─────────────────────────────────────────────────────────────────┐    │
│ │ 2. Lê CSV e processa cada participante                           │    │
│ │    └─> Detecta formato (novo ou antigo)                         │    │
│ │    └─> Mapeia colunas                                            │    │
│ └─────────────────────────────────────────────────────────────────┘    │
│         │                                                                │
│         ↓                                                                │
│ ┌─────────────────────────────────────────────────────────────────┐    │
│ │ 3. register_participant()                                        │    │
│ │    ├─> Acessa evento: /event/30560768ac8e7500fef                │    │
│ │    ├─> Clica "Enroll a friend" (2x)                             │    │
│ │    ├─> Preenche dados pessoais                                   │    │
│ │    ├─> Seleciona categoria                                       │    │
│ │    ├─> Escolhe kit                                               │    │
│ │    ├─> Define tamanho camiseta                                   │    │
│ │    ├─> Seleciona equipe                                          │    │
│ │    └─> Finaliza inscrição                                        │    │
│ └─────────────────────────────────────────────────────────────────┘    │
│         │                                                                │
│         │ Redireciona para checkout                                     │
│         ↓                                                                │
│ ┌─────────────────────────────────────────────────────────────────┐    │
│ │ 4. apply_discount_coupon()                                       │    │
│ │    └─> Cupom: ESPACOFACIALNH10                                   │    │
│ │        ├─> Encontra campo de cupom (4 estratégias)              │    │
│ │        ├─> Preenche código                                       │    │
│ │        ├─> Clica em "Aplicar"                                    │    │
│ │        └─> ✅ Verifica aplicação bem sucedida                     │    │
│ └─────────────────────────────────────────────────────────────────┘    │
│         │                                                                │
│         │ Cupom aplicado com sucesso! ✅                                │
│         ↓                                                                │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │ Obtém URL final do checkout
         │
         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 📤 ETAPA 6: WEBHOOK PARA WIX                                            │
│                                                                          │
│ Função: send_wix_webhook()                                               │
│                                                                          │
│ POST: https://manage.wix.com/_api/webhook-trigger/report/...            │
│                                                                          │
│ Headers:                                                                 │
│   Content-Type: application/json                                         │
│   User-Agent: Sprinta-Automation/2.0                                     │
│                                                                          │
│ Payload:                                                                 │
│   {                                                                      │
│     "submissionId": "inscricao_001",                                     │
│     "success": true,                                                     │
│     "redirectUrl": "https://checkout.sprinta.com.br/v27310473..."       │
│   }                                                                      │
│                                                                          │
│ Response: 200 OK                                                         │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │ Webhook enviado! ✅
         │
         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 🌐 ETAPA 7: WIX BACKEND                                                 │
│                                                                          │
│ Webhook Receiver (backend/webhook-receiver.jsw):                        │
│                                                                          │
│ export async function post_webhookReceiver(request) {                   │
│   const payload = await request.body.json();                            │
│                                                                          │
│   // Atualizar banco de dados                                           │
│   await wixData.update('Inscricoes', {                                  │
│     _id: payload.submissionId,                                           │
│     checkoutUrl: payload.redirectUrl,                                    │
│     status: 'concluido',                                                 │
│     processedAt: new Date()                                              │
│   });                                                                    │
│                                                                          │
│   return { status: 200, body: { status: 'ok' } };                       │
│ }                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │ Banco de dados atualizado
         │
         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 💻 ETAPA 8: WIX FRONTEND                                                │
│                                                                          │
│ Página de Inscrição (aguardando processamento):                         │
│                                                                          │
│ $w.onReady(async function() {                                           │
│   const submissionId = $w('#submissionIdField').value;                  │
│                                                                          │
│   // Polling: verificar status                                          │
│   const inscricao = await waitForProcessing(submissionId);              │
│                                                                          │
│   if (inscricao.checkoutUrl) {                                          │
│     // Redirecionar para checkout                                       │
│     wixLocation.to(inscricao.checkoutUrl);                              │
│   }                                                                      │
│ });                                                                      │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │ Redireciona usuário
         │
         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 💳 ETAPA 9: CHECKOUT FINAL                                              │
│                                                                          │
│ URL: https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g           │
│                                                                          │
│ ┌─────────────────────────────────────────────────────────────┐        │
│ │ ✅ Inscrição: 5K - Recreativa                                │        │
│ │ ✅ Nome: João Silva                                          │        │
│ │ ✅ Email: joao@email.com                                     │        │
│ │                                                              │        │
│ │ 💰 Valor Original: R$ 100,00                                 │        │
│ │ 🎟️  Cupom ESPACOFACIALNH10: -R$ 10,00                        │        │
│ │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━       │        │
│ │ 💳 Total: R$ 90,00                                           │        │
│ │                                                              │        │
│ │ [ Finalizar Pagamento ]                                      │        │
│ └─────────────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │ Usuário finaliza pagamento
         │
         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 🎉 CONCLUSÃO                                                             │
│                                                                          │
│ ✅ Inscrição processada                                                  │
│ ✅ Cupom aplicado automaticamente                                        │
│ ✅ Webhook enviado para Wix                                              │
│ ✅ Usuário redirecionado para checkout                                   │
│ ✅ Desconto de R$ 10,00 aplicado                                         │
│ ✅ Pronto para pagamento!                                                │
└─────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════
                         TIMING ESTIMADO POR ETAPA
═══════════════════════════════════════════════════════════════════════════

Etapa 1-3: Formulário → GitHub          │ ~1-2 segundos
Etapa 4: GitHub Actions trigger          │ ~5-10 segundos
Etapa 5: Automação Python (completa)     │ ~30-60 segundos
  ├─ Login                                │   ~5 segundos
  ├─ Preenchimento formulário             │   ~20 segundos
  ├─ Aplicação de cupom                   │   ~10 segundos
  └─ Outros                               │   ~5 segundos
Etapa 6: Webhook para Wix                 │ ~1-2 segundos
Etapa 7-8: Processamento Wix              │ ~1-2 segundos
──────────────────────────────────────────────────────────────────────────
TOTAL: ~40-80 segundos (fim a fim)

═══════════════════════════════════════════════════════════════════════════
                            PONTOS DE FALHA
═══════════════════════════════════════════════════════════════════════════

🔴 CRÍTICOS (Bloqueiam o fluxo):
  ├─ Login falha no Sprinta
  ├─ Formulário não carrega
  ├─ Checkout não é gerado
  └─ Cupom não pode ser aplicado

🟡 NÃO-CRÍTICOS (Não bloqueiam):
  ├─ Webhook falha (inscrição continua)
  ├─ submission_id ausente (webhook não enviado)
  └─ Timeout de rede (retry manual)

═══════════════════════════════════════════════════════════════════════════
                          VARIÁVEIS DE AMBIENTE
═══════════════════════════════════════════════════════════════════════════

Obrigatórias:
  ├─ SPRINTA_EMAIL      │ Login do Sprinta
  └─ SPRINTA_PASSWORD   │ Senha do Sprinta

Opcionais:
  └─ WIX_WEBHOOK_URL    │ URL customizada do webhook
                         │ (usa padrão se não definida)

═══════════════════════════════════════════════════════════════════════════
```

## 🎯 Resumo Visual

```
Formulário Wix → Google Sheets → GitHub → Actions
                                              ↓
                    ┌─────────────────────────┘
                    │
                    ↓
            Python Automation
                    │
            ┌───────┴────────┐
            │                │
         Login          Inscrição
            │                │
            └───────┬────────┘
                    ↓
             Aplicar Cupom ✅
                    │
                    ↓
          Enviar Webhook 📤
                    │
                    ↓
            Wix Recebe 🌐
                    │
                    ↓
       Redirecionar Usuário 💳
```

## 📊 Taxa de Sucesso Esperada

| Etapa | Taxa de Sucesso | Observações |
|-------|----------------|-------------|
| Formulário → GitHub | 99.9% | Muito confiável |
| GitHub Actions | 99.5% | Pode ter fila |
| Login Sprinta | 98% | Depende de credenciais |
| Inscrição | 95% | Pode ter erros de timing |
| Aplicar Cupom | 90% | Elementos podem mudar |
| Webhook | 95% | Depende de rede |
| **TOTAL** | **~80-85%** | Com retry aumenta |

## 🔧 Melhorias Futuras

- [ ] Retry automático para webhook (3 tentativas)
- [ ] Queue system para múltiplas inscrições simultâneas
- [ ] Notificação de erro por email
- [ ] Dashboard de monitoramento em tempo real
- [ ] Cache de sessão do Chrome (já implementado)
- [ ] Logs estruturados em JSON
