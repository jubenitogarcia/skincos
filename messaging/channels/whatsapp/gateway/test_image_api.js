// Teste da API de Envio de Imagens
const axios = require('axios');

async function testImageAPI() {
    const API_URL = 'http://localhost:3001';

    console.log('🔍 Testando API de Envio de Imagens...\n');

    try {
        // 1. Verificar status
        console.log('1️⃣ Verificando status da API...');
        const statusResponse = await axios.get(`${API_URL}/status`);
        console.log('   Status:', statusResponse.data);

        if (!statusResponse.data.ready) {
            console.log('❌ Bot não está pronto. Escaneie o QR Code primeiro.');
            return;
        }

        // 2. Teste de envio de texto
        console.log('\n2️⃣ Testando envio de texto...');
        const textResponse = await axios.post(`${API_URL}/send`, {
            number: '5511999999999', // Substitua pelo seu número
            message: '🧪 Teste da API - Mensagem de texto',
            type: 'text'
        });
        console.log('   Resposta:', textResponse.data);

        // 3. Teste de envio de imagem
        console.log('\n3️⃣ Testando envio de imagem...');
        const imageResponse = await axios.post(`${API_URL}/send`, {
            number: '5511999999999', // Substitua pelo seu número
            type: 'image',
            url: 'https://picsum.photos/400/300',
            message: '🖼️ Imagem de teste enviada via API'
        });
        console.log('   Resposta:', imageResponse.data);

        // 4. Teste de envio de vídeo
        console.log('\n4️⃣ Testando envio de vídeo...');
        const videoResponse = await axios.post(`${API_URL}/send`, {
            number: '5511999999999', // Substitua pelo seu número
            type: 'video',
            url: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4',
            message: '🎥 Vídeo de teste enviado via API'
        });
        console.log('   Resposta:', videoResponse.data);

        // 5. Teste de localização
        console.log('\n5️⃣ Testando envio de localização...');
        const locationResponse = await axios.post(`${API_URL}/send`, {
            number: '5511999999999', // Substitua pelo seu número
            type: 'location',
            latitude: '-23.5505',
            longitude: '-46.6333',
            location_name: 'São Paulo',
            location_address: 'São Paulo, SP, Brasil'
        });
        console.log('   Resposta:', locationResponse.data);

        console.log('\n✅ Todos os testes foram executados!');

    } catch (error) {
        console.error('❌ Erro no teste:', error.response?.data || error.message);
    }
}

// Executar testes se chamado diretamente
if (require.main === module) {
    testImageAPI();
}

module.exports = { testImageAPI };
