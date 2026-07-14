// Teste simples da API de envio de imagens
async function testAPI() {
    try {
        const response = await fetch('http://localhost:3001/status');
        const data = await response.json();

        console.log('Status da API:', data);

        if (!data.ready) {
            console.log('❌ Bot não está pronto');
            return;
        }

        // Teste de envio de imagem
        const imageTest = await fetch('http://localhost:3001/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                number: '5511999999999', // Substitua pelo seu número
                type: 'image',
                url: 'https://picsum.photos/400/300',
                message: '🖼️ Teste de imagem via API'
            })
        });

        const imageResult = await imageTest.json();
        console.log('Resultado do envio de imagem:', imageResult);

    } catch (error) {
        console.error('Erro no teste:', error);
    }
}

// Para usar no navegador, cole este código no console (F12)
testAPI();
