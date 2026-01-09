"""
Vision Analyzer - Análise visual de imagens e frames de vídeo
"""
import os
import logging
import numpy as np
import torch
from PIL import Image
from transformers import BlipProcessor, BlipForConditionalGeneration

class VisionAnalyzer:
    def __init__(self):
        # Configurar logging
        logging.basicConfig(level=logging.INFO)
        self.logger = logging.getLogger(__name__)

        # Inicializar modelo BLIP para análise de imagens
        self.logger.info("🖼️ Carregando modelo BLIP para análise visual...")

        # Usar modelo menor para economizar memória
        model_name = "Salesforce/blip-image-captioning-base"

        try:
            self.blip_processor = BlipProcessor.from_pretrained(model_name)
            self.blip_model = BlipForConditionalGeneration.from_pretrained(
                model_name,
                torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32
            )

            if torch.cuda.is_available():
                self.device = "cuda"
                self.blip_model = self.blip_model.to(self.device)
            else:
                self.device = "cpu"

            self.logger.info(f"✅ Modelo BLIP carregado no dispositivo: {self.device}")
        except Exception as e:
            self.logger.error(f"❌ Erro ao carregar modelo BLIP: {str(e)}")
            raise

    def analyze_image(self, image_array):
        """Analisa uma imagem e retorna descrição detalhada"""
        try:
            # Converter array NumPy para PIL Image
            if isinstance(image_array, np.ndarray):
                image = Image.fromarray(image_array)
            else:
                image = image_array

            # Processar imagem
            inputs = self.blip_processor(images=image, return_tensors="pt").to(self.device)

            # Gerar descrição
            out = self.blip_model.generate(
                **inputs,
                max_length=50,
                num_beams=5,
                num_return_sequences=1
            )

            description = self.blip_processor.decode(out[0], skip_special_tokens=True)
            return description

        except Exception as e:
            self.logger.error(f"Erro na análise de imagem: {str(e)}")
            return "Não foi possível analisar a imagem"

    def analyze_frames(self, frames):
        """Analisa múltiplos frames e retorna descrições"""
        frame_descriptions = []

        for i, frame in enumerate(frames):
            self.logger.info(f"Analisando frame {i+1}/{len(frames)}")
            description = self.analyze_image(frame)
            frame_descriptions.append(description)

        return frame_descriptions

    def detect_scene_context(self, frames):
        """Detecta o contexto geral da cena com base em múltiplos frames"""
        descriptions = self.analyze_frames(frames)

        # Simplificado: apenas retorna a descrição mais completa
        if descriptions:
            longest_description = max(descriptions, key=len)
            return longest_description

        return "Não foi possível determinar o contexto da cena"
