// Script para testar o MessageMedia.fromUrl
async function testMessageMedia() {
    try {
        console.log('🧪 Testando MessageMedia.fromUrl...');

        const response = await fetch('http://localhost:3001/test-media', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: 'https://picsum.photos/400/300'
            })
        });

        const result = await response.json();

        if (result.success) {
            console.log('✅ Teste bem-sucedido!');
            console.log('📊 Resultado:', result.media);
        } else {
            console.log('❌ Teste falhou:', result.error);
        }

    } catch (error) {
        console.error('❌ Erro na conexão:', error.message);
    }
}

// Aguardar um pouco e executar o teste
setTimeout(testMessageMedia, 2000);
