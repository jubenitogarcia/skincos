const { MessageMedia, Location } = require('../../whatsapp-official');
const axios = require('axios');
const MediaConverter = require('./media-converter');

class MediaHandler {
    constructor(client) {
        this.client = client;
        this.converter = new MediaConverter();
        this.maxRetries = 2; // Máximo de tentativas em caso de crash
    }

    // Função auxiliar para retry com detecção de crash
    async executeWithRetry(operation, operationName, retryCount = 0) {
        try {
            return await operation();
        } catch (error) {
            const isBrowserCrash = error.message.includes('Target closed') || 
                                 error.message.includes('Protocol error') || 
                                 error.message.includes('Session closed') ||
                                 error.message.includes('Browser has been closed');
            
            if (isBrowserCrash && retryCount < this.maxRetries) {
                console.warn(`🔄 ${operationName} falhou por crash do browser. Tentando novamente (${retryCount + 1}/${this.maxRetries})...`);
                
                // Aguardar um pouco para o cliente se recuperar
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // Verificar se cliente está pronto antes de tentar novamente
                let waitTime = 0;
                while (this.client.info === null && waitTime < 30000) {
                    console.log('⏳ Aguardando cliente se recuperar...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    waitTime += 2000;
                }
                
                if (this.client.info === null) {
                    throw new Error('Cliente não se recuperou após crash. Tente novamente em alguns minutos.');
                }
                
                // Tentar novamente
                return await this.executeWithRetry(operation, operationName, retryCount + 1);
            } else {
                // Se não é crash do browser ou esgotou tentativas, relançar erro original
                throw error;
            }
        }
    }

    // Extrair filename da URL e detectar formato
    extractFilenameFromUrl(url, mimetype) {
        try {
            const urlObj = new URL(url);
            let filename = urlObj.pathname.split('/').pop();
            
            // Se não tem extensão, inferir do mimetype
            if (!filename || !filename.includes('.')) {
                const extension = this.getExtensionFromMimetype(mimetype);
                filename = `media_${Date.now()}.${extension}`;
            }
            
            // Garantir que tem extensão válida
            if (!filename.includes('.')) {
                const extension = this.getExtensionFromMimetype(mimetype);
                filename += `.${extension}`;
            }
            
            return filename;
        } catch (error) {
            // Fallback: gerar nome baseado no mimetype
            const extension = this.getExtensionFromMimetype(mimetype);
            return `media_${Date.now()}.${extension}`;
        }
    }

    // Mapear mimetype para extensão
    getExtensionFromMimetype(mimetype) {
        const mimeMap = {
            'video/mp4': 'mp4',
            'video/webm': 'webm',
            'video/quicktime': 'mov',
            'video/x-msvideo': 'avi',
            'video/avi': 'avi',
            'audio/wav': 'wav',
            'audio/mpeg': 'mp3',
            'audio/ogg': 'ogg',
            'audio/x-wav': 'wav',
            'image/jpeg': 'jpg',
            'image/png': 'png'
        };
        
        return mimeMap[mimetype] || mimetype.split('/')[1] || 'mp4';
    }

    // Validação de segurança para URLs
    validateUrl(url) {
        try {
            const parsedUrl = new URL(url);
            
            // Só aceita HTTP/HTTPS
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                throw new Error('Only HTTP/HTTPS URLs are allowed');
            }
            
            // Bloqueia IPs privados básicos
            const hostname = parsedUrl.hostname.toLowerCase();
            if (hostname === 'localhost' || 
                hostname.startsWith('127.') || 
                hostname.startsWith('192.168.') || 
                hostname.startsWith('10.') ||
                hostname.startsWith('172.')) {
                throw new Error('Private IP addresses are not allowed');
            }
            
            return true;
        } catch (error) {
            throw new Error(`Invalid URL: ${error.message}`);
        }
    }

    async sendImage(number, imageUrl, caption = '') {
        return await this.executeWithRetry(async () => {
            return await this._sendImageInternal(number, imageUrl, caption);
        }, 'Envio de imagem');
    }

    async _sendImageInternal(number, imageUrl, caption = '') {
        try {
            this.validateUrl(imageUrl);
            const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
            const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
            
            const result = await this.client.sendMessage(chatId, media, {
                caption: caption
            });
            
            return {
                success: true,
                messageId: result.id._serialized,
                type: 'image'
            };
        } catch (error) {
            throw error;
        }
    }

    async sendVideo(number, videoUrl, caption = '') {
        return await this.executeWithRetry(async () => {
            return await this._sendVideoInternal(number, videoUrl, caption);
        }, 'Envio de vídeo');
    }

    async _sendVideoInternal(number, videoUrl, caption = '') {
        try {
            this.validateUrl(videoUrl);
            const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
            
            console.log(`🎬 Iniciando envio de vídeo com otimização automática: ${videoUrl}`);
            
            // 1. VERIFICAR TAMANHO ANTES DO DOWNLOAD (HEAD request para economizar largura de banda)
            try {
                const headResponse = await axios.head(videoUrl, { timeout: 30000 });
                const contentLength = parseInt(headResponse.headers['content-length'] || '0');
                const estimatedSizeMB = contentLength / (1024 * 1024);
                
                if (contentLength > 0 && estimatedSizeMB > 200) {
                    throw new Error(`Vídeo muito grande para download: ${estimatedSizeMB.toFixed(2)}MB. Limite máximo: 200MB.`);
                }
                
                console.log(`📊 Tamanho estimado: ${estimatedSizeMB.toFixed(2)}MB - prosseguindo com download...`);
            } catch (headError) {
                console.warn(`⚠️ Não foi possível verificar tamanho: ${headError.message}. Prosseguindo com download...`);
            }
            
            // 2. BAIXAR ARQUIVO ORIGINAL (com timeout estendido para vídeos grandes)
            const response = await axios.get(videoUrl, { 
                responseType: 'arraybuffer',
                timeout: 180000, // 3 minutos para download de vídeos grandes
                maxContentLength: 210 * 1024 * 1024 // Limite de 210MB
            });
            const originalBuffer = Buffer.from(response.data);
            const originalMimetype = response.headers['content-type'] || 'video/mp4';
            const originalSizeMB = originalBuffer.length / (1024 * 1024);
            
            console.log(`📥 Vídeo baixado: ${originalSizeMB.toFixed(2)}MB, tipo: ${originalMimetype}`);
            
            // 3. ANALISAR SE PRECISA CONVERSÃO/COMPRESSÃO
            const analysis = await this.converter.analyzeMedia(originalBuffer, originalMimetype, videoUrl);
            
            let finalBuffer = originalBuffer;
            let finalMimetype = originalMimetype;
            
            // 4. CONVERTER/COMPRIMIR SE NECESSÁRIO
            if (analysis.needsConversion) {
                console.log(`🔄 ${analysis.reason}`);
                const converted = await this.converter.convertVideoToMp4(originalBuffer, videoUrl, 25); // Limite de 25MB
                finalBuffer = converted.buffer;
                finalMimetype = converted.mimetype;
                const finalSizeMB = finalBuffer.length / (1024 * 1024);
                console.log(`✅ Vídeo otimizado: ${finalSizeMB.toFixed(2)}MB, tipo: ${finalMimetype} (tentativa ${converted.attempt || 1})`);
            }
            
            // 5. VERIFICAÇÃO FINAL DE TAMANHO ANTES DO ENVIO
            const finalSizeMB = finalBuffer.length / (1024 * 1024);
            if (finalSizeMB > 25) {
                throw new Error(`ERRO CRÍTICO: Vídeo processado ainda muito grande (${finalSizeMB.toFixed(2)}MB > 25MB). Isso não deveria acontecer.`);
            }
            
            // 6. CRIAR MEDIA COM BUFFER OTIMIZADO E FILENAME (FIX CRÍTICO)
            const filename = this.extractFilenameFromUrl(videoUrl, finalMimetype);
            const media = new MessageMedia(finalMimetype, finalBuffer.toString('base64'), filename);
            
            console.log(`📋 Media criado: ${filename} (${finalMimetype}), tamanho: ${(finalBuffer.length / 1024).toFixed(2)}KB`);
            
            // 7. ENVIAR COM TIMEOUT ESTENDIDO PARA UPLOAD
            console.log(`📤 Iniciando upload para WhatsApp (vídeo otimizado: ${finalSizeMB.toFixed(2)}MB)...`);
            const result = await this.client.sendMessage(chatId, media, {
                caption: caption
            });
            
            return {
                success: true,
                messageId: result.id._serialized,
                type: 'video',
                converted: analysis.needsConversion,
                originalSize: originalBuffer.length,
                finalSize: finalBuffer.length,
                compression: analysis.needsConversion ? 
                    `${((1 - finalBuffer.length / originalBuffer.length) * 100).toFixed(1)}%` : 'none',
                originalSizeMB: originalSizeMB.toFixed(2),
                finalSizeMB: (finalBuffer.length / (1024 * 1024)).toFixed(2)
            };
            
        } catch (error) {
            console.error('❌ Erro no envio de vídeo:', error.message);
            
            // Se for timeout ou browser crash, dar dica específica ao usuário
            if (error.message.includes('timeout') || error.message.includes('Target closed') || error.message.includes('Protocol error')) {
                throw new Error(`Falha na comunicação com WhatsApp (possível crash do browser). Vídeo muito grande ou conexão instável. Tente um arquivo menor (<25MB) ou aguarde alguns segundos e tente novamente.`);
            }
            
            throw new Error(`Falha no envio de vídeo: ${error.message}`);
        }
    }

    async sendDocument(number, documentUrl, caption = '', filename = null) {
        return await this.executeWithRetry(async () => {
            return await this._sendDocumentInternal(number, documentUrl, caption, filename);
        }, 'Envio de documento');
    }

    async _sendDocumentInternal(number, documentUrl, caption = '', filename = null) {
        try {
            this.validateUrl(documentUrl);
            const media = await MessageMedia.fromUrl(documentUrl, { unsafeMime: true });
            if (filename) {
                media.filename = filename;
            }
            
            const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
            
            const result = await this.client.sendMessage(chatId, media, {
                caption: caption
            });
            
            return {
                success: true,
                messageId: result.id._serialized,
                type: 'document'
            };
        } catch (error) {
            throw error;
        }
    }

    async sendAudio(number, audioUrl) {
        return await this.executeWithRetry(async () => {
            return await this._sendAudioInternal(number, audioUrl);
        }, 'Envio de áudio');
    }

    async _sendAudioInternal(number, audioUrl) {
        try {
            this.validateUrl(audioUrl);
            const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
            
            console.log(`🎵 Iniciando envio de áudio com conversão automática: ${audioUrl}`);
            
            // 1. BAIXAR ARQUIVO ORIGINAL
            const response = await axios.get(audioUrl, { 
                responseType: 'arraybuffer',
                timeout: 30000
            });
            const originalBuffer = Buffer.from(response.data);
            const originalMimetype = response.headers['content-type'] || 'audio/wav';
            
            console.log(`📥 Arquivo baixado: ${(originalBuffer.length / 1024).toFixed(2)}KB, tipo: ${originalMimetype}`);
            
            // 2. ANALISAR SE PRECISA CONVERSÃO
            const analysis = await this.converter.analyzeMedia(originalBuffer, originalMimetype, audioUrl);
            
            let finalBuffer = originalBuffer;
            let finalMimetype = originalMimetype;
            
            // 3. CONVERTER SE NECESSÁRIO
            if (analysis.needsConversion) {
                console.log(`🔄 ${analysis.reason}`);
                const converted = await this.converter.convertAudioToOgg(originalBuffer, audioUrl);
                finalBuffer = converted.buffer;
                finalMimetype = converted.mimetype;
                console.log(`✅ Áudio convertido: ${(finalBuffer.length / 1024).toFixed(2)}KB, tipo: ${finalMimetype}`);
            }
            
            // 4. CRIAR MEDIA COM BUFFER OTIMIZADO E FILENAME (FIX CRÍTICO)
            const filename = this.extractFilenameFromUrl(audioUrl, finalMimetype);
            const media = new MessageMedia(finalMimetype, finalBuffer.toString('base64'), filename);
            
            console.log(`📋 Media criado: ${filename} (${finalMimetype}), tamanho: ${(finalBuffer.length / 1024).toFixed(2)}KB`);
            
            // 5. ENVIAR COM TIMEOUT MAIOR
            const result = await this.client.sendMessage(chatId, media, {
                sendAudioAsVoice: true
            });
            
            return {
                success: true,
                messageId: result.id._serialized,
                type: 'audio',
                converted: analysis.needsConversion,
                originalSize: originalBuffer.length,
                finalSize: finalBuffer.length,
                compression: analysis.needsConversion ? 
                    `${((1 - finalBuffer.length / originalBuffer.length) * 100).toFixed(1)}%` : 'none'
            };
            
        } catch (error) {
            console.error('❌ Erro no envio de áudio:', error.message);
            throw new Error(`Falha no envio de áudio: ${error.message}`);
        }
    }

    async sendLocation(number, latitude, longitude, description = '') {
        try {
            const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
            
            const location = new Location(latitude, longitude, description);
            const result = await this.client.sendMessage(chatId, location);
            
            return {
                success: true,
                messageId: result.id._serialized,
                type: 'location'
            };
        } catch (error) {
            throw error;
        }
    }

    async sendSticker(number, stickerUrl) {
        try {
            this.validateUrl(stickerUrl);
            const media = await MessageMedia.fromUrl(stickerUrl, { unsafeMime: true });
            const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
            
            const result = await this.client.sendMessage(chatId, media, {
                sendMediaAsSticker: true
            });
            
            return {
                success: true,
                messageId: result.id._serialized,
                type: 'sticker'
            };
        } catch (error) {
            throw error;
        }
    }
}

module.exports = MediaHandler;