const express = require('express');
const cors = require('cors');
const { MessageMedia } = require('./index');

// Configuração do servidor Express
const app = express();
const PORT = 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Teste direto do MessageMedia
app.post('/test-media', async (req, res) => {
    try {
        console.log('🧪 Iniciando teste do MessageMedia.fromUrl');

        const { url } = req.body;
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL é obrigatória'
            });
        }

        console.log('📥 URL recebida:', url);

        // Testar MessageMedia.fromUrl
        const media = await MessageMedia.fromUrl(url);

        console.log('✅ MessageMedia criado com sucesso!');
        console.log('📄 MIME type:', media.mimetype);
        console.log('📂 Filename:', media.filename);
        console.log('📊 Data length:', media.data ? media.data.length : 'null');
        console.log('📏 Filesize:', media.filesize);

        res.json({
            success: true,
            media: {
                mimetype: media.mimetype,
                filename: media.filename,
                hasData: !!media.data,
                dataLength: media.data ? media.data.length : 0,
                filesize: media.filesize
            }
        });

    } catch (error) {
        console.error('❌ Erro no teste do MessageMedia:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Status da API
app.get('/status', (req, res) => {
    res.json({
        ready: true,
        message: 'API de teste do MessageMedia funcionando'
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 API de teste rodando na porta ${PORT}`);
    console.log(`📡 Teste: POST http://localhost:${PORT}/test-media`);
    console.log('📋 Corpo: { "url": "https://picsum.photos/400/300" }');
});
