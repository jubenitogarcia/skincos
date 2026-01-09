#!/usr/bin/env python3
"""
Sistema automatizado de postagem que busca mídia em Scheduled/YYYY/MM/DD
"""
import os
import sys
import json
from datetime import datetime
from pathlib import Path
import logging
from libs.scheduler_config import ConfigManager, scheduled_dir, scheduled_posting_var_dir
from ..scheduling.scheduled_media_handler import ScheduledMediaHandler

# Importar o processador existente se disponível
try:
    from ..media.simple_video_processor import SimpleVideoProcessor
    VIDEO_PROCESSOR_AVAILABLE = True
except ImportError:
    VIDEO_PROCESSOR_AVAILABLE = False

# Importar BLIP para análise de imagens
try:
    from transformers import BlipProcessor, BlipForConditionalGeneration
    import torch
    from PIL import Image
    BLIP_AVAILABLE = True
except ImportError:
    BLIP_AVAILABLE = False

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

class AutomatedPoster:
    def __init__(self):
        self.logger = logging.getLogger(__name__)

        # Carregar configurações
        self.config = self.load_config()
        scheduled_config = self.config.get("scheduled_posting", {})
        self.base_folder = scheduled_config.get("base_folder") or str(scheduled_dir())
        self.default_hashtags = scheduled_config.get("post_defaults", {}).get("hashtags", ["instagram", "fotografia"])
        self.use_emoji = scheduled_config.get("post_defaults", {}).get("emoji", True)

        # Inicializar handler para mídia agendada
        self.media_handler = ScheduledMediaHandler(base_path=scheduled_config.get("base_folder"))

        if VIDEO_PROCESSOR_AVAILABLE:
            try:
                self.video_processor = SimpleVideoProcessor()
                self.logger.info("✅ Processador de vídeo carregado")
            except Exception as e:
                self.logger.warning(f"⚠️ Erro ao carregar processador de vídeo: {e}")
                self.video_processor = None
        else:
            self.video_processor = None
            self.logger.info("ℹ️ Processador de vídeo não disponível")

        # Carregar modelo BLIP para análise de imagens
        if BLIP_AVAILABLE:
            try:
                self.logger.info("🖼️ Carregando modelo BLIP para análise de imagens...")
                self.blip_processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
                self.blip_model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base")

                # Configurar device
                self.device = "cuda" if torch.cuda.is_available() else "cpu"
                self.blip_model = self.blip_model.to(self.device)
                self.logger.info(f"✅ Modelo BLIP carregado com sucesso (device: {self.device})")
            except Exception as e:
                self.logger.warning(f"⚠️ Erro ao carregar modelo BLIP: {e}")
                self.blip_processor = None
                self.blip_model = None
        else:
            self.blip_processor = None
            self.blip_model = None
            self.logger.info("ℹ️ BLIP não disponível para análise de imagens")

    def load_config(self):
        """Carrega configurações do sistema"""
        try:
            return ConfigManager().data
        except Exception as e:
            self.logger.error(f"❌ Erro ao carregar configurações: {e}")
            return {}

    def analyze_image(self, image_path):
        """Analisa uma imagem usando BLIP e retorna uma descrição"""
        if not BLIP_AVAILABLE or not self.blip_processor or not self.blip_model:
            self.logger.warning("⚠️ BLIP não disponível para análise")
            return None

        try:
            # Carregar e processar imagem
            self.logger.info(f"🔍 Analisando imagem: {image_path}")
            image = Image.open(image_path).convert('RGB')

            # Processar com BLIP
            inputs = self.blip_processor(image, return_tensors="pt").to(self.device)
            outputs = self.blip_model.generate(**inputs, max_length=50)
            description = self.blip_processor.decode(outputs[0], skip_special_tokens=True)

            self.logger.info(f"✅ Descrição gerada: {description}")
            return description
        except Exception as e:
            self.logger.error(f"❌ Erro ao analisar imagem: {e}")
            return None

    def run_daily_post(self):
        """Executa a postagem diária"""
        self.logger.info(f"🚀 Iniciando postagem automática para {datetime.now().strftime('%d/%m/%Y')}")

        # 1. Buscar arquivos do dia
        files = self.media_handler.get_today_files()

        if not files:
            self.logger.warning("⚠️ Nenhum arquivo encontrado para hoje")
            return False

        self.logger.info(f"📁 {len(files)} arquivo(s) encontrado(s)")

        # 2. Organizar por tipo
        organized = self.media_handler.organize_media_by_type(files)

        # 3. Processar vídeos se houver
        captions = []

        for video in organized['videos']:
            self.logger.info(f"🎬 Processando vídeo: {video.name}")
            if self.video_processor:
                try:
                    result = self.video_processor.process_video(str(video))
                    if result and result.get('status') == 'success':
                        captions.append(result['caption'])
                    else:
                        # Usar hashtags das configurações
                        hashtags = " ".join([f"#{tag}" for tag in self.default_hashtags])
                        emoji = "🎬" if self.use_emoji else ""
                        captions.append(f"Novo vídeo! {emoji} {video.stem} {hashtags}")
                except Exception as e:
                    self.logger.error(f"❌ Erro ao processar vídeo: {e}")
                    hashtags = " ".join([f"#{tag}" for tag in self.default_hashtags])
                    emoji = "🎬" if self.use_emoji else ""
                    captions.append(f"Novo vídeo! {emoji} {video.stem} {hashtags}")
            else:
                hashtags = " ".join([f"#{tag}" for tag in self.default_hashtags])
                emoji = "🎬" if self.use_emoji else ""
                captions.append(f"Novo vídeo! {emoji} {video.stem} {hashtags}")

        # 4. Processar imagens com BLIP se disponível
        for image in organized['images']:
            self.logger.info(f"🖼️ Processando imagem: {image.name}")
            image_description = self.analyze_image(image)

            # Preparar hashtags das configurações
            hashtags = " ".join([f"#{tag}" for tag in self.default_hashtags])

            if image_description:
                # Adicionar descrição da imagem à legenda com emojis se habilitados
                emoji = "📸" if self.use_emoji else ""
                captions.append(f"{image_description} {emoji} {hashtags}")
            else:
                # Legenda padrão se BLIP não estiver disponível
                emoji = "📸" if self.use_emoji else ""
                captions.append(f"Nova postagem! {emoji} {image.stem} {hashtags}")

        # 5. Criar post
        if captions:
            final_caption = captions[0]  # Usa a primeira legenda gerada
            self.logger.info(f"📝 Legenda: {final_caption}")

            # Salvar resultado
            out_dir = scheduled_posting_var_dir() / "posts"
            out_dir.mkdir(parents=True, exist_ok=True)
            output_file = out_dir / f"post_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(f"Data: {datetime.now()}\n")
                f.write(f"Arquivos: {[f.name for f in files]}\n")
                f.write(f"Legenda: {final_caption}\n")
                f.write("\n--- Detalhes ---\n")
                f.write(f"Vídeos: {len(organized['videos'])}\n")
                f.write(f"Imagens: {len(organized['images'])}\n")

                # Adicionar tempo de criação
                f.write(f"Criado em: {datetime.now().strftime('%H:%M:%S')}\n")

                # Adicionar informações de configuração
                f.write("\n--- Configurações ---\n")
                f.write(f"Pasta base: {self.base_folder}\n")
                f.write(f"Hashtags: {', '.join(self.default_hashtags)}\n")
                f.write(f"Emoji: {'✓' if self.use_emoji else '✗'}\n")

            self.logger.info(f"✅ Post salvo em: {output_file}")
            return True

        return False

    def check_scheduled_structure(self):
        """Verifica e cria a estrutura de pastas se necessário"""
        today_path = self.media_handler.get_today_path()

        if not today_path.exists():
            self.logger.info(f"📁 Criando estrutura de pastas: {today_path}")
            today_path.mkdir(parents=True, exist_ok=True)

            # Criar arquivo de exemplo
            example_file = today_path / f"{datetime.now().strftime('%d')}_exemplo.txt"
            with open(example_file, 'w', encoding='utf-8') as f:
                f.write("Coloque suas imagens e vídeos aqui com o dia no nome do arquivo!")

        return today_path

def main():
    """Função principal"""
    poster = AutomatedPoster()

    # Verificar estrutura
    scheduled_path = poster.check_scheduled_structure()
    print(f"\n📁 Pasta agendada: {scheduled_path}")
    print(f"📅 Procurando arquivos com: {datetime.now().strftime('%d')} no nome\n")

    # Executar postagem
    if len(sys.argv) > 1 and sys.argv[1] == "--post":
        poster.run_daily_post()
    else:
        # Apenas verificar
        files = poster.media_handler.get_today_files()
        if files:
            print(f"✅ {len(files)} arquivo(s) encontrado(s):")
            for f in files:
                print(f"  - {f.name}")
        else:
            print("⚠️ Nenhum arquivo encontrado para hoje.")
            print(f"\nPara adicionar arquivos:")
            print(f"1. Navegue até: {scheduled_path}")
            print(f"2. Adicione arquivos com '{datetime.now().strftime('%d')}' no nome")
            print(f"   Exemplo: {datetime.now().strftime('%d')}_foto.jpg ou {datetime.now().strftime('%d')}_video.mp4")

if __name__ == "__main__":
    main()
