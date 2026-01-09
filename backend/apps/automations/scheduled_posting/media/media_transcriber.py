import whisper
import cv2
from pathlib import Path
import subprocess
import logging

logger = logging.getLogger(__name__)

class MediaTranscriber:
    """Transcreve áudio de vídeos usando Whisper."""

    def __init__(self, model_size="base"):
        """
        Initialize transcriber.

        Args:
            model_size: tiny, base, small, medium, large
        """
        self.model = whisper.load_model(model_size)

    def extract_audio(self, video_path: Path, audio_path: Path) -> bool:
        """Extract audio from video using ffmpeg."""
        try:
            cmd = [
                'ffmpeg', '-i', str(video_path),
                '-vn',  # No video
                '-acodec', 'pcm_s16le',  # Audio codec
                '-ar', '16000',  # Sample rate
                '-ac', '1',  # Mono
                '-y',  # Overwrite
                str(audio_path)
            ]

            subprocess.run(cmd, check=True, capture_output=True)
            return True
        except Exception as e:
            logger.error(f"Erro ao extrair áudio: {e}")
            return False

    def transcribe_audio(self, audio_path: Path, language="pt") -> dict:
        """
        Transcribe audio file.

        Args:
            audio_path: Path to audio file
            language: Language code (pt, en, es, etc)

        Returns:
            dict: Transcription results
        """
        try:
            result = self.model.transcribe(
                str(audio_path),
                language=language,
                fp16=False,  # Use FP32 for compatibility
                verbose=False
            )

            return {
                "text": result["text"],
                "segments": result["segments"],
                "language": result["language"]
            }
        except Exception as e:
            logger.error(f"Erro na transcrição: {e}")
            return None

    def transcribe_video(self, video_path: Path, language="pt") -> dict:
        """Transcribe video by extracting audio first."""
        # Create temp audio file
        audio_path = Path("temp_audio.wav")

        try:
            # Extract audio
            if not self.extract_audio(video_path, audio_path):
                return None

            # Transcribe
            result = self.transcribe_audio(audio_path, language)

            return result

        finally:
            # Clean up
            if audio_path.exists():
                audio_path.unlink()
