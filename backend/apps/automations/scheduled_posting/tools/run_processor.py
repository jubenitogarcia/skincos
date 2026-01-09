#!/usr/bin/env python3
"""
Script para executar o processamento de vídeos
"""

import os
import sys
import logging
import argparse
from ..media.video_analyzer import VideoAnalyzer

def main():
    """Função principal"""
    # Configurar logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    logger = logging.getLogger(__name__)

    # Configurar argumentos da linha de comando
    parser = argparse.ArgumentParser(description="Scheduled Posting Video Processor")
    parser.add_argument("--video", "-v", help="Caminho para um arquivo de vídeo")
    parser.add_argument("--dir", "-d", help="Caminho para um diretório de vídeos")
    parser.add_argument("--llama", action="store_true", help="Usar Llama (se disponível)")
    args = parser.parse_args()

    # Criar diretórios necessários
    setup_directories()

    # Processar vídeos conforme os parâmetros
    try:
        # Inicializar processador
        analyzer = VideoAnalyzer(use_llama=args.llama)

        if args.video:
            # Processar vídeo único
            if not os.path.exists(args.video):
                logger.error(f"Arquivo não encontrado: {args.video}")
                return 1

            logger.info(f"Processando vídeo: {args.video}")
            result = analyzer.process_video(args.video)
            display_result(result)

        elif args.dir:
            # Processar diretório
            if not os.path.isdir(args.dir):
                logger.error(f"Diretório não encontrado: {args.dir}")
                return 1

            logger.info(f"Processando vídeos no diretório: {args.dir}")
            process_directory(args.dir, analyzer)

        else:
            # Modo padrão: processar pasta media
            media_dir = "media"
            if not os.path.isdir(media_dir):
                logger.warning(f"Diretório 'media' não encontrado, criando...")
                os.makedirs(media_dir)
                logger.info("Coloque os vídeos na pasta 'media' e execute novamente.")
                return 0

            logger.info(f"Processando vídeos na pasta: {media_dir}")
            process_directory(media_dir, analyzer)

        return 0

    except Exception as e:
        logger.error(f"Erro na execução: {str(e)}")
        return 1

def setup_directories():
    """Cria diretórios necessários"""
    dirs = ["models", "logs", "data", "media"]
    for dir_name in dirs:
        if not os.path.exists(dir_name):
            os.makedirs(dir_name)

def process_directory(directory, analyzer):
    """Processa todos os vídeos em um diretório"""
    video_extensions = [".mp4", ".mov", ".avi", ".mkv"]

    # Listar vídeos
    videos = []
    for filename in os.listdir(directory):
        if any(filename.lower().endswith(ext) for ext in video_extensions):
            filepath = os.path.join(directory, filename)
            if os.path.isfile(filepath):
                videos.append(filepath)

    if not videos:
        print("Nenhum vídeo encontrado no diretório.")
        return

    print(f"Encontrados {len(videos)} vídeos.")

    # Processar cada vídeo
    for i, video_path in enumerate(videos, 1):
        print(f"\n[{i}/{len(videos)}] Processando: {os.path.basename(video_path)}")
        result = analyzer.process_video(video_path)
        display_result(result)

def display_result(result):
    """Exibe o resultado do processamento"""
    if result["status"] == "success":
        print("\n" + "="*50)
        print("✅ LEGENDA GERADA:")
        print("="*50)
        print(result["caption"])
        print("\n" + "-"*50)
        print(f"⏱️  Tempo de processamento: {result['processing_time']}")
        print(f"🎬 Duração do vídeo: {result['video_duration']}")
        print("-"*50)
    else:
        print(f"\n❌ ERRO: {result['error']}")

if __name__ == "__main__":
    sys.exit(main())
