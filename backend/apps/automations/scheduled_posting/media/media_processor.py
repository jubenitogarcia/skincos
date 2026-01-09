"""
Media Processor - Extração e processamento de áudio e frames de vídeo
Integrado com sistema de pastas agendadas Scheduled/YYYY/MM/DD
"""
import os
import tempfile
import logging
import cv2
import numpy as np
from moviepy.editor import VideoFileClip
from faster_whisper import WhisperModel
from PIL import Image
from datetime import datetime
from pathlib import Path
from libs.scheduler_config import scheduled_dir

class MediaProcessor:
    def __init__(self):
        # Configurar logging
        logging.basicConfig(level=logging.INFO)
        self.logger = logging.getLogger(__name__)

        # Inicializar Whisper para transcrição
        self.logger.info("🎤 Carregando modelo Whisper...")
        self.whisper = WhisperModel("medium", device="cpu", compute_type="int8")

    def get_scheduled_media_path(self):
        """Retorna o caminho para mídia agendada do dia atual"""
        now = datetime.now()
        year = now.strftime("%Y")
        month = now.strftime("%m")

        scheduled_path = scheduled_dir() / year / month
        return scheduled_path

    def find_today_media(self):
        """Encontra arquivos de mídia para o dia atual"""
        scheduled_path = self.get_scheduled_media_path()
        day = datetime.now().strftime("%d")

        if not scheduled_path.exists():
            self.logger.warning(f"Pasta agendada não encontrada: {scheduled_path}")
            return []

        media_files = []
        video_extensions = {'.mp4', '.mov', '.avi', '.mkv', '.webm'}
        image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}

        for file in scheduled_path.iterdir():
            if file.is_file() and day in file.name:
                if file.suffix.lower() in video_extensions or file.suffix.lower() in image_extensions:
                    media_files.append(file)
                    self.logger.info(f"Mídia encontrada para hoje: {file.name}")

        return media_files

    def extract_audio(self, video_path):
        """Extrai áudio do vídeo como arquivo WAV temporário"""
        self.logger.info(f"🎵 Extraindo áudio de {video_path}")

        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            audio_path = tmp_file.name

        try:
            video = VideoFileClip(video_path)
            video.audio.write_audiofile(audio_path, logger=None, verbose=False)
            video.close()
            return audio_path
        except Exception as e:
            self.logger.error(f"Erro na extração de áudio: {str(e)}")
            if os.path.exists(audio_path):
                os.remove(audio_path)
            raise

    def transcribe_audio(self, audio_path):
        """Transcreve áudio usando Whisper (local)"""
        self.logger.info("🎧 Transcrevendo áudio...")

        try:
            segments, info = self.whisper.transcribe(
                audio_path,
                beam_size=5,
                language="pt",  # Português
                task="transcribe"
            )

            transcription = " ".join([segment.text.strip() for segment in segments])
            self.logger.info(f"✅ Transcrição concluída: {len(transcription)} caracteres")
            return transcription
        except Exception as e:
            self.logger.error(f"Erro na transcrição: {str(e)}")
            raise

    def extract_key_frames(self, video_path, max_frames=10):
        """Extrai frames-chave do vídeo usando detecção de mudança de cena"""
        self.logger.info(f"📸 Extraindo frames-chave de {video_path}")

        try:
            cap = cv2.VideoCapture(video_path)
            frames = []
            prev_frame = None
            frame_count = 0
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            duration = total_frames / fps

            # Calcular intervalo entre frames
            interval = max(1, total_frames // max_frames)

            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                # Extrair frame a cada intervalo
                if frame_count % interval == 0:
                    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    frames.append(frame_rgb)

                frame_count += 1

                # Limitar número de frames
                if len(frames) >= max_frames:
                    break

            cap.release()

            # Garantir que temos pelo menos alguns frames
            if not frames and total_frames > 0:
                cap = cv2.VideoCapture(video_path)
                cap.set(cv2.CAP_PROP_POS_FRAMES, total_frames // 2)
                ret, frame = cap.read()
                if ret:
                    frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                cap.release()

            self.logger.info(f"✅ Extraídos {len(frames)} frames-chave")
            return frames, duration

        except Exception as e:
            self.logger.error(f"Erro na extração de frames: {str(e)}")
            raise

    def cleanup_temp_files(self, file_paths):
        """Remove arquivos temporários"""
        for path in file_paths:
            if os.path.exists(path):
                try:
                    os.remove(path)
                except Exception as e:
                    self.logger.warning(f"Não foi possível remover arquivo temporário {path}: {str(e)}")
