// Módulo para otimização de vídeos longos/grandes
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

class VideoOptimizer {
    constructor() {
        this.tempDir = path.join(__dirname, 'temp_videos');
        this.ensureTempDir();
    }

    ensureTempDir() {
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    // Baixar vídeo para otimização
    async downloadVideo(url) {
        const fileName = `video_${Date.now()}.mp4`;
        const filePath = path.join(this.tempDir, fileName);

        console.log('📥 Baixando vídeo para otimização:', url);

        const response = await axios.get(url, {
            responseType: 'stream',
            timeout: 120000, // 2 minutos
            headers: {
                'User-Agent': 'WhatsApp Bot/1.0'
            }
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log('✅ Vídeo baixado:', filePath);
                resolve(filePath);
            });
            writer.on('error', reject);
        });
    }

    // Obter informações do vídeo
    async getVideoInfo(filePath) {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) {
                    reject(err);
                    return;
                }

                const duration = metadata.format.duration;
                const size = metadata.format.size;
                const bitrate = metadata.format.bit_rate;

                console.log('📊 Informações do vídeo:');
                console.log(`- Duração: ${Math.round(duration)}s`);
                console.log(`- Tamanho: ${Math.round(size / 1024 / 1024)}MB`);
                console.log(`- Bitrate: ${Math.round(bitrate / 1000)}kbps`);

                resolve({
                    duration,
                    size,
                    bitrate,
                    sizeMB: size / 1024 / 1024
                });
            });
        });
    }

    // Otimizar vídeo (reduzir tamanho e duração se necessário)
    async optimizeVideo(inputPath, targetSizeMB = 20, maxDurationSeconds = 60) {
        const outputPath = path.join(this.tempDir, `optimized_${Date.now()}.mp4`);

        console.log('🔧 Iniciando otimização do vídeo...');
        console.log(`- Tamanho alvo: ${targetSizeMB}MB`);
        console.log(`- Duração máxima: ${maxDurationSeconds}s`);

        const videoInfo = await this.getVideoInfo(inputPath);

        // Configurações de otimização baseadas no tamanho atual
        let options = {
            duration: Math.min(videoInfo.duration, maxDurationSeconds),
            videoBitrate: '500k', // Bitrate conservador
            audioBitrate: '128k',
            size: '640x360', // Resolução reduzida
            fps: 24
        };

        // Se o vídeo é muito grande, ser mais agressivo na compressão
        if (videoInfo.sizeMB > 50) {
            options.videoBitrate = '300k';
            options.audioBitrate = '64k';
            options.size = '480x270';
            options.fps = 20;
        }

        return new Promise((resolve, reject) => {
            let command = ffmpeg(inputPath)
                .duration(options.duration)
                .videoBitrate(options.videoBitrate)
                .audioBitrate(options.audioBitrate)
                .size(options.size)
                .fps(options.fps)
                .format('mp4')
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-preset fast',
                    '-crf 28', // Qualidade balanceada
                    '-movflags +faststart' // Para streaming
                ]);

            command
                .on('start', (commandLine) => {
                    console.log('🎬 FFmpeg iniciado:', commandLine);
                })
                .on('progress', (progress) => {
                    console.log(`⏳ Progresso: ${Math.round(progress.percent || 0)}%`);
                })
                .on('end', async () => {
                    console.log('✅ Otimização concluída!');

                    // Verificar tamanho final
                    const finalInfo = await this.getVideoInfo(outputPath);
                    console.log(`🎯 Vídeo otimizado: ${Math.round(finalInfo.sizeMB)}MB`);

                    resolve(outputPath);
                })
                .on('error', (err) => {
                    console.error('❌ Erro na otimização:', err.message);
                    reject(err);
                })
                .save(outputPath);
        });
    }

    // Converter vídeo otimizado para base64
    async videoToBase64(filePath) {
        console.log('📄 Convertendo vídeo para base64...');

        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');

        console.log(`📊 Base64 gerado: ${Math.round(buffer.length / 1024)}KB`);

        return {
            base64,
            size: buffer.length,
            mimetype: 'video/mp4'
        };
    }

    // Limpar arquivos temporários
    cleanup(filePaths) {
        filePaths.forEach(filePath => {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log('🗑️ Arquivo temporário removido:', path.basename(filePath));
            }
        });
    }

    // Processo completo de otimização
    async processLargeVideo(url, targetSizeMB = 20, maxDurationSeconds = 60) {
        let tempFiles = [];

        try {
            console.log('🎯 Iniciando processo de otimização de vídeo grande...');

            // 1. Baixar vídeo
            const downloadedPath = await this.downloadVideo(url);
            tempFiles.push(downloadedPath);

            // 2. Verificar se precisa otimizar
            const videoInfo = await this.getVideoInfo(downloadedPath);

            if (videoInfo.sizeMB <= targetSizeMB && videoInfo.duration <= maxDurationSeconds) {
                console.log('✅ Vídeo já está no tamanho apropriado!');
                return await this.videoToBase64(downloadedPath);
            }

            // 3. Otimizar vídeo
            const optimizedPath = await this.optimizeVideo(downloadedPath, targetSizeMB, maxDurationSeconds);
            tempFiles.push(optimizedPath);

            // 4. Converter para base64
            const result = await this.videoToBase64(optimizedPath);

            return result;

        } finally {
            // Sempre limpar arquivos temporários
            this.cleanup(tempFiles);
        }
    }
}

module.exports = VideoOptimizer;
