// Teste final da funcionalidade de imagem
async function testFinalImage() {
    try {
        console.log('🧪 Teste Final - Envio de Imagem via API');
        console.log('='.repeat(50));

        // Verificar status da API
        console.log('1️⃣ Verificando status da API...');
        const statusResponse = await fetch('http://localhost:3001/status');
        const statusData = await statusResponse.json();

        console.log('📊 Status:', statusData);

        if (!statusData.ready) {
            console.log('❌ Bot não está pronto, aguarde...');
            return;
        }

        console.log('✅ Bot está pronto!');

        // Testar envio de imagem
        console.log('\n2️⃣ Testando envio de imagem...');

        const testCases = [
            {
                name: 'Picsum (JPEG)',
                url: 'https://picsum.photos/400/300',
                number: '5511999999999' // Substitua pelo seu número
            },
            {
                name: 'Placeholder (PNG)',
                url: 'https://via.placeholder.com/350x150.png',
                number: '5511999999999' // Substitua pelo seu número
            }
        ];

        for (const testCase of testCases) {
            console.log(`\n🧪 Testando: ${testCase.name}`);
            console.log(`📥 URL: ${testCase.url}`);

            const imageResponse = await fetch('http://localhost:3001/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    number: testCase.number,
                    type: 'image',
                    url: testCase.url,
                    message: `🖼️ Teste de imagem: ${testCase.name}`
                })
            });

            const imageResult = await imageResponse.json();

            if (imageResult.success) {
                console.log('✅ Sucesso:', imageResult.message);
                console.log('📋 ID da mensagem:', imageResult.messageId);
            } else {
                console.log('❌ Falha:', imageResult.message);
            }

            // Aguardar um pouco entre os testes
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log('\n🎉 Teste finalizado!');

    } catch (error) {
        console.error('❌ Erro no teste:', error.message);
    }
}

// Aguardar um pouco e executar
console.log('⏳ Aguardando API inicializar...');
setTimeout(testFinalImage, 5000);
