# 🎯 Guia Rápido: Como o Wix Recebe a URL de Pagamento

## 📊 Estrutura JSON Recebida

```json
{
  "status": "success",
  "timestamp": "2025-10-03T14:30:45Z",
  "total_participants": 1,
  "processed_successfully": 1,
  "failed": 0,
  "results": [
    {
      "email": "usuario@example.com",
      "checkout_url": "https://checkout.sprinta.com.br/abc123def456",
      "success": true,
      "discount_applied": "ESPACOFACIALNH10"
    }
  ]
}
```

---

## 🎯 Campo Principal: `checkout_url`

**O que você precisa:**
```javascript
data.results[0].checkout_url
// Retorna: "https://checkout.sprinta.com.br/abc123def456"
```

Esta é a **URL de pagamento COM DESCONTO já aplicado!** ✅

---

## 💻 Código Wix Completo (Copy & Paste)

### Método 1: Backend com Callback (Recomendado)

**Arquivo:** `backend/http-functions.js`

```javascript
import { ok, badRequest } from 'wix-http-functions';
import wixData from 'wix-data';

/**
 * Endpoint para receber resultados do webhook
 * URL: https://seu-site.wixsite.com/_functions/receiveResults
 */
export async function post_receiveResults(request) {
  try {
    // Receber JSON do webhook
    const data = await request.body.json();

    console.log('📥 Recebido:', data);
    console.log(`✅ ${data.processed_successfully} de ${data.total_participants} processados`);

    // Processar cada participante
    for (const result of data.results) {

      if (result.success) {
        // ⭐ URL DE PAGAMENTO AQUI!
        const checkoutURL = result.checkout_url;
        const email = result.email;

        console.log(`✅ ${email}: ${checkoutURL}`);

        // 1. Salvar no banco de dados
        const queryResult = await wixData.query("Participants")
          .eq("email", email)
          .find();

        if (queryResult.items.length > 0) {
          // Atualizar participante existente
          await wixData.update("Participants", {
            _id: queryResult.items[0]._id,
            checkoutUrl: checkoutURL,
            discountApplied: result.discount_applied,
            processedAt: new Date(),
            status: "checkout_ready"
          });
        }

        // 2. Enviar e-mail com link de pagamento
        await sendCheckoutEmail(email, checkoutURL);

      } else {
        // Processamento falhou
        console.error(`❌ Falha para ${result.email}`);

        // Registrar falha no banco de dados
        await wixData.update("Participants", {
          email: result.email,
          status: "processing_failed",
          failedAt: new Date()
        });
      }
    }

    return ok({
      received: true,
      processed: data.results.length,
      successful: data.processed_successfully,
      failed: data.failed
    });

  } catch (error) {
    console.error('❌ Erro ao processar:', error);
    return badRequest({ error: error.message });
  }
}

/**
 * Envia e-mail com link de checkout
 */
async function sendCheckoutEmail(email, checkoutUrl) {
  try {
    // Usar Wix Triggered Emails ou SendGrid
    // Exemplo com Wix Triggered Emails:

    const emailData = {
      to: email,
      subject: "Sua inscrição está pronta! Finalize o pagamento",
      body: `
        <h2>Inscrição Confirmada! 🎉</h2>
        <p>Sua inscrição foi processada com sucesso!</p>
        <p>Clique no botão abaixo para finalizar o pagamento:</p>
        <a href="${checkoutUrl}" style="
          display: inline-block;
          padding: 15px 30px;
          background-color: #4CAF50;
          color: white;
          text-decoration: none;
          border-radius: 5px;
          font-weight: bold;
        ">Finalizar Pagamento</a>
        <p><small>Ou copie o link: ${checkoutUrl}</small></p>
        <p><strong>✨ Desconto ESPACOFACIALNH10 já aplicado!</strong></p>
      `
    };

    // Implementar envio de e-mail conforme sua configuração
    console.log('📧 E-mail seria enviado para:', email);

    return true;
  } catch (error) {
    console.error('Erro ao enviar e-mail:', error);
    return false;
  }
}
```

---

### Método 2: Resposta Imediata (Mais Simples)

**Arquivo:** `backend/sendToWebhook.jsw`

```javascript
import { fetch } from 'wix-fetch';

/**
 * Envia inscrição para webhook e retorna URL de checkout
 */
export async function processarInscricao(dadosParticipante) {

  const WEBHOOK_URL = 'https://eustolia-manistic-understandably.ngrok-free.dev/webhook/sprinta';
  const WEBHOOK_SECRET = 'change-this-secret';

  try {
    // Formatar CSV
    const csv = `name;email;phone;cpf;bday;gender;shirt_size;team
${dadosParticipante.name};${dadosParticipante.email};${dadosParticipante.phone};${dadosParticipante.cpf};${dadosParticipante.bday};${dadosParticipante.gender};${dadosParticipante.shirtSize};${dadosParticipante.team}`;

    console.log('📤 Enviando para webhook...');

    // Enviar para webhook
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'X-Secret-Token': WEBHOOK_SECRET,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        csv_content: csv
      })
    });

    if (!response.ok) {
      throw new Error(`Webhook error: ${response.status}`);
    }

    const resultado = await response.json();

    console.log('📥 Resposta recebida:', resultado);

    // ⭐ EXTRAIR URL DE PAGAMENTO
    if (resultado.results && resultado.results.length > 0) {
      const primeiroResultado = resultado.results[0];

      return {
        success: primeiroResultado.success,
        checkoutUrl: primeiroResultado.checkout_url,
        email: primeiroResultado.email,
        discountApplied: primeiroResultado.discount_applied,
        message: primeiroResultado.success
          ? 'Inscrição processada com sucesso!'
          : 'Erro ao processar inscrição'
      };
    }

    throw new Error('Nenhum resultado retornado');

  } catch (error) {
    console.error('❌ Erro:', error);
    return {
      success: false,
      error: error.message,
      message: 'Erro ao processar. Tente novamente.'
    };
  }
}
```

**Arquivo:** Página do formulário (ex: `Inscricao.js`)

```javascript
import { processarInscricao } from 'backend/sendToWebhook';
import wixData from 'wix-data';
import wixLocation from 'wix-location';

$w.onReady(function () {

  $w("#submitButton").onClick(async () => {

    // Desabilitar botão durante processamento
    $w("#submitButton").disable();
    $w("#submitButton").label = "Processando...";
    $w("#loadingIcon").show(); // Se tiver um ícone de loading

    try {
      // 1. Coletar dados do formulário
      const dados = {
        name: $w("#nameInput").value,
        email: $w("#emailInput").value,
        phone: $w("#phoneInput").value,
        cpf: $w("#cpfInput").value,
        bday: formatarData($w("#bdayInput").value),
        gender: $w("#genderDropdown").value, // 'm' ou 'f'
        shirtSize: $w("#shirtSizeDropdown").value, // P, M, G, GG, XG
        team: $w("#teamInput").value || "Espaço Facial"
      };

      // 2. Salvar no banco de dados Wix (antes de processar)
      const saved = await wixData.insert("Participants", {
        ...dados,
        createdAt: new Date(),
        status: "processing"
      });

      console.log('💾 Salvo no Wix:', saved._id);

      // 3. Enviar para webhook e obter URL de checkout
      const resultado = await processarInscricao(dados);

      if (resultado.success) {
        // ✅ SUCESSO!

        // Atualizar status no banco de dados
        await wixData.update("Participants", {
          _id: saved._id,
          checkoutUrl: resultado.checkoutUrl,
          discountApplied: resultado.discountApplied,
          status: "checkout_ready",
          processedAt: new Date()
        });

        // Mostrar mensagem de sucesso
        $w("#successMessage").text = resultado.message;
        $w("#successMessage").show();

        // Opção A: Redirecionar direto para checkout
        setTimeout(() => {
          wixLocation.to(resultado.checkoutUrl);
        }, 2000);

        // Opção B: Mostrar link clicável
        // $w("#checkoutLink").link = resultado.checkoutUrl;
        // $w("#checkoutLink").show();

      } else {
        // ❌ ERRO
        $w("#errorMessage").text = resultado.message;
        $w("#errorMessage").show();
      }

    } catch (error) {
      console.error('Erro geral:', error);
      $w("#errorMessage").text = 'Erro ao processar inscrição. Tente novamente.';
      $w("#errorMessage").show();

    } finally {
      // Reabilitar botão
      $w("#submitButton").enable();
      $w("#submitButton").label = "Enviar Inscrição";
      $w("#loadingIcon").hide();
    }
  });

});

/**
 * Formata data para DD/MM/YYYY
 */
function formatarData(dateObj) {
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  return `${day}/${month}/${year}`;
}
```

---

## 🗄️ Estrutura do Banco de Dados Wix

**Collection:** `Participants`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `email` | Text | E-mail do participante (único) |
| `name` | Text | Nome completo |
| `phone` | Text | Telefone |
| `cpf` | Text | CPF |
| `bday` | Text | Data de nascimento (DD/MM/YYYY) |
| `gender` | Text | Gênero ('m' ou 'f') |
| `shirtSize` | Text | Tamanho de camiseta |
| `team` | Text | Nome da equipe |
| `checkoutUrl` | URL | **⭐ URL de pagamento** |
| `discountApplied` | Text | Cupom aplicado |
| `status` | Text | Status: 'processing', 'checkout_ready', 'processing_failed' |
| `createdAt` | DateTime | Data de criação |
| `processedAt` | DateTime | Data de processamento |

---

## 🔄 Fluxo Completo Simplificado

```
1. Usuário preenche formulário no Wix
   ↓
2. Wix salva no banco de dados (status: "processing")
   ↓
3. Wix envia para webhook → GitHub Actions → Automação
   ↓
4. Automação processa e aplica cupom
   ↓
5. Webhook retorna JSON com checkout_url
   ↓
6. Wix atualiza banco de dados (status: "checkout_ready")
   ↓
7. Wix redireciona usuário para checkout_url
   ou
   Wix envia e-mail com checkout_url
   ↓
8. Usuário clica e finaliza pagamento com desconto aplicado! 🎉
```

---

## 🎯 Exemplo de Uso no Console

```javascript
// JSON recebido do webhook
const data = {
  "results": [
    {
      "email": "teste@example.com",
      "checkout_url": "https://checkout.sprinta.com.br/abc123",
      "success": true,
      "discount_applied": "ESPACOFACIALNH10"
    }
  ]
};

// Como acessar a URL
const url = data.results[0].checkout_url;
console.log(url);
// "https://checkout.sprinta.com.br/abc123"

// Como acessar o e-mail
const email = data.results[0].email;
console.log(email);
// "teste@example.com"

// Como verificar se teve sucesso
const sucesso = data.results[0].success;
console.log(sucesso);
// true

// Como verificar o cupom aplicado
const cupom = data.results[0].discount_applied;
console.log(cupom);
// "ESPACOFACIALNH10"
```

---

## ✅ Resumo Ultra-Rápido

**Pergunta:** Como o Wix recebe a URL de pagamento?

**Resposta em 3 passos:**

1. **Wix envia dados** → Webhook
2. **Webhook processa** → Retorna JSON
3. **Wix acessa:** `data.results[0].checkout_url` ← **URL AQUI!**

**O que fazer com a URL:**
- ✅ Salvar no banco de dados Wix
- ✅ Enviar por e-mail para o usuário
- ✅ Redirecionar o usuário direto para checkout
- ✅ Exibir na tela

**A URL já vem com:**
- ✅ Inscrição completa
- ✅ Desconto ESPACOFACIALNH10 aplicado
- ✅ Pronta para pagamento

---

## 🔗 Links Úteis

- **Documentação Wix Velo:** https://www.wix.com/velo/reference/api-overview
- **Wix HTTP Functions:** https://www.wix.com/velo/reference/wix-http-functions
- **Wix Data API:** https://www.wix.com/velo/reference/wix-data
- **Repositório GitHub:** https://github.com/jubenitogarcia/Sprinta-Scraper

---

## 💡 Dica Final

**URL de exemplo real:**
```
https://checkout.sprinta.com.br/30560768ac8e7500fef/inscription/67890abcdef12345
```

Esta URL é:
- ✅ Única para cada participante
- ✅ Com desconto já aplicado
- ✅ Válida para finalizar o pagamento
- ✅ Pode ser usada imediatamente

**Pronto para usar no seu site Wix!** 🚀
