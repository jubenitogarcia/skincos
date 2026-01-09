const axios = require('axios');

// Configuração
const API_BASE = 'http://localhost:3001';
const NUMERO = '5551995103563';
const MENSAGEM = 'teste';

async function enviarMensagem() {
    try {
        console.log('📱 Enviando mensagem via API WhatsApp...');
        console.log(`📞 Para: +${NUMERO}`);
        console.log(`💬 Mensagem: "${MENSAGEM}"`);
        console.log('');

        // 1. Verificar status do bot
        console.log('🔍 Verificando status do bot...');
        const statusResponse = await axios.get(`${API_BASE}/status`);
        const status = statusResponse.data;

        console.log(`Status: ${status.status}`);
        console.log(`Mensagem: ${status.message}`);

        if (status.status !== 'ready') {
            console.log('❌ Bot não está pronto!');
            console.log('💡 Certifique-se de que:');
            console.log('   1. O bot_com_api.js está rodando');
            console.log('   2. O QR Code foi escaneado');
            console.log('   3. O WhatsApp está conectado');
            return;
        }

        console.log('✅ Bot está pronto! Enviando mensagem...');
        console.log('');

        // 2. Enviar mensagem
        const sendResponse = await axios.post(`${API_BASE}/send`, {
            number: NUMERO,
            message: MENSAGEM
        });

        const result = sendResponse.data;

        if (result.success) {
            console.log('🎉 Mensagem enviada com sucesso!');
            console.log(`📤 Para: ${result.to}`);
            console.log(`💬 Conteúdo: ${result.content}`);
            console.log(`🕐 Timestamp: ${result.timestamp}`);
        } else {
            console.log('❌ Erro ao enviar mensagem:', result.message);
        }

    } catch (error) {
        console.error('❌ Erro na comunicação com a API:');

        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error(`Mensagem: ${error.response.data.message || error.response.data}`);
        } else if (error.request) {
            console.error('Erro de conexão. Verifique se o bot está rodando em http://localhost:3001');
        } else {
            console.error(error.message);
        }

        console.log('');
        console.log('💡 Soluções:');
        console.log('   1. Verifique se o bot_com_api.js está rodando');
        console.log('   2. Aguarde o bot ficar "ready" após escanear o QR');
        console.log('   3. Teste o status: curl http://localhost:3001/status');
    }
}

// Executar
enviarMensagem();
