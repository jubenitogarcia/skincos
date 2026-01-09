#!/bin/bash

echo "🎬 Configurando FFmpeg para otimização de vídeos..."

# Atualizar repositórios
apt-get update

# Instalar FFmpeg
echo "📦 Instalando FFmpeg..."
apt-get install -y ffmpeg

# Verificar instalação
echo "✅ Verificando instalação do FFmpeg..."
ffmpeg -version | head -n 1

echo "🎯 FFmpeg configurado com sucesso!"
echo "📊 Recursos disponíveis:"
echo "  - Compressão de vídeo"
echo "  - Redução de duração"
echo "  - Redimensionamento"
echo "  - Otimização de bitrate"
