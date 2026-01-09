// Exemplo completo de uso da API WhatsApp

const axios = require('axios');

class WhatsAppAPI {
    constructor(baseUrl = 'http://localhost:3001') {
        this.baseUrl = baseUrl;
    }

    // Verificar status
    async status() {
        const response = await axios.get(`${this.baseUrl}/status`);
        return response.data;
    }

    // Enviar mensagem
    async send(number, message) {
        const response = await axios.post(`${this.baseUrl}/send`, {
            number: number,
            message: message
        });
        return response.data;
    }

    // Listar chats
    async chats() {
        const response = await axios.get(`${this.baseUrl}/chats`);
        return response.data;
    }

    // Aguardar bot ficar pronto
    async waitReady(maxTries = 30) {
        for (let i = 0; i < maxTries; i++) {
            try {
                const status = await this.status();
                if (status.status === 'ready') return true;
                console.log(`Tentativa ${i + 1}/${maxTries}: Bot ainda não está pronto...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.log(`Tentativa ${i + 1}/${maxTries}: Erro de conexão...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        return false;
    }
}

// Exemplo de uso
async function exemploCompleto() {
    const api = new WhatsAppAPI();

    console.log('🤖 Exemplo de uso da API WhatsApp');
    console.log('================================\n');

    try {
        // 1. Verificar se está pronto
        console.log('1️⃣ Verificando status...');
        const ready = await api.waitReady();

        if (!ready) {
            console.log('❌ Bot não ficou pronto em tempo hábil');
            console.log('💡 Verifique se o bot_com_api.js está rodando e autenticado');
            return;
        }

        console.log('✅ Bot está pronto!\n');

        // 2. Enviar mensagem
        console.log('2️⃣ Enviando mensagem...');
        const result = await api.send('5551995103563', 'teste');

        if (result.success) {
            console.log('✅ Mensagem enviada!');
            console.log(`📤 Para: ${result.to}`);
            console.log(`💬 Conteúdo: ${result.content}\n`);
        } else {
            console.log('❌ Falha ao enviar:', result.message);
        }

        // 3. Listar chats
        console.log('3️⃣ Listando chats...');
        const chats = await api.chats();
        console.log(`📱 Encontrados ${chats.count} chats`);

        // Mostrar alguns chats
        if (chats.chats.length > 0) {
            console.log('Últimos 3 chats:');
            chats.chats.slice(0, 3).forEach((chat, i) => {
                console.log(`${i + 1}. ${chat.name} (${chat.isGroup ? 'Grupo' : 'Individual'})`);
            });
        }

    } catch (error) {
        console.error('❌ Erro:', error.message);
    }
}

// Executar se for chamado diretamente
if (require.main === module) {
    exemploCompleto();
}

module.exports = WhatsAppAPI;
