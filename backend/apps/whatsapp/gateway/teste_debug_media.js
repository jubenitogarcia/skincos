const { MessageMedia } = require('whatsapp-web.js');

async function testeMessageMedia() {
    try {
        console.log('Testando MessageMedia.fromUrl...');

        // URL de teste simples
        const url = 'https://via.placeholder.com/350x150.png';

        console.log('Fazendo download da imagem de:', url);
        const media = await MessageMedia.fromUrl(url);

        console.log('Media criado com sucesso:');
        console.log('- Mimetype:', media.mimetype);
        console.log('- Filename:', media.filename);
        console.log('- Data length:', media.data ? media.data.length : 'null');
        console.log('- Filesize:', media.filesize);

        // Verificar se tem dados válidos
        if (media.data && media.data.length > 0) {
            console.log('✅ MessageMedia criado com dados válidos');
        } else {
            console.log('❌ MessageMedia criado mas sem dados');
        }

    } catch (error) {
        console.error('❌ Erro ao criar MessageMedia:', error);
    }
}

testeMessageMedia();
