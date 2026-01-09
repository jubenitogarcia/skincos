"""
Video Analyzer - Módulo principal para processamento de vídeos e geração de legendas
"""
import os
import logging
import json
import time
from .media_processor import MediaProcessor
from .vision_analyzer import VisionAnalyzer
from .cloud_llm_generator import LocalLLMGenerator, LlamaGenerator

class VideoAnalyzer:
    def __init__(self, use_llama=False):
        # Configurar logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        self.logger = logging.getLogger(__name__)

        # Inicializar componentes
        self.media_processor = MediaProcessor()
        self.vision_analyzer = VisionAnalyzer()

        # Escolher LLM
        if use_llama:
            # Tentar carregar Llama
            self.llm_generator = LlamaGenerator()
            if not hasattr(self.llm_generator, 'llama') or self.llm_generator.llama is None:
                self.logger.warning("⚠️ Llama não disponível, usando modelo alternativo")
                self.llm_generator = LocalLLMGenerator()
        else:
            # Usar modelo HuggingFace
            self.llm_generator = LocalLLMGenerator()

        self.logger.info("✅ VideoAnalyzer inicializado com sucesso")

    def process_video(self, video_path):
        """
        Processa vídeo completo:
        1. Extrai áudio e frames
        2. Transcreve áudio
        3. Analisa conteúdo visual
        4. Gera legenda
        """
        if not os.path.exists(video_path):
            self.logger.error(f"❌ Arquivo não encontrado: {video_path}")
            return {
                "status": "error",
                "error": f"Arquivo não encontrado: {video_path}"
            }

        try:
            start_time = time.time()
            self.logger.info(f"🎬 Processando vídeo: {video_path}")

            # 1. Extrair áudio
            audio_path = self.media_processor.extract_audio(video_path)

            # 2. Extrair frames-chave
            frames, duration = self.media_processor.extract_key_frames(video_path, max_frames=5)

            # 3. Transcrever áudio
            transcription = self.media_processor.transcribe_audio(audio_path)

            # 4. Analisar frames para descrição visual
            visual_description = self.vision_analyzer.detect_scene_context(frames)

            # 5. Gerar legenda
            caption = self.llm_generator.generate_caption(transcription, visual_description)

            # 6. Limpar arquivos temporários
            self.media_processor.cleanup_temp_files([audio_path])

            # 7. Resultado final
            processing_time = time.time() - start_time

            result = {
                "status": "success",
                "caption": caption,
                "transcription": transcription,
                "visual_description": visual_description,
                "processing_time": f"{processing_time:.2f} segundos",
                "video_duration": f"{duration:.2f} segundos"
            }

            self.logger.info(f"✅ Processamento concluído em {processing_time:.2f} segundos")
            return result

        except Exception as e:
            self.logger.error(f"❌ Erro no processamento: {str(e)}")
            return {
                "status": "error",
                "error": str(e)
            }

    def save_result(self, result, output_path):
        """Salva o resultado em um arquivo JSON"""
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            self.logger.info(f"✅ Resultado salvo em: {output_path}")
            return True
        except Exception as e:
            self.logger.error(f"❌ Erro ao salvar resultado: {str(e)}")
            return False
