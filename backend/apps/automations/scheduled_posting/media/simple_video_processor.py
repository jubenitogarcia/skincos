#!/usr/bin/env python3
"""
Processador de vídeo simplificado que funciona com as dependências disponíveis
"""

import os
import sys
import tempfile
import logging
from pathlib import Path
from moviepy.editor import VideoFileClip
from faster_whisper import WhisperModel
from transformers import BlipProcessor, BlipForConditionalGeneration
import cv2
from PIL import Image
import numpy as np
from .alternative_models import get_text_generator
import torch

class SimpleVideoProcessor:
    def __init__(self):
        # Configurar logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s'
        )
        self.logger = logging.getLogger(__name__)

        print("🚀 Inicializando processador de vídeo...")

        # Whisper para transcrição
        print("  📊 Carregando Whisper...")
        self.whisper = WhisperModel("base", device="cpu", compute_type="int8")

        # BLIP para visão
        print("  👁️ Carregando BLIP...")
        self.blip_processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
        self.blip_model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base")

        # Modelo de texto
        print("  ✍️ Carregando modelo de texto...")
        self.model_type, self.tokenizer, self.text_model = get_text_generator()

        # Configurar device
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.text_model = self.text_model.to(self.device)
        self.blip_model = self.blip_model.to(self.device)

        print(f"✅ Processador pronto! (Usando {self.model_type}, Device: {self.device})\n")

    def extract_audio(self, video_path):
        """Extrai áudio do vídeo"""
        self.logger.info("🎵 Extraindo áudio...")

        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            audio_path = tmp_file.name

        try:
            video = VideoFileClip(video_path)
            video.audio.write_audiofile(audio_path, verbose=False, logger=None)
            video.close()
            return audio_path
        except Exception as e:
            self.logger.error(f"Erro na extração de áudio: {str(e)}")
            raise

    def transcribe_audio(self, audio_path):
        """Transcreve áudio"""
        self.logger.info("🎧 Transcrevendo...")

        try:
            segments, _ = self.whisper.transcribe(audio_path, language="pt")
            transcription = " ".join([s.text.strip() for s in segments])
            self.logger.info(f"📝 Transcrição: {transcription[:100]}...")
            return transcription
        except Exception as e:
            self.logger.error(f"Erro na transcrição: {str(e)}")
            raise

    def extract_frame(self, video_path):
        """Extrai frame do meio do vídeo"""
        self.logger.info("📸 Extraindo frame...")

        try:
            cap = cv2.VideoCapture(video_path)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

            # Pegar frame do meio
            cap.set(cv2.CAP_PROP_POS_FRAMES, total_frames // 2)
            ret, frame = cap.read()
            cap.release()

            if ret:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                return Image.fromarray(frame_rgb)
            else:
                return None
        except Exception as e:
            self.logger.error(f"Erro na extração de frame: {str(e)}")
            return None

    def analyze_frame(self, image):
        """Analisa frame com BLIP"""
        if image is None:
            return "Não foi possível analisar o vídeo"

        self.logger.info("👁️ Analisando conteúdo visual...")

        try:
            inputs = self.blip_processor(images=image, return_tensors="pt").to(self.device)
            out = self.blip_model.generate(**inputs, max_length=50, num_beams=5)
            description = self.blip_processor.decode(out[0], skip_special_tokens=True)
            self.logger.info(f"👁️ Descrição visual: {description}")
            return description
        except Exception as e:
            self.logger.error(f"Erro na análise visual: {str(e)}")
            return "Análise visual indisponível"

    def generate_caption(self, transcription, visual_description):
        """Gera legenda baseada na transcrição e descrição visual"""
        self.logger.info("✍️ Gerando legenda...")

        try:
            if self.model_type == "t5":
                prompt = f"Create Instagram caption: {transcription[:200]} Visual: {visual_description[:100]}"
                inputs = self.tokenizer(prompt, return_tensors="pt", max_length=512, truncation=True)
                inputs = {k: v.to(self.device) for k, v in inputs.items()}

                outputs = self.text_model.generate(**inputs, max_length=150, temperature=0.8, do_sample=True)
                caption = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
            else:  # GPT-2
                prompt = f"Instagram post about {transcription[:100]}"
                inputs = self.tokenizer(prompt, return_tensors="pt", truncation=True, padding=True)
                inputs = {k: v.to(self.device) for k, v in inputs.items()}

                outputs = self.text_model.generate(
                    **inputs,
                    max_length=len(prompt.split()) + 50,
                    temperature=0.8,
                    pad_token_id=self.tokenizer.eos_token_id,
                    do_sample=True,
                    top_p=0.9
                )
                caption = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
                caption = caption.replace(prompt, "").strip()

            # Melhorar legenda
            if not caption or len(caption) < 10:
                caption = f"Vídeo sobre {transcription[:50]}..."

            # Adicionar hashtags se não existirem
            if "#" not in caption:
                caption += "\n\n#reels #instagram #viral #brasil #video"

            return caption

        except Exception as e:
            self.logger.error(f"Erro na geração de legenda: {str(e)}")
            return f"Vídeo sobre: {transcription[:100]}...\n\n#reels #instagram #viral"

    def process_video(self, video_path):
        """Processa vídeo completo"""
        print(f"🎬 Processando: {video_path}")

        if not os.path.exists(video_path):
            print(f"❌ Arquivo não encontrado: {video_path}")
            return None

        try:
            # 1. Extrair áudio
            audio_path = self.extract_audio(video_path)

            # 2. Transcrever
            transcription = self.transcribe_audio(audio_path)

            # 3. Extrair e analisar frame
            frame = self.extract_frame(video_path)
            visual_desc = self.analyze_frame(frame)

            # 4. Gerar legenda
            caption = self.generate_caption(transcription, visual_desc)

            # 5. Limpar arquivo temporário
            if os.path.exists(audio_path):
                os.remove(audio_path)

            result = {
                'transcription': transcription,
                'visual_description': visual_desc,
                'caption': caption,
                'status': 'success'
            }

            print("\n✅ Processamento concluído!")
            print(f"\n📝 LEGENDA GERADA:\n{caption}")
            print(f"\n📊 Transcrição: {transcription[:200]}...")
            print(f"👁️ Descrição visual: {visual_desc}")

            return result

        except Exception as e:
            print(f"\n❌ Erro no processamento: {str(e)}")
            return {'status': 'error', 'error': str(e)}

def main():
    """Função principal"""
    if len(sys.argv) < 2:
        print("Uso: python simple_video_processor.py <video.mp4>")
        print("Exemplo: python simple_video_processor.py meu_video.mp4")
        return

    video_path = sys.argv[1]

    try:
        processor = SimpleVideoProcessor()
        result = processor.process_video(video_path)

        if result and result.get('status') == 'success':
            # Salvar resultado
            output_file = f"resultado_{Path(video_path).stem}.txt"
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(f"LEGENDA:\n{result['caption']}\n\n")
                f.write(f"TRANSCRIÇÃO:\n{result['transcription']}\n\n")
                f.write(f"DESCRIÇÃO VISUAL:\n{result['visual_description']}\n")

            print(f"\n💾 Resultado salvo em: {output_file}")

    except Exception as e:
        print(f"❌ Erro: {str(e)}")

if __name__ == "__main__":
    main()
