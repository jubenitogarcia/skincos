// Função auxiliar para baixar imagem e criar MessageMedia
const axios = require('axios');
const { MessageMedia } = require('./index');
const VideoOptimizer = require('./video_optimizer');

async function createMediaFromUrl(url) {
    try {
        console.log('🔄 Baixando mídia via axios:', url);

        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent': 'WhatsApp Bot/1.0'
            },
            validateStatus: function (status) {
                return status >= 200 && status < 300;
            }
        });

        console.log('📊 Response status:', response.status);
        console.log('📄 Content-Type:', response.headers['content-type']);
        console.log('📏 Content-Length:', response.headers['content-length']);

        // Validar se é realmente mídia
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
            throw new Error(`URL retornou HTML em vez de mídia. Content-Type: ${contentType}`);
        }

        const buffer = Buffer.from(response.data);
        const base64Data = buffer.toString('base64');

        const mimetype = response.headers['content-type'] || 'application/octet-stream';
        const filename = url.split('/').pop().split('?')[0] || 'media';
        const filesize = buffer.length;

        console.log('✅ Mídia processada:');
        console.log('- MIME type:', mimetype);
        console.log('- Filename:', filename);
        console.log('- Tamanho:', filesize);
        console.log('- Base64 length:', base64Data.length);

        return new MessageMedia(mimetype, base64Data, filename, filesize);

    } catch (error) {
        console.error('❌ Erro ao baixar mídia via axios:', error.message);
        throw error;
    }
}

// Função para validar URL antes de baixar
async function validateMediaUrl(url) {
    try {
        console.log('🔍 Validando URL:', url);

        const response = await axios.head(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'WhatsApp Bot/1.0'
            }
        });

        const contentType = response.headers['content-type'] || '';
        const contentLength = response.headers['content-length'];

        console.log('📋 Validação da URL:');
        console.log('- Status:', response.status);
        console.log('- Content-Type:', contentType);
        console.log('- Content-Length:', contentLength);

        // Verificar se é HTML (página de erro)
        if (contentType.includes('text/html')) {
            throw new Error(`URL retorna HTML, não mídia. Content-Type: ${contentType}`);
        }

        // Verificar se o arquivo é muito grande (>25MB para vídeo, >5MB para outros)
        // WhatsApp Web tem limitações com arquivos muito grandes
        if (contentLength) {
            const sizeMB = parseInt(contentLength) / 1024 / 1024;
            const isVideo = url.toLowerCase().includes('.mp4') || url.toLowerCase().includes('video') || contentType.includes('video');
            const maxSize = isVideo ? 25 : 5;

            if (sizeMB > maxSize) {
                if (isVideo && sizeMB > 25) {
                    console.log(`🎬 Vídeo grande detectado: ${Math.round(sizeMB)}MB - será otimizado automaticamente`);
                    return { needsOptimization: true, sizeMB, isVideo: true };
                } else {
                    throw new Error(`Arquivo muito grande: ${Math.round(sizeMB)}MB (máx: ${maxSize}MB para estabilidade)`);
                }
            }

            if (sizeMB > 15) {
                console.log(`⚠️ Arquivo grande detectado: ${Math.round(sizeMB)}MB - pode demorar mais para processar`);
            } else {
                console.log(`📏 Tamanho do arquivo: ${Math.round(sizeMB)}MB`);
            }
        } return true;

    } catch (error) {
        console.error('❌ Validação falhou:', error.message);
        throw error;
    }
}

module.exports = { createMediaFromUrl, validateMediaUrl };
