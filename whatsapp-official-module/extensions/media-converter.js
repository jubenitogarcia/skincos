const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class MediaConverter {
    constructor() {
        this.tempDir = path.join(__dirname, '../temp');
        this.ensureTempDir();
    }

    ensureTempDir() {
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    generateTempFilename(extension) {
        const timestamp = Date.now();
        const random = crypto.randomBytes(4).toString('hex');
        return path.join(this.tempDir, `converted_${timestamp}_${random}.${extension}`);
    }

    // CONVERSÃO DE ÁUDIO PARA OGG/OPUS (formato que funciona no WhatsApp Web.js)
    async convertAudioToOgg(inputBuffer, originalUrl) {
        return new Promise((resolve, reject) => {
            const inputFile = this.generateTempFilename('input');
            const outputFile = this.generateTempFilename('ogg');

            // Salvar buffer temporariamente
            fs.writeFileSync(inputFile, inputBuffer);

            console.log(`🔄 Convertendo áudio para OGG/Opus: ${originalUrl}`);

            ffmpeg(inputFile)
                .audioCodec('libopus')           // Codec Opus (essencial para WhatsApp)
                .audioChannels(1)                // Mono para voice messages
                .audioFrequency(16000)           // 16kHz sample rate (otimizado)
                .audioBitrate('32k')             // Bitrate baixo para economia
                .format('ogg')                   // Container OGG
                .on('start', (cmd) => {
                    console.log('🎵 FFmpeg comando:', cmd);
                })
                .on('progress', (progress) => {
                    console.log(`📊 Progresso áudio: ${Math.round(progress.percent || 0)}%`);
                })
                .on('end', () => {
                    console.log('✅ Conversão de áudio concluída!');
                    
                    // Ler arquivo convertido
                    const convertedBuffer = fs.readFileSync(outputFile);
                    
                    // Limpar arquivos temporários
                    this.cleanup([inputFile, outputFile]);
                    
                    resolve({
                        buffer: convertedBuffer,
                        mimetype: 'audio/ogg; codecs=opus',
                        size: convertedBuffer.length
                    });
                })
                .on('error', (err) => {
                    console.error('❌ Erro na conversão de áudio:', err.message);
                    this.cleanup([inputFile, outputFile]);
                    reject(new Error(`Falha na conversão de áudio: ${err.message}`));
                })
                .save(outputFile);
        });
    }

    // CONVERSÃO/COMPRESSÃO DE VÍDEO PARA MP4 H.264+AAC com controle rigoroso de tamanho
    async convertVideoToMp4(inputBuffer, originalUrl, maxSizeMB = 25, attempt = 1) {
        return new Promise((resolve, reject) => {
            const inputFile = this.generateTempFilename('input');
            const outputFile = this.generateTempFilename('mp4');

            // Salvar buffer temporariamente
            fs.writeFileSync(inputFile, inputBuffer);

            console.log(`🔄 Convertendo/comprimindo vídeo (tentativa ${attempt}): ${originalUrl}`);

            // Configurações baseadas na tentativa (mais agressivas em tentativas subsequentes)
            let quality, resolution, maxBitrate, audioBitrate;
            
            if (attempt === 1) {
                // Primeira tentativa: compressão AGRESSIVA (vídeos grandes precisam disso)
                quality = 32;
                resolution = '854x480';
                maxBitrate = 400;
                audioBitrate = '96k';
            } else if (attempt === 2) {
                // Segunda tentativa: compressão MUITO agressiva
                quality = 35;
                resolution = '640x360';
                maxBitrate = 250;
                audioBitrate = '64k';
            } else {
                // Terceira tentativa: máxima compressão possível
                quality = 38;
                resolution = '480x360';
                maxBitrate = 150;
                audioBitrate = '48k';
            }

            ffmpeg(inputFile)
                .videoCodec('libx264')           // H.264 (essencial para WhatsApp)
                .audioCodec('aac')               // AAC (compatível)
                .videoBitrate(maxBitrate)        // Bitrate variável por tentativa
                .audioBitrate(audioBitrate)      // Áudio variável por tentativa
                .size(resolution)                // Resolução variável por tentativa
                .fps(24)                         // 24 FPS para economia
                .format('mp4')
                .addOptions([
                    '-preset fast',              // Encoding rápido
                    `-crf ${quality}`,           // Quality factor variável
                    '-movflags +faststart',      // Otimização para streaming
                    '-profile:v baseline',       // Profile compatível
                    '-level 3.0'                 // Level compatível
                ])
                .on('start', (cmd) => {
                    console.log(`🎬 FFmpeg comando (tentativa ${attempt}):`, cmd);
                })
                .on('progress', (progress) => {
                    console.log(`📊 Progresso vídeo: ${Math.round(progress.percent || 0)}%`);
                })
                .on('end', async () => {
                    console.log('✅ Conversão de vídeo concluída!');
                    
                    // Ler arquivo convertido
                    const convertedBuffer = fs.readFileSync(outputFile);
                    const finalSizeMB = convertedBuffer.length / (1024 * 1024);
                    
                    console.log(`📦 Tamanho final: ${finalSizeMB.toFixed(2)}MB (limite: ${maxSizeMB}MB)`);
                    
                    // VERIFICAÇÃO RIGOROSA: Se ainda está muito grande, tentar novamente ou falhar
                    if (finalSizeMB > maxSizeMB) {
                        console.warn(`⚠️ Vídeo ainda muito grande: ${finalSizeMB.toFixed(2)}MB > ${maxSizeMB}MB`);
                        
                        // Usar arrow function self para manter contexto
                        const self = this;
                        self.cleanup([inputFile, outputFile]);
                        
                        if (attempt < 3) {
                            console.log(`🔄 Tentando compressão mais agressiva (tentativa ${attempt + 1})...`);
                            try {
                                const result = await self.convertVideoToMp4(inputBuffer, originalUrl, maxSizeMB, attempt + 1);
                                resolve(result);
                            } catch (retryError) {
                                reject(retryError);
                            }
                        } else {
                            reject(new Error(`Vídeo muito grande! Mesmo após 3 tentativas de compressão máxima, o arquivo ficou com ${finalSizeMB.toFixed(2)}MB (limite: ${maxSizeMB}MB). Tente um vídeo mais curto ou de menor qualidade.`));
                        }
                    } else {
                        // Tamanho OK! Limpar e retornar
                        const self = this;
                        self.cleanup([inputFile, outputFile]);
                        
                        resolve({
                            buffer: convertedBuffer,
                            mimetype: 'video/mp4',
                            size: convertedBuffer.length,
                            finalSizeMB: finalSizeMB,
                            attempt: attempt
                        });
                    }
                })
                .on('error', (err) => {
                    console.error(`❌ Erro na conversão de vídeo (tentativa ${attempt}):`, err.message);
                    this.cleanup([inputFile, outputFile]);
                    reject(new Error(`Falha na conversão de vídeo: ${err.message}`));
                })
                .save(outputFile);
        });
    }

    // LIMPEZA DE ARQUIVOS TEMPORÁRIOS
    cleanup(files) {
        files.forEach(file => {
            try {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                    console.log(`🗑️ Removido: ${path.basename(file)}`);
                }
            } catch (error) {
                console.warn(`⚠️ Erro ao limpar ${file}:`, error.message);
            }
        });
    }

    // ANÁLISE DE ARQUIVO PARA DETERMINAR SE PRECISA CONVERSÃO
    async analyzeMedia(buffer, mimetype, originalUrl) {
        const analysis = {
            needsConversion: false,
            reason: '',
            originalMimetype: mimetype,
            originalSize: buffer.length
        };

        // ÁUDIO: Sempre converter se não for OGG/Opus
        if (mimetype.startsWith('audio/')) {
            if (!mimetype.includes('ogg') || !mimetype.includes('opus')) {
                analysis.needsConversion = true;
                analysis.reason = 'Áudio precisa ser convertido para OGG/Opus (WhatsApp Web.js requirement)';
            }
        }

        // VÍDEO: Verificação rigorosa de tamanho e formato
        if (mimetype.startsWith('video/')) {
            const sizeMB = buffer.length / (1024 * 1024);
            
            // Rejeitar imediatamente vídeos extremamente grandes (>200MB)
            if (sizeMB > 200) {
                throw new Error(`Vídeo muito grande para processamento: ${sizeMB.toFixed(2)}MB. Limite máximo: 200MB. Use um editor de vídeo para reduzir o tamanho antes do envio.`);
            }
            
            // Converter se maior que 25MB ou formato incompatível
            if (sizeMB > 25) {
                analysis.needsConversion = true;
                analysis.reason = `Vídeo muito grande (${sizeMB.toFixed(2)}MB), comprimindo para <25MB`;
            } else if (!mimetype.includes('mp4') && !mimetype.includes('h264')) {
                analysis.needsConversion = true;
                analysis.reason = 'Vídeo não está em formato MP4 H.264+AAC otimizado';
            }
        }

        console.log(`🔍 Análise de mídia: ${analysis.reason || 'Arquivo já está em formato otimizado'}`);
        return analysis;
    }
}

module.exports = MediaConverter;