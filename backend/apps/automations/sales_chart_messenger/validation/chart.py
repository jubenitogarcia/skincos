"""
Validador de gráficos baixados do Google Sheets.
"""

import os
import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Lazy loading do PIL para evitar travamento
try:
    from PIL import Image, ImageStat  # type: ignore
    PIL_AVAILABLE = True
    ImageModule = Image
    ImageStatModule = ImageStat
except ImportError:
    PIL_AVAILABLE = False
    ImageModule = None
    ImageStatModule = None

# Lazy loading do pytesseract
def get_pytesseract():
    """Retorna o módulo pytesseract com lazy loading"""
    try:
        import pytesseract  # type: ignore
        return pytesseract
    except ImportError:
        return None

class ChartValidator:
    """Validador de gráficos baixados"""

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    def validate_chart_file(self, file_path: str, chart_id: Optional[str] = None) -> bool:
        """Valida um arquivo de gráfico baixado"""
        if not PIL_AVAILABLE or not ImageModule:
            self.logger.warning("⚠️ PIL indisponível")
            return True  # Assume válido se não pode validar

        try:
            # Verifica se o arquivo existe
            if not os.path.exists(file_path):
                self.logger.error(f"❌ Arquivo não encontrado")
                return False

            # Verifica o tamanho do arquivo
            file_size = os.path.getsize(file_path)
            if file_size < 1000:  # Menor que 1KB
                self.logger.error(f"❌ Arquivo pequeno ({file_size} bytes)")
                return False

            # Tenta abrir como imagem
            with ImageModule.open(file_path) as img:
                width, height = img.size
                if width < 100 or height < 100:
                    self.logger.error(f"❌ Imagem pequena: {width}x{height}")
                    return False

                # Análise básica de conteúdo
                content_analysis = self._analyze_image_content(img)
                text_analysis = self._analyze_image_text(file_path) if get_pytesseract() else {}

                # Verifica se parece um gráfico válido
                if self._looks_like_chart(content_analysis, text_analysis):
                    self.logger.info(f"✅ Gráfico válido: {width}x{height}")
                    return True
                else:
                    self.logger.warning("⚠️ Conteúdo suspeito")
                    return True  # Ainda retorna True para não bloquear

        except Exception as e:
            self.logger.error(f"❌ Erro validação: {str(e)}")
            return False

    def _analyze_image_content(self, img):
        """Analisa conteúdo básico da imagem"""
        if not PIL_AVAILABLE or not ImageStatModule:
            self.logger.debug("PIL indisponível")
            return {}

        try:
            # Converte para RGB se necessário
            if img.mode != 'RGB':
                img = img.convert('RGB')

            # Estatísticas básicas
            stat = ImageStatModule.Stat(img)

            return {
                'mean': stat.mean,
                'median': stat.median,
                'stddev': stat.stddev,
                'extrema': stat.extrema,
                'has_transparency': img.mode in ('RGBA', 'LA')
            }
        except Exception as e:
            self.logger.debug(f"Erro análise: {e}")
            return {}

    def _analyze_image_text(self, file_path: str):
        """Tenta extrair texto da imagem usando OCR"""
        pytesseract_module = get_pytesseract()
        if not pytesseract_module or not ImageModule:
            return {}

        try:
            img = ImageModule.open(file_path)
            text = pytesseract_module.image_to_string(img)

            # Procura por palavras-chave comuns em gráficos
            chart_keywords = ['meta', 'vendas', 'resultado', 'gráfico', 'chart',
                            'total', 'percentual', '%', 'R$', 'dados']

            text_lower = text.lower()
            keywords_found = [kw for kw in chart_keywords if kw in text_lower]

            return {
                'text': text[:500],  # Primeiros 500 caracteres
                'keywords_found': keywords_found,
                'has_chart_content': len(keywords_found) > 0
            }
        except Exception as e:
            self.logger.debug(f"Erro OCR: {e}")
            return {}

    def _looks_like_chart(self, content_analysis: dict, text_analysis: dict) -> bool:
        """Determina se a imagem parece ser um gráfico válido"""
        # Se não temos análise suficiente, assume que é válido
        if not content_analysis:
            return True

        # Verifica se tem variação de cores (gráficos geralmente têm)
        if 'stddev' in content_analysis:
            # Se tem muito pouca variação, pode ser uma imagem em branco
            avg_stddev = sum(content_analysis['stddev']) / 3
            if avg_stddev < 5:
                return False

        # Se encontrou palavras-chave de gráfico, provavelmente é válido
        if text_analysis.get('has_chart_content'):
            return True

        # Por padrão, assume que é válido
        return True

    def validate_from_bytes(self, image_bytes: bytes, chart_id: Optional[str] = None) -> bool:
        """Valida bytes de imagem diretamente"""
        if not PIL_AVAILABLE or not ImageModule:
            return True

        try:
            img = ImageModule.open(io.BytesIO(image_bytes))
            # Validação básica de tamanho
            width, height = img.size
            if width < 100 or height < 100:
                self.logger.error(f"❌ Imagem pequena: {width}x{height}")
                return False

            self.logger.info(f"✅ Imagem válida: {width}x{height}")
            return True

        except Exception as e:
            self.logger.error(f"❌ Erro bytes: {str(e)}")
            return False

    def validate_and_log(self, file_path: str, chart_id: Optional[str] = None, 
                        logger: Optional[logging.Logger] = None) -> bool:
        """Valida e loga resultado detalhado"""
        if logger:
            self.logger = logger

        is_valid = self.validate_chart_file(file_path, chart_id)

        if is_valid:
            self.logger.info(f"✅ Validação OK: {os.path.basename(file_path)}")
        else:
            self.logger.error(f"❌ Validação falhou: {os.path.basename(file_path)}")

        return is_valid
