const axios = require('axios');

// Configuração da API
const API_BASE = 'http://localhost:3001';

class WhatsAppAPIClient {
    constructor(baseUrl = API_BASE) {
        this.baseUrl = baseUrl;
        this.axios = axios.create({
            baseURL: baseUrl,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    // Verificar status do bot
    async getStatus() {
        try {
            const response = await this.axios.get('/status');
            return response.data;
        } catch (error) {
            throw new Error(`Erro ao verificar status: ${error.message}`);
        }
    }

    // Obter QR Code
    async getQRCode() {
        try {
            const response = await this.axios.get('/qr');
            return response.data;
        } catch (error) {
            throw new Error(`Erro ao obter QR: ${error.message}`);
        }
    }

    // Enviar mensagem
    async sendMessage(number, message, type = 'text') {
        try {
            const response = await this.axios.post('/send', {
                number,
                message,
                type
            });
            return response.data;
        } catch (error) {
            throw new Error(`Erro ao enviar mensagem: ${error.message}`);
        }
    }

    // Enviar webhook
    async sendWebhook(target, message, data = null) {
        try {
            const response = await this.axios.post('/webhook', {
                target,
                message,
                data
            });
            return response.data;
        } catch (error) {
            throw new Error(`Erro ao enviar webhook: ${error.message}`);
        }
    }

    // Listar chats
    async getChats() {
        try {
            const response = await this.axios.get('/chats');
            return response.data;
        } catch (error) {
            throw new Error(`Erro ao listar chats: ${error.message}`);
        }
    }

    // Aguardar bot ficar pronto
    async waitForReady(maxAttempts = 30) {
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const status = await this.getStatus();
                if (status.status === 'ready') {
                    return true;
                }
                console.log(`Tentativa ${i + 1}/${maxAttempts}: Bot ainda não está pronto...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.log(`Tentativa ${i + 1}/${maxAttempts}: Erro de conexão...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        return false;
    }
}

// ========================================
// EXEMPLOS DE USO
// ========================================

async function exemploUso() {
    console.log('🔧 Testando API do WhatsApp Bot...\n');

    const api = new WhatsAppAPIClient();

    try {
        // 1. Verificar status
        console.log('1️⃣ Verificando status...');
        const status = await api.getStatus();
        console.log('Status:', status);

        if (status.status !== 'ready') {
            console.log('⏳ Bot não está pronto. Aguardando...');
            const ready = await api.waitForReady();
            if (!ready) {
                console.log('❌ Bot não ficou pronto em tempo hábil');
                return;
            }
        }

        console.log('✅ Bot está pronto!\n');

        // 2. Listar chats
        console.log('2️⃣ Listando chats...');
        const chats = await api.getChats();
        console.log(`Encontrados ${chats.count} chats`);
        if (chats.chats.length > 0) {
            console.log('Primeiros 3 chats:', chats.chats.slice(0, 3));
        }
        console.log();

        // 3. Enviar mensagem (substitua pelo número desejado)
        const numeroTeste = '5511999999999'; // ALTERE PARA UM NÚMERO REAL
        console.log('3️⃣ Enviando mensagem de teste...');

        // DESCOMENTE PARA TESTAR ENVIO REAL:
        /*
        const resultEnvio = await api.sendMessage(
            numeroTeste,
            '🤖 Mensagem de teste via API!\n\nEste bot está funcionando perfeitamente!'
        );
        console.log('Resultado envio:', resultEnvio);
        */
        console.log('⚠️ Envio de mensagem comentado para segurança');
        console.log('   Descomente as linhas acima para testar envio real\n');

        // 4. Exemplo de webhook
        console.log('4️⃣ Exemplo de webhook...');

        // DESCOMENTE PARA TESTAR WEBHOOK REAL:
        /*
        const resultWebhook = await api.sendWebhook(
            numeroTeste,
            '📊 Alerta de sistema via webhook!',
            {
                tipo: 'notificacao',
                prioridade: 'alta',
                timestamp: new Date().toISOString(),
                dados: {
                    cpu: '85%',
                    memoria: '70%',
                    disco: '45%'
                }
            }
        );
        console.log('Resultado webhook:', resultWebhook);
        */
        console.log('⚠️ Webhook comentado para segurança');
        console.log('   Descomente as linhas acima para testar webhook real\n');

        console.log('✅ Teste da API concluído com sucesso!');

    } catch (error) {
        console.error('❌ Erro durante teste:', error.message);
    }
}

// ========================================
// FUNÇÕES UTILITÁRIAS
// ========================================

// Monitorar status do bot
async function monitorarBot() {
    const api = new WhatsAppAPIClient();

    console.log('📊 Monitorando bot...\n');

    setInterval(async () => {
        try {
            const status = await api.getStatus();
            const timestamp = new Date().toLocaleTimeString('pt-BR');
            console.log(`[${timestamp}] Status: ${status.status} | Ready: ${status.status === 'ready' ? '✅' : '❌'}`);
        } catch (error) {
            const timestamp = new Date().toLocaleTimeString('pt-BR');
            console.log(`[${timestamp}] Erro: ${error.message}`);
        }
    }, 5000); // Verificar a cada 5 segundos
}

// Envio em lote
async function enviarEmLote(numeros, mensagem) {
    const api = new WhatsAppAPIClient();

    console.log(`📤 Enviando mensagem para ${numeros.length} números...`);

    const resultados = [];

    for (const numero of numeros) {
        try {
            const resultado = await api.sendMessage(numero, mensagem);
            resultados.push({ numero, sucesso: true, resultado });
            console.log(`✅ Enviado para ${numero}`);

            // Delay entre envios para evitar spam
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            resultados.push({ numero, sucesso: false, erro: error.message });
            console.log(`❌ Erro para ${numero}: ${error.message}`);
        }
    }

    return resultados;
}

// ========================================
// EXECUÇÃO PRINCIPAL
// ========================================

if (require.main === module) {
    const comando = process.argv[2];

    switch (comando) {
        case 'test':
            exemploUso();
            break;
        case 'monitor':
            monitorarBot();
            break;
        case 'send':
            const numero = process.argv[3];
            const mensagem = process.argv[4];
            if (numero && mensagem) {
                const api = new WhatsAppAPIClient();
                api.sendMessage(numero, mensagem)
                    .then(result => console.log('✅ Enviado:', result))
                    .catch(error => console.error('❌ Erro:', error.message));
            } else {
                console.log('❌ Use: node cliente_api.js send <numero> <mensagem>');
            }
            break;
        default:
            console.log('🔧 Cliente API WhatsApp Bot\n');
            console.log('Comandos disponíveis:');
            console.log('  node cliente_api.js test     - Testar todas as funções');
            console.log('  node cliente_api.js monitor  - Monitorar status do bot');
            console.log('  node cliente_api.js send <numero> <mensagem> - Enviar mensagem');
            console.log('\nExemplo:');
            console.log('  node cliente_api.js send 5511999999999 "Olá via API!"');
    }
}

module.exports = { WhatsAppAPIClient, enviarEmLote };
