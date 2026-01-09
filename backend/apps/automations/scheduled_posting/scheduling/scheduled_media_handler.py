"""
Handler para mídia agendada no formato Scheduled/YYYY/MM/DD
"""
import os
from datetime import datetime
from pathlib import Path
import json
import logging
from typing import List, Dict, Optional
from libs.scheduler_config import scheduled_dir

class ScheduledMediaHandler:
    def __init__(self, base_path: str | os.PathLike | None = None):
        self.base_path = Path(base_path) if base_path else scheduled_dir()
        self.logger = logging.getLogger(__name__)

    def get_today_path(self) -> Path:
        """Retorna o caminho para os arquivos de hoje"""
        now = datetime.now()
        year = now.strftime("%Y")
        month = now.strftime("%m")

        return self.base_path / year / month

    def get_today_files(self) -> List[Path]:
        """Retorna todos os arquivos do dia atual"""
        today_path = self.get_today_path()
        day = datetime.now().strftime("%d")

        if not today_path.exists():
            self.logger.warning(f"Pasta não encontrada: {today_path}")
            return []

        # Buscar arquivos que contenham o dia no nome
        files = []
        for file in today_path.iterdir():
            if file.is_file() and day in file.name:
                # Verificar se é imagem ou vídeo
                if self._is_media_file(file):
                    files.append(file)
                    self.logger.info(f"Arquivo encontrado: {file}")

        return files

    def _is_media_file(self, file_path: Path) -> bool:
        """Verifica se o arquivo é uma mídia válida"""
        image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
        video_extensions = {'.mp4', '.mov', '.avi', '.mkv', '.webm'}

        extension = file_path.suffix.lower()
        return extension in image_extensions or extension in video_extensions

    def get_scheduled_post(self, date: Optional[datetime] = None) -> Optional[Dict]:
        """Retorna o post agendado para uma data específica"""
        if date is None:
            date = datetime.now()

        year = date.strftime("%Y")
        month = date.strftime("%m")
        day = date.strftime("%d")

        folder_path = self.base_path / year / month

        # Procurar arquivo de configuração do post
        config_file = folder_path / f"{day}_post.json"
        if config_file.exists():
            with open(config_file, 'r', encoding='utf-8') as f:
                return json.load(f)

        # Se não houver config, criar uma básica com os arquivos encontrados
        files = self.get_today_files()
        if files:
            return {
                'date': date.isoformat(),
                'media_files': [str(f) for f in files],
                'caption': None,  # Será gerada automaticamente
                'hashtags': []
            }

        return None

    def organize_media_by_type(self, files: List[Path]) -> Dict[str, List[Path]]:
        """Organiza arquivos por tipo (imagem/vídeo)"""
        organized = {
            'images': [],
            'videos': []
        }

        video_extensions = {'.mp4', '.mov', '.avi', '.mkv', '.webm'}

        for file in files:
            if file.suffix.lower() in video_extensions:
                organized['videos'].append(file)
            else:
                organized['images'].append(file)

        return organized
