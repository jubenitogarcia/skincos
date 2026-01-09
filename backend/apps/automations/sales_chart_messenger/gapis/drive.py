"""
Serviço para interação com Google Drive.
"""

import logging
from typing import Optional
from config import ConfigManager
from .auth import GoogleAuthService, get_google_apis

logger = logging.getLogger(__name__)

class GoogleDriveService:
    """Serviço para interação com Google Drive"""
    _service = None

    @classmethod
    def get_service(cls):
        """Retorna serviço autenticado do Google Drive"""
        if cls._service is None:
            cls._service = cls._authenticate()
        return cls._service

    @classmethod
    def _authenticate(cls):
        """Autentica e retorna o serviço"""
        google_apis = get_google_apis()
        if not google_apis:
            raise ImportError("Google APIs não disponíveis")

        config = ConfigManager.get_config()
        scopes = ['https://www.googleapis.com/auth/drive.readonly']

        creds = GoogleAuthService.get_credentials(config, scopes)

        # Construir serviço do Google Drive
        build = google_apis['build']
        service = build('drive', 'v3', credentials=creds, cache_discovery=False)
        logger.info("🔗 Google Drive conectado")

        return service

    @classmethod
    def export_file(cls, file_id: str, mime_type: str) -> Optional[bytes]:
        """Exporta arquivo do Google Drive"""
        try:
            service = cls.get_service()
            request = service.files().export_media(fileId=file_id, mimeType=mime_type)

            # Executar download
            file_data = request.execute()
            return file_data

        except Exception as e:
            logger.error(f"❌ Erro export Drive: {e}")
            return None

    @classmethod
    def download_with_media_downloader(cls, file_id: str, file_path: str, mime_type: str = 'application/pdf'):
        """Download usando MediaIoBaseDownload"""
        google_apis = get_google_apis()
        if not google_apis:
            raise ImportError("Google APIs não disponíveis")

        MediaIoBaseDownload = google_apis['MediaIoBaseDownload']
        service = cls.get_service()

        # Fazer request
        request = service.files().export_media(fileId=file_id, mimeType=mime_type)

        # Usar MediaIoBaseDownload para baixar
        with open(file_path, 'wb') as fh:
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                status, done = downloader.next_chunk()
                if status:
                    logger.info(f"📥 {int(status.progress() * 100)}%")

        logger.info(f"✅ Drive download OK: {file_path}")
        return file_path
