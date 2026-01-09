// Teste direto do MessageMedia sem servidor
const { MessageMedia } = require('./index');

async function testeSimples() {
    try {
        console.log('🧪 Iniciando teste direto do MessageMedia.fromUrl');

        const url = 'https://picsum.photos/400/300';
        console.log('📥 Testando URL:', url);

        const media = await MessageMedia.fromUrl(url);

        console.log('✅ MessageMedia criado!');
        console.log('📄 MIME type:', media.mimetype);
        console.log('📂 Filename:', media.filename);
        console.log('📊 Tem dados?', !!media.data);
        console.log('📏 Tamanho dos dados:', media.data ? media.data.length : 0);
        console.log('📐 Filesize:', media.filesize);

        if (media.data && media.data.length > 0) {
            console.log('🎉 SUCCESS: MessageMedia criado com dados válidos!');
        } else {
            console.log('⚠️ WARNING: MessageMedia criado mas sem dados!');
        }

    } catch (error) {
        console.error('❌ ERRO:', error.message);
        console.error('📋 Stack:', error.stack);
    }
}

testeSimples();
