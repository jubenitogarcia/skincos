"""
Sistema de download de gráficos do Google Sheets.

ESTRATÉGIA ÚNICA: embed/get/chart (conforme recomendação oficial do Google)

O sistema utiliza exclusivamente o método recomendado pelo Google para download de gráficos.
Outras estratégias foram movidas para o arquivo downloads_backup_strategies.py.
"""

import os
import time
import requests
import logging
from pathlib import Path
from typing import Optional
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from ..gapis import GoogleSheetsService, GoogleAuthService
from ..validation import ChartValidator
from config import ConfigManager, EnvironmentDetector

logger = logging.getLogger(__name__)

class ChartDownloader:
    """
    Sistema para download de gráficos do Google Sheets

    Estratégia única (recomendação oficial do Google):
    - embed/get/chart endpoint com token OAuth2

    Conforme solicitado, outras estratégias de download foram removidas e
    mantidas como referência no arquivo downloads_backup_strategies.py

    Implementações de resiliência:
    - Retry com backoff exponencial para evitar erros de conexão como "Broken pipe"
    - Maior timeout para requisições
    - Pooling de conexões otimizado
    """

    def __init__(self):
        self.validator = ChartValidator()
        backend_dir = Path(__file__).resolve().parents[4]
        var_dir = Path(os.environ.get("VAR_DIR", str(backend_dir / "var")))
        self.download_dir = str(var_dir / "whatsapp" / "sales_chart_messenger" / "downloads")
        os.makedirs(self.download_dir, exist_ok=True)

        # Criar session com retry para evitar erros de "Broken pipe"
        self._session = self._create_resilient_session()

    def get_chart_public_url(self, chart_id: str) -> Optional[str]:
        """Baixa o gráfico localmente e faz upload para o Cloudinary, retornando a URL pública."""
        from ..utils.cloudinary_upload import upload_image_to_cloudinary
        spreadsheet_id = GoogleSheetsService.get_spreadsheet_id()
        url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/embed/oimg?id={spreadsheet_id}&oid={chart_id}&disposition=ATTACHMENT&format=png"

        # Baixar a imagem localmente
        local_path = os.path.join(self.download_dir, f"chart_{chart_id}.png")
        try:
            response = self._session.get(url, timeout=(30, 120), stream=True)
            if response.status_code == 200:
                with open(local_path, 'wb') as f:
                    for chunk in response.iter_content(1024):
                        f.write(chunk)
                # Upload para Cloudinary
                public_url = upload_image_to_cloudinary(local_path)
                os.remove(local_path)
                return public_url
            else:
                logger.error(f"❌ Falha ao baixar gráfico para upload: {response.status_code}")
                return None
        except Exception as e:
            logger.error(f"❌ Erro ao baixar/upload gráfico: {e}")
            if os.path.exists(local_path):
                os.remove(local_path)
            return None

    # Mantém o método antigo para compatibilidade, mas recomenda-se usar get_chart_public_url
    def download_chart(self, chart_id: str, max_retries: int = 3) -> Optional[str]:
        logger.info("⚠️ download_chart está obsoleto. Use get_chart_public_url para WhatsApp.")
        return None

    def _get_access_token(self) -> Optional[str]:
        """Obtém token OAuth2 para autenticação"""
        try:
            config = ConfigManager.get_config()
            scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly',
                     'https://www.googleapis.com/auth/drive.readonly']
            return GoogleAuthService.get_access_token(config, scopes)
        except Exception as e:
            logger.debug(f"Token OAuth2 não disponível: {e}")
            return None

    def _download_via_chart_endpoint(self, chart_id: str, spreadsheet_id: str) -> Optional[str]:
        """MÉTODO ÚNICO: Download usando endpoints otimizados para gráficos (endpoint com maior sucesso em logs)"""
        logger.info("📊 Método Único - Chart Endpoint com priorização de /embed/oimg")

        try:
            # Obter token OAuth2 para autenticação
            access_token = self._get_access_token()
            if not access_token:
                logger.warning("⚠️ Token OAuth2 não disponível para endpoint privado")
                return None

            # Detectar ambiente (ajuste de headers)
            is_github_actions = EnvironmentDetector.is_github_actions()

            # URLs de gráficos priorizadas pelo sucesso observado em logs
            urls_to_try = [
                # Prioridade 1: URL /embed/oimg (observada como a mais estável em logs)
                f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/embed/oimg?id={spreadsheet_id}&oid={chart_id}&disposition=ATTACHMENT&bo=false&zx={int(time.time())}",
                # Prioridade 2: URL /embed/oimg sem o parâmetro bo=false
                f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/embed/oimg?id={spreadsheet_id}&oid={chart_id}&disposition=ATTACHMENT&zx={int(time.time())}",
                # Prioridade 3: Endpoint embed/get/chart (anteriormente usado)
                f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/embed/get/chart?oid={chart_id}&format=png",
                # Prioridade 4: URL alternativa com format=image
                f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/embed/get/chart?oid={chart_id}&format=image",
                # Prioridade 5: URL com parâmetros extras para melhor qualidade
                f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/embed/get/chart?oid={chart_id}&format=png&w=800&h=600",
            ]

            # Headers otimizados baseados em análise de logs
            headers = {
                'Authorization': f'Bearer {access_token}',
                'Accept': 'image/png,image/jpeg,image/*,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Sec-Fetch-Dest': 'image',
                'Sec-Fetch-Mode': 'no-cors',
                'Sec-Fetch-Site': 'cross-site'
            }

            # Ajustes para GitHub Actions
            if is_github_actions:
                headers.update({
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9'
                })

            # Usar session resiliente com retry já configurado
            session = self._session

            for i, url in enumerate(urls_to_try, 1):
                # Ajustar headers específicos para endpoints /embed/oimg
                current_headers = headers.copy()

                if 'embed/oimg' in url:
                    logger.info(f"🎯 {i}/{len(urls_to_try)}: Usando endpoint /embed/oimg (prioridade mais alta)")
                    current_headers.update({
                        'Accept': 'image/png,image/webp,image/avif,image/apng,image/*,*/*;q=0.8',
                        'Referer': f'https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit',
                        'Sec-Fetch-Dest': 'image',
                        'Sec-Fetch-Mode': 'no-cors',
                        'Sec-Fetch-Site': 'same-origin'
                    })

                    if is_github_actions:
                        logger.info(f"🤖 Usando headers otimizados para /embed/oimg no GitHub Actions")
                else:
                    logger.info(f"🎯 {i}/{len(urls_to_try)}: Usando endpoint embed/get/chart (fallback)")

                try:
                    # Aumentar timeout para evitar Broken pipe
                    response = session.get(
                        url,
                        headers=current_headers,
                        timeout=(30, 120),  # (connect timeout, read timeout)
                        allow_redirects=True,
                        stream=False  # Evita streaming para prevenir broken pipe
                    )

                    logger.info(f"📊 Status: {response.status_code}")
                    logger.info(f"📊 Content-Type: {response.headers.get('content-type', 'N/A')}")
                    logger.info(f"📊 Content-Length: {len(response.content)} bytes")

                    if response.status_code == 200:
                        content_type = response.headers.get('content-type', '')
                        content = response.content

                        # Verificar se recebeu HTML (erro de autenticação/permissão)
                        if b'<!DOCTYPE' in content[:100] or b'<html' in content[:100]:
                            logger.warning(f"⚠️ Recebeu HTML em vez de imagem (tentativa {i})")
                            # Salvar HTML para debug
                            html_debug_path = os.path.join(self.download_dir, f"debug_chart_{chart_id}_{i}.html")
                            with open(html_debug_path, 'wb') as f:
                                f.write(content[:2000])  # Primeiros 2KB
                            logger.debug(f"🔍 HTML salvo para debug: {html_debug_path}")
                            continue

                        # Verificar se é uma imagem válida
                        if ('image' in content_type.lower() or 'octet-stream' in content_type) and len(content) > 1000:
                            # Verificar assinatura PNG
                            if content.startswith(b'\x89PNG\r\n\x1a\n'):
                                # Validar conteúdo com nosso validador
                                if self.validator.validate_from_bytes(content, chart_id):
                                    # Salvar arquivo
                                    file_path = os.path.join(self.download_dir, f"chart_{chart_id}.png")
                                    with open(file_path, 'wb') as f:
                                        f.write(content)

                                    # Validação final
                                    if self.validator.validate_chart_file(file_path, chart_id):
                                        logger.info(f"✅ SUCESSO - Chart baixado via {url} ({len(content)/1024:.1f} KB)")
                                        return file_path
                                    else:
                                        logger.warning(f"⚠️ Validação final falhou")
                                        os.remove(file_path)
                                        continue
                                else:
                                    logger.warning(f"⚠️ Validação de bytes falhou (tentativa {i})")
                                    continue
                            else:
                                logger.warning(f"⚠️ Não é um PNG válido (tentativa {i})")
                                continue
                        else:
                            logger.warning(f"⚠️ Conteúdo inválido: {content_type}, {len(content)} bytes")
                            continue

                    elif response.status_code == 403:
                        logger.warning(f"⚠️ Acesso negado (403) - gráfico pode estar privado")
                    elif response.status_code == 404:
                        logger.warning(f"⚠️ Gráfico não encontrado (404) - verificar chart_id")
                    elif response.status_code == 401:
                        logger.warning(f"⚠️ Não autorizado (401) - problema com OAuth2")
                    else:
                        logger.warning(f"⚠️ Erro HTTP {response.status_code}")

                except BrokenPipeError as e:
                    logger.warning(f"⚠️ Broken pipe na requisição {i}: {e}")
                    logger.info("💡 Esperando antes de tentar novamente...")
                    time.sleep(3)  # Espera 3 segundos antes de tentar novamente
                    continue
                except requests.exceptions.ConnectionError as e:
                    logger.warning(f"⚠️ Erro de conexão na requisição {i}: {e}")
                    logger.info("💡 Esperando antes de tentar novamente...")
                    time.sleep(2)
                    continue
                except requests.exceptions.ReadTimeout as e:
                    logger.warning(f"⚠️ Timeout na leitura da requisição {i}: {e}")
                    continue
                except requests.exceptions.RequestException as e:
                    logger.warning(f"⚠️ Erro na requisição {i}: {e}")
                    continue

            logger.warning("⚠️ MÉTODO ÚNICO FALHOU - Todas as tentativas falharam")
            return None

        except Exception as e:
            logger.error(f"❌ Erro no método download_via_chart_endpoint: {e}")
            return None

    def _create_resilient_session(self):
        """Cria uma sessão HTTP resiliente com retry para evitar erros de conexão"""
        session = requests.Session()

        # Configurar retry com backoff exponencial
        # Incluir explicitamente o código 104 (Connection reset by peer / Broken pipe)
        retries = Retry(
            total=5,  # número total de tentativas
            backoff_factor=0.5,  # fator de backoff (em segundos)
            status_forcelist=[429, 500, 502, 503, 504],  # códigos HTTP para retry
            allowed_methods=["GET", "POST"],  # métodos permitidos
            raise_on_status=False,  # não levanta exceção para status
            respect_retry_after_header=True  # respeita o header Retry-After
        )

        # Usar adapter com retry e timeout configuráveis
        adapter = HTTPAdapter(
            max_retries=retries,
            pool_connections=3,  # conexões simultâneas
            pool_maxsize=10,  # tamanho máximo do pool
            pool_block=False  # não bloquear quando o pool estiver cheio
        )

        # Aplicar o adapter para todos os URLs
        session.mount("https://", adapter)
        session.mount("http://", adapter)        # Adicionar propriedades que ajudam a prevenir erros de pipe
        session.trust_env = False  # não usar variáveis de ambiente

        # Headers que ajudam a evitar broken pipe em algumas implementações HTTP
        session.headers.update({
            'Connection': 'keep-alive',
            'Keep-Alive': '300',  # 5 minutos
            'Accept-Encoding': 'gzip, deflate'
        })

        logger.info("🔌 Sessão HTTP resiliente criada com retry e backoff aprimorados")
        return session
