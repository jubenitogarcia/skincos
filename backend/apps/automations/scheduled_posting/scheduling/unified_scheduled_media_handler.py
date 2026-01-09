"""
Handler unificado para mídia agendada - suporta pasta local e Google Drive
"""
import os
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Union, Any
from libs.scheduler_config import scheduled_dir

# Google Drive imports (optional)
google_drive_available = True
try:
    from googleapiclient.http import MediaIoBaseDownload
except ImportError:
    google_drive_available = False


class UnifiedScheduledMediaHandler:
    def __init__(self, config_data: Optional[Dict[str, Any]] = None):
        self.logger = logging.getLogger(__name__)
        self.config = config_data or {}

        # Configurações
        scheduled_config = self.config.get("scheduled_posting", {})
        self.use_google_drive = scheduled_config.get("use_google_drive", False)
        self.base_folder = scheduled_config.get("base_folder")

        # Para pasta local
        self.base_path = Path(self.base_folder) if self.base_folder else scheduled_dir()

        # Para Google Drive
        self.drive_service = None
        self.scheduled_folder_id = self.config.get("drive_scheduled_folder")
        self.published_folder_id = self.config.get("drive_published_folder")

        if self.use_google_drive:
            self._init_google_drive()

        self.logger.info(f"📁 Modo de armazenamento: {'Google Drive' if self.use_google_drive else 'Local'}")

    def _init_google_drive(self):
        """Inicializa o serviço Google Drive"""
        if not google_drive_available:
            self.logger.error("❌ Bibliotecas do Google Drive não disponíveis")
            self.use_google_drive = False
            return

        if not self.scheduled_folder_id:
            self.logger.error("❌ ID da pasta agendada do Google Drive não configurado")
            self.use_google_drive = False
            return

        try:
            google_credentials = (
                self.config.get("google_credentials")
                or self.config.get("google_drive_credentials")
                or {}
            )
            if not google_credentials:
                self.logger.error("❌ Credenciais do Google Drive não encontradas")
                self.use_google_drive = False
                return

            from libs.google import build_drive_service

            self.drive_service = build_drive_service(
                google_credentials,
                scopes=["https://www.googleapis.com/auth/drive"],
                cache_discovery=False,
            )
            self.logger.info("✅ Google Drive inicializado com sucesso")

        except Exception as e:
            self.logger.error(f"❌ Erro ao inicializar Google Drive: {e}")
            self.use_google_drive = False

    def get_today_path(self) -> Union[Path, str]:
        """Retorna o caminho/ID para os arquivos de hoje"""
        now = datetime.now()
        year = now.strftime("%Y")
        month = now.strftime("%m")

        if self.use_google_drive:
            # Para Google Drive, retornamos o ID da pasta
            return self.scheduled_folder_id or ""
        else:
            # Para pasta local
            return self.base_path / year / month

    def get_today_files(self) -> List[Union[Path, Dict]]:
        """Retorna todos os arquivos do dia atual"""
        if self.use_google_drive:
            return self._get_today_files_drive()
        else:
            return self._get_today_files_local()

    def _get_today_files_local(self) -> List[Path]:
        """Busca arquivos na pasta local"""
        today_path = self.get_today_path()
        day = datetime.now().strftime("%d")

        if not today_path.exists():
            self.logger.warning(f"Pasta não encontrada: {today_path}")
            return []

        files = []
        for file in today_path.iterdir():
            if file.is_file() and day in file.name:
                if self._is_media_file_local(file):
                    files.append(file)
                    self.logger.info(f"Arquivo encontrado: {file}")

        return files

    def _get_today_files_drive(self) -> List[Dict]:
        """Busca arquivos no Google Drive"""
        if not self.drive_service or not self.scheduled_folder_id:
            return []

        day = datetime.now().strftime("%d")

        try:
            # Query para buscar arquivos do dia atual
            query = f"'{self.scheduled_folder_id}' in parents and trashed=false and name contains '{day}'"

            results = self.drive_service.files().list(
                q=query,
                fields="files(id, name, createdTime, modifiedTime, mimeType, size, webViewLink)"
            ).execute()

            files = results.get('files', [])
            media_files = []

            for file in files:
                if self._is_media_file_drive(file):
                    media_files.append(file)
                    self.logger.info(f"Arquivo encontrado no Drive: {file['name']}")

            return media_files

        except Exception as e:
            self.logger.error(f"❌ Erro ao buscar arquivos no Google Drive: {e}")
            return []

    def _is_media_file_local(self, file_path: Path) -> bool:
        """Verifica se o arquivo local é uma mídia válida"""
        image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
        video_extensions = {'.mp4', '.mov', '.avi', '.mkv', '.webm'}
        extension = file_path.suffix.lower()
        return extension in image_extensions or extension in video_extensions

    def _is_media_file_drive(self, file_info: Dict) -> bool:
        """Verifica se o arquivo do Drive é uma mídia válida"""
        mime_type = file_info.get('mimeType', '')
        return (mime_type.startswith('image/') or
                mime_type.startswith('video/'))

    def download_drive_file(self, file_id: str, destination: Path) -> bool:
        """Download de arquivo do Google Drive para pasta local"""
        if not self.drive_service:
            return False

        try:
            request = self.drive_service.files().get_media(fileId=file_id)

            with open(destination, 'wb') as local_file:
                downloader = MediaIoBaseDownload(local_file, request)
                done = False
                while not done:
                    status, done = downloader.next_chunk()

            self.logger.info(f"✅ Arquivo baixado: {destination}")
            return True

        except Exception as e:
            self.logger.error(f"❌ Erro ao baixar arquivo: {e}")
            return False

    def organize_media_by_type(self, files: List[Union[Path, Dict]]) -> Dict[str, List]:
        """Organiza arquivos por tipo (imagem/vídeo)"""
        organized = {
            'images': [],
            'videos': []
        }

        for file in files:
            if self.use_google_drive:
                # file é um Dict com info do Drive
                mime_type = file.get('mimeType', '')
                if mime_type.startswith('image/'):
                    organized['images'].append(file)
                elif mime_type.startswith('video/'):
                    organized['videos'].append(file)
            else:
                # file é um Path local
                video_extensions = {'.mp4', '.mov', '.avi', '.mkv', '.webm'}
                if file.suffix.lower() in video_extensions:
                    organized['videos'].append(file)
                else:
                    organized['images'].append(file)

        return organized

    def get_scheduled_post(self, date: Optional[datetime] = None) -> Optional[Dict]:
        """Retorna o post agendado para uma data específica"""
        if date is None:
            date = datetime.now()

        if self.use_google_drive:
            return self._get_scheduled_post_drive(date)
        else:
            return self._get_scheduled_post_local(date)

    def _get_scheduled_post_local(self, date: datetime) -> Optional[Dict]:
        """Busca post agendado na pasta local"""
        year = date.strftime("%Y")
        month = date.strftime("%m")
        day = date.strftime("%d")

        folder_path = self.base_path / year / month
        config_file = folder_path / f"{day}_post.json"

        if config_file.exists():
            with open(config_file, 'r', encoding='utf-8') as f:
                return json.load(f)

        # Se não houver config, criar uma básica
        files = self.get_today_files()
        if files:
            return {
                'date': date.isoformat(),
                'media_files': [str(f) for f in files],
                'caption': None,
                'hashtags': [],
                'source': 'local'
            }

        return None

    def _get_scheduled_post_drive(self, date: datetime) -> Optional[Dict]:
        """Busca post agendado no Google Drive"""
        files = self.get_today_files()
        if files:
            return {
                'date': date.isoformat(),
                'media_files': files,  # Lista de dicts com info dos arquivos
                'caption': None,
                'hashtags': [],
                'source': 'drive'
            }
        return None


# Manter compatibilidade com código existente
class ScheduledMediaHandler(UnifiedScheduledMediaHandler):
    """Classe compatível com implementação anterior"""

    def __init__(self, base_path: str | os.PathLike | None = None):
        config_data: Dict[str, Any] = {}
        try:
            from libs.scheduler_config import ConfigManager
            config_data = ConfigManager().data
        except Exception:
            config_data = {}

        # Configurar para usar pasta local por padrão
        if "scheduled_posting" not in config_data:
            config_data["scheduled_posting"] = {}

        config_data["scheduled_posting"]["use_google_drive"] = False
        config_data["scheduled_posting"]["base_folder"] = str(Path(base_path)) if base_path else None

        super().__init__(config_data)
