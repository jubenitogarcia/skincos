import datetime
from functools import cached_property

from ..services.github_uploader import upload_media_to_github_pages
from ..services.instagram_api import InstagramAPI
from ..services.media_analyzer import MediaAnalyzer
from libs.google import build_drive_service

class AutomationManager:
    """
    Orquestra o fluxo principal de automação: coleta de posts, upload para GitHub Pages, geração de legenda e publicação no Instagram.
    """
    def __init__(self, config_manager, real_mode=False):
        self.config = config_manager
        self.real_mode = real_mode
        self.media_analyzer = MediaAnalyzer()
        self.instagram_api = InstagramAPI(config_manager.instagram)
        # TODO: Adicionar GoogleDriveAPI se modularizado

    @cached_property
    def drive_service(self):
        return build_drive_service(self.config.google.credentials, cache_discovery=False)

    def start(self):
        today = datetime.datetime.now()
        year = str(today.year)
        month = f"{today.month:02d}"
        day = f"{today.day:02d}"

        scheduled_id = "10FJgSsSdRcvrkB6m2NbUeROqBtmrysSN"
        year_folder = self._get_or_create_drive_folder(scheduled_id, year)
        month_folder = self._get_or_create_drive_folder(year_folder, month)
        files = self._find_files_for_day(month_folder, day)
        posts = self._group_files_by_post(files, day)

        for post in posts:
            local_paths = [self._download_and_optimize(f) for f in post['files']]
            captions = []
            for path in local_paths:
                if self._is_video(path):
                    # Extração de áudio e transcrição
                    audio_text = self.media_analyzer._extract_audio_description(path)
                    # Análise visual do vídeo
                    visual_desc = self.media_analyzer._extract_visual_description(path)
                    # Geração de legenda combinada
                    caption = self.media_analyzer._generate_llm_caption(audio_text, visual_desc)
                else:
                    # Análise de imagem
                    visual_desc = self.media_analyzer.analyze_image(path)
                    # Geração de legenda para imagem
                    caption = self.media_analyzer.generate_caption(path, media_type='IMAGE')
                captions.append(caption)

            public_urls = []
            for path in local_paths:
                url = upload_media_to_github_pages(
                    file_path=path,
                    github_token=self.config.github.token,
                    repo_name=self.config.github.repo,
                    github_pages_url=self.config.github.pages_url,
                    wait_time=30 if not self._is_video(path) else 60
                )
                public_urls.append(url)

            if self.real_mode:
                self.instagram_api.publish(post, public_urls, captions)
            else:
                print(f"[TESTE] Publicaria no Instagram: {public_urls} | {captions}")

    # Métodos auxiliares (assinaturas e comentários)
    def _get_or_create_drive_folder(self, parent_id, name):
        """Busca ou cria uma pasta no Google Drive."""
        service = self.drive_service
        # Busca pasta
        query = f"'{parent_id}' in parents and name = '{name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        results = service.files().list(q=query, spaces='drive', fields='files(id, name)', pageSize=1).execute()
        files = results.get('files', [])
        if files:
            return files[0]['id']
        # Cria pasta se não existir
        file_metadata = {
            'name': name,
            'mimeType': 'application/vnd.google-apps.folder',
            'parents': [parent_id]
        }
        folder = service.files().create(body=file_metadata, fields='id').execute()
        return folder.get('id')

    def _find_files_for_day(self, folder_id, day):
        """Busca arquivos do dia DD no Google Drive."""
        service = self.drive_service
        # Busca arquivos do dia
        query = f"'{folder_id}' in parents and name contains '{day}' and trashed = false"
        results = service.files().list(q=query, spaces='drive', fields='files(id, name, mimeType, size)', pageSize=100).execute()
        files = results.get('files', [])
        return files

    def _group_files_by_post(self, files, day):
        """Agrupa arquivos em posts simples ou carrossel conforme a nomenclatura."""
        import re
        from collections import defaultdict
        # Exemplo de nomes: 20.1, 20.2, 20.1 (1), 20.1 (2)
        post_map = defaultdict(list)
        pattern = re.compile(rf"^{day}\.([0-9]+)(?: \(([0-9]+)\))?")
        for f in files:
            match = pattern.match(f['name'])
            if match:
                post_id = match.group(1)
                carrossel_idx = match.group(2)
                key = f"{day}.{post_id}"
                if carrossel_idx:
                    # Carrossel: agrupa por post_id e ordena depois pelo índice
                    post_map[key].append((int(carrossel_idx), f))
                else:
                    # Post simples
                    post_map[key].append((0, f))
        posts = []
        for key, files_list in post_map.items():
            # Ordena arquivos de carrossel pelo índice (ou 0 para post simples)
            files_sorted = [f for _, f in sorted(files_list)]
            posts.append({'post_id': key, 'files': files_sorted})
        return posts

    def _download_and_optimize(self, file):
        """Baixa o arquivo do Drive e otimiza se necessário (ex: vídeo > 100MB)."""
        import tempfile
        import os
        import mimetypes

        service = self.drive_service
        # Baixa o arquivo
        request = service.files().get_media(fileId=file['id'])
        ext = mimetypes.guess_extension(file.get('mimeType', '')) or '.bin'
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as f:
            downloader = None
            try:
                from googleapiclient.http import MediaIoBaseDownload
                downloader = MediaIoBaseDownload(f, request)
                done = False
                while not done:
                    status, done = downloader.next_chunk()
            except Exception as e:
                print(f"Erro ao baixar arquivo do Drive: {e}")
                return None
            local_path = f.name
        # Se for vídeo e maior que 100MB, otimiza
        if self._is_video(local_path) and os.path.getsize(local_path) > 100*1024*1024:
            local_path = self._optimize_video(local_path)
        return local_path

    def _optimize_video(self, video_path):
        """Otimiza vídeo para reduzir tamanho, resolução e bitrate."""
        import tempfile
        import os
        import subprocess
        optimized_path = tempfile.mktemp(suffix='.mp4')
        # Exemplo de comando ffmpeg para reduzir qualidade
        cmd = [
            'ffmpeg', '-i', video_path,
            '-vf', 'scale=640:-2',
            '-b:v', '800k',
            '-r', '24',
            '-preset', 'veryfast',
            '-y', optimized_path
        ]
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if os.path.getsize(optimized_path) < os.path.getsize(video_path):
                os.remove(video_path)
                return optimized_path
            else:
                os.remove(optimized_path)
                return video_path
        except Exception as e:
            print(f"Erro ao otimizar vídeo: {e}")
            return video_path

    def _is_video(self, path):
        """Detecta se o arquivo é vídeo pelo mimetype/extensão."""
        import mimetypes
        ext = path.split('.')[-1].lower()
        video_exts = {'mp4', 'mov', 'avi', 'mkv', 'webm'}
        if ext in video_exts:
            return True
        mime, _ = mimetypes.guess_type(path)
        if mime and mime.startswith('video'):
            return True
        return False
