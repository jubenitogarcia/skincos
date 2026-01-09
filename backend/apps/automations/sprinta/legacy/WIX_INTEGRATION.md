# 🌐 Integração Wix → Webhook Sprinta

Guia completo para enviar dados do formulário Wix diretamente para o webhook.

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Setup do Webhook Local](#setup-local)
3. [Expor Webhook Publicamente](#expor-webhook)
4. [Código Wix (Velo)](#código-wix)
5. [Alternativa: Wix Automations](#alternativa-automations)

---

## 🎯 Visão Geral

### Fluxo Completo

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  1. Usuário preenche formulário no site Wix                    │
│                                                                 │
│  2. Wix coleta dados e gera CSV                                 │
│                                                                 │
│  3. Wix envia CSV via HTTP POST para webhook                    │
│     URL: https://seu-dominio.com/webhook/sprinta               │
│     Header: X-Secret-Token: seu-secret                          │
│                                                                 │
│  4. Webhook Server recebe e valida                              │
│     • Verifica secret token                                    │
│     • Processa CSV                                             │
│                                                                 │
│  5. Webhook aciona GitHub Actions                               │
│     • Via API: repository_dispatch                             │
│                                                                 │
│  6. GitHub Actions processa inscrições                          │
│     • Preenche formulários Sprinta                             │
│     • Gera URLs de checkout                                    │
│                                                                 │
│  7. Resultado retorna para Wix (via callback)                   │
│     • Wix salva URLs no banco de dados                         │
│     • Wix envia e-mails com links                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🏠 Setup Local

### Passo 1: Configurar Webhook Server

```bash
# Adicionar secret ao .env (se ainda não fez)
echo "WEBHOOK_SECRET=seu-secret-super-secreto-aqui-12345" >> .env

# Iniciar servidor (porta 5001)
python webhook_server.py
```

✅ Servidor rodando em: `http://localhost:5001`

**Nota:** Porta 5001 é usada para evitar conflito com AirPlay Receiver no macOS.

---

## 🌍 Expor Webhook Publicamente

Para que o Wix consiga enviar dados, você precisa de uma URL pública (HTTPS).

### Opção 1: Ngrok (Teste Rápido - GRÁTIS)

**Mais simples para testar!**

```bash
# 1. Instalar ngrok
brew install ngrok

# 2. Criar conta grátis em https://ngrok.com/
# 3. Configurar token (comando fornecido no dashboard)
ngrok config add-authtoken SEU_TOKEN_AQUI

# 4. Expor porta 5001
ngrok http 5001
```

Resultado:
```
Forwarding  https://abc123.ngrok.io -> http://localhost:5001
```

✅ Use esta URL no Wix: `https://abc123.ngrok.io/webhook/sprinta`

**⚠️ Limitações do plano grátis:**
- URL muda cada vez que reinicia ngrok
- Expira após 8 horas
- Perfeito para testes!

### Opção 2: Heroku (Produção - GRÁTIS*)

**Para deixar 24/7 online:**

```bash
# 1. Criar conta em https://heroku.com
# 2. Instalar Heroku CLI
brew tap heroku/brew && brew install heroku

# 3. Login
heroku login

# 4. Criar app
heroku create sprinta-webhook-seu-nome

# 5. Configurar variáveis de ambiente
heroku config:set GITHUB_TOKEN=ghp_seu_token_aqui
heroku config:set WEBHOOK_SECRET=seu-secret-super-secreto
heroku config:set GITHUB_REPO_OWNER=jubenitogarcia
heroku config:set GITHUB_REPO_NAME=Sprinta-Scraper

# 6. Criar Procfile
echo "web: gunicorn webhook_server:app" > Procfile

# 7. Adicionar gunicorn ao requirements.txt
echo "gunicorn>=21.2.0" >> requirements.txt

# 8. Deploy
git add .
git commit -m "Deploy webhook to Heroku"
git push heroku main
```

✅ URL permanente: `https://sprinta-webhook-seu-nome.herokuapp.com/webhook/sprinta`

*Plano Eco: $5/mês para 1000 horas

### Opção 3: Servidor Próprio (VPS)

Se você tem servidor próprio (DigitalOcean, AWS, etc):

```bash
# No servidor
cd /var/www
git clone https://github.com/jubenitogarcia/Sprinta-Scraper.git
cd Sprinta-Scraper

# Configurar .env
nano .env
# Adicionar: GITHUB_TOKEN, WEBHOOK_SECRET, etc.

# Instalar dependências
pip install -r requirements.txt
pip install gunicorn

# Rodar com gunicorn
gunicorn webhook_server:app --bind 0.0.0.0:5001 --daemon

# Configurar Nginx como proxy reverso
# Obter certificado SSL com Let's Encrypt
```

---

## 💻 Código Wix (Velo)

### Setup no Wix

1. **Ativar Velo (Dev Mode):**
   - Abra o editor do Wix
   - Clique em "Dev Mode" no menu superior
   - Ative o Velo

2. **Adicionar código ao formulário:**

### Código: Backend (backend/sendToWebhook.jsw)

```javascript
// backend/sendToWebhook.jsw
import { fetch } from 'wix-fetch';

// IMPORTANTE: Configure estas constantes
const WEBHOOK_URL = 'https://seu-dominio.ngrok.io/webhook/sprinta';
const WEBHOOK_SECRET = 'seu-secret-super-secreto-aqui-12345';

/**
 * Envia dados do formulário para o webhook Sprinta
 * @param {Array} participants - Array com dados dos participantes
 * @returns {Promise} Resposta do webhook
 */
export async function sendToSprintaWebhook(participants) {
  try {
    // Converter array de participantes para formato CSV
    const csvHeader = 'name;email;phone;cpf;bday;gender;shirt_size;team';
    const csvRows = participants.map(p =>
      `${p.name};${p.email};${p.phone};${p.cpf};${p.bday};${p.gender};${p.shirtSize};${p.team}`
    );
    const csvContent = [csvHeader, ...csvRows].join('\n');

    console.log('📤 Enviando para webhook...', {
      participants: participants.length,
      url: WEBHOOK_URL
    });

    // Enviar POST para webhook
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Secret-Token': WEBHOOK_SECRET,
        // Opcional: URL para receber resultado de volta
        // 'X-Callback-URL': 'https://seu-site.wix.com/_functions/receiveResults'
      },
      body: JSON.stringify({
        csv_content: csvContent
      })
    });

    const result = await response.json();

    if (response.status === 202) {
      console.log('✅ Webhook acionado com sucesso!', result);
      return {
        success: true,
        data: result
      };
    } else {
      console.error('❌ Erro no webhook:', result);
      return {
        success: false,
        error: result
      };
    }

  } catch (error) {
    console.error('❌ Erro ao enviar para webhook:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
```

### Código: Frontend (página do formulário)

```javascript
// Na página do formulário (ex: Inscrição.js)
import { sendToSprintaWebhook } from 'backend/sendToWebhook';
import wixData from 'wix-data';

$w.onReady(function () {

  // Quando o formulário for submetido
  $w("#submitButton").onClick(async () => {

    // 1. Desabilitar botão durante processamento
    $w("#submitButton").disable();
    $w("#submitButton").label = "Processando...";

    try {
      // 2. Coletar dados do formulário
      const participant = {
        name: $w("#nameInput").value,
        email: $w("#emailInput").value,
        phone: $w("#phoneInput").value,
        cpf: $w("#cpfInput").value,
        bday: formatDate($w("#bdayInput").value), // DD/MM/YYYY
        gender: $w("#genderDropdown").value, // 'm' ou 'f'
        shirtSize: $w("#shirtSizeDropdown").value, // P, M, G, GG, XG
        team: $w("#teamInput").value || "Sem Equipe"
      };

      // 3. Salvar no banco de dados Wix
      const saved = await wixData.insert("Participants", participant);
      console.log('✅ Salvo no Wix:', saved._id);

      // 4. Enviar para webhook Sprinta
      const webhookResult = await sendToSprintaWebhook([participant]);

      if (webhookResult.success) {
        // Sucesso!
        $w("#successMessage").show();
        $w("#successMessage").text =
          `✅ Inscrição enviada! Tempo estimado: ${webhookResult.data.estimated_time_seconds}s`;

        // Opcional: Redirecionar para página de sucesso
        // wixLocation.to('/obrigado');

      } else {
        // Erro no webhook
        $w("#errorMessage").show();
        $w("#errorMessage").text =
          `⚠️ Inscrição salva, mas houve um problema ao processar. Contate o suporte.`;
      }

    } catch (error) {
      console.error('Erro:', error);
      $w("#errorMessage").show();
      $w("#errorMessage").text = '❌ Erro ao enviar inscrição. Tente novamente.';
    } finally {
      // Reabilitar botão
      $w("#submitButton").enable();
      $w("#submitButton").label = "Enviar Inscrição";
    }
  });

});

// Helper: Formatar data para DD/MM/YYYY
function formatDate(dateObj) {
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  return `${day}/${month}/${year}`;
}
```

### Código: Receber Resultado (Callback)

Se quiser receber as URLs de checkout de volta no Wix:

```javascript
// backend/http-functions.js
import { ok, badRequest } from 'wix-http-functions';
import wixData from 'wix-data';

export async function post_receiveResults(request) {
  try {
    const payload = await request.body.json();

    console.log('📥 Resultado recebido do GitHub Actions:', payload);

    // Atualizar banco de dados com URLs de checkout
    if (payload.results && payload.results.length > 0) {
      for (const result of payload.results) {
        // Encontrar participante pelo email
        const queryResult = await wixData.query("Participants")
          .eq("email", result.email)
          .find();

        if (queryResult.items.length > 0) {
          const participant = queryResult.items[0];

          // Atualizar com URL de checkout
          await wixData.update("Participants", {
            _id: participant._id,
            checkoutUrl: result.checkout_url,
            processedAt: new Date()
          });

          console.log(`✅ Atualizado: ${result.email} -> ${result.checkout_url}`);
        }
      }
    }

    return ok({ received: true });

  } catch (error) {
    console.error('Erro ao receber resultado:', error);
    return badRequest({ error: error.message });
  }
}
```

---

## 🤖 Alternativa: Wix Automations (Sem Código)

Se você não quer programar, pode usar Wix Automations:

### Setup:

1. **Ir para Automations:**
   - Dashboard Wix → Settings → Automations

2. **Criar Automation:**
   - Trigger: "Form Submission"
   - Action: "Send HTTP Request"

3. **Configurar HTTP Request:**
   ```
   URL: https://seu-dominio.ngrok.io/webhook/sprinta
   Method: POST
   Headers:
     X-Secret-Token: seu-secret
   Body:
     {
       "csv_content": "name;email;phone;cpf;bday;gender;shirt_size;team\n{{name}};{{email}};{{phone}};{{cpf}};{{bday}};{{gender}};{{shirtSize}};{{team}}"
     }
   ```

**⚠️ Limitação:** Wix Automations só envia 1 participante por vez. Para múltiplos participantes, use código Velo.

---

## ✅ Checklist Final

Antes de ir para produção:

- [ ] Webhook server rodando e acessível via HTTPS
- [ ] WEBHOOK_SECRET configurado e seguro (mínimo 20 caracteres)
- [ ] GITHUB_TOKEN configurado no servidor
- [ ] GitHub Secrets configurados (SPRINTA_EMAIL, SPRINTA_PASSWORD)
- [ ] Código Wix atualizado com URL e secret corretos
- [ ] Testado com 1 participante
- [ ] Testado com múltiplos participantes
- [ ] Callback implementado (se necessário)
- [ ] Logs monitorados
- [ ] Backup do banco de dados Wix configurado

---

## 🐛 Troubleshooting

### Erro: "Secret token inválido"

**Causa:** WEBHOOK_SECRET no Wix diferente do servidor

**Solução:**
```bash
# No servidor, verificar .env:
cat .env | grep WEBHOOK_SECRET

# No Wix, verificar:
// backend/sendToWebhook.jsw
const WEBHOOK_SECRET = 'deve-ser-identico';
```

### Erro: "CORS blocked"

**Causa:** Navegador bloqueando requisição cross-origin

**Solução:** Requisição deve ser feita do backend Wix (não do frontend browser)

### Erro: "Connection refused"

**Causa:** Webhook server não está rodando ou URL incorreta

**Solução:**
```bash
# Verificar se servidor está rodando:
curl http://localhost:5001/health

# Se não estiver, iniciar:
python webhook_server.py
```

### Erro: "GitHub Action não foi acionada"

**Causa:** GITHUB_TOKEN inválido ou sem permissões

**Solução:**
1. Gerar novo token: https://github.com/settings/tokens
2. Permissões necessárias: `repo`, `workflow`
3. Atualizar .env

---

## 📞 Suporte

Dúvidas? Abra uma issue no GitHub ou envie e-mail para suporte.

---

## 🎉 Pronto!

Agora você tem integração completa:
✅ Wix → Webhook → GitHub Actions → Sprinta → URLs de Checkout

**Tempo total de processamento:** ~8 segundos por participante
