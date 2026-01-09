"""
Local LLM Generator - Gerador de legendas usando modelos locais
"""
import os
import logging
import torch

class LocalLLMGenerator:
    def __init__(self, model_name=None):
        # Configurar logging
        logging.basicConfig(level=logging.INFO)
        self.logger = logging.getLogger(__name__)

        # Usar modelos alternativos
        try:
            from .alternative_models import get_text_generator
            self.model_type, self.tokenizer, self.model = get_text_generator()
            self.logger.info(f"✅ Modelo carregado: {self.model_type}")

            # Configurar device
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            self.model = self.model.to(self.device)

        except Exception as e:
            self.logger.error(f"❌ Erro ao carregar modelo: {str(e)}")
            self._setup_fallback()

    def _setup_fallback(self):
        """Configura modelo de fallback em caso de falha"""
        try:
            self.logger.info("⚠️ Configurando modelo de fallback...")
            from transformers import GPT2LMHeadModel, GPT2Tokenizer
            self.tokenizer = GPT2Tokenizer.from_pretrained('gpt2')
            self.model = GPT2LMHeadModel.from_pretrained('gpt2')
            self.tokenizer.pad_token = self.tokenizer.eos_token
            self.model_type = "gpt2"
        except Exception as e:
            self.logger.error(f"❌ Erro ao carregar modelo de fallback: {str(e)}")
            self.tokenizer = None
            self.model = None

    def format_prompt(self, transcription, visual_description):
        """Formata o prompt com base no tipo de modelo"""
        # Limitar tamanho para evitar exceder limites do modelo
        transcription_summary = transcription[:300] if len(transcription) > 300 else transcription
        visual_summary = visual_description[:200] if len(visual_description) > 200 else visual_description

        if self.is_t5:
            # Formato para modelos T5
            return f"""
Tarefa: Criar uma legenda para Instagram
Transcrição: {transcription_summary}
Descrição visual: {visual_summary}
Instruções: Crie uma legenda envolvente para Instagram com emojis e hashtags em português.
"""
        else:
            # Formato para modelos GPT/OPT
            return f"""
Este é um vídeo para Instagram.

Transcrição de áudio: {transcription_summary}

Descrição visual: {visual_summary}

Crie uma legenda atraente para Instagram com:
- Uma frase de gancho no início
- Emojis relevantes
- Hashtags em português
- Estilo envolvente e conversacional
- No máximo 150 palavras

Legenda:
"""

    def generate_caption(self, transcription, visual_description=""):
        """Gera uma legenda para Instagram com base na transcrição e descrição visual"""
        self.logger.info("📝 Gerando legenda...")

        if not self.model or not self.tokenizer:
            return "Não foi possível gerar legenda. Modelo LLM não disponível."

        try:
            # Preparar prompt baseado no tipo de modelo
            if self.model_type == "t5":
                prompt = f"Create Instagram caption: {transcription[:200]} Visual: {visual_description[:100]}"
                inputs = self.tokenizer(prompt, return_tensors="pt", max_length=512, truncation=True)
                inputs = {k: v.to(self.device) for k, v in inputs.items()}

                outputs = self.model.generate(**inputs, max_length=150, temperature=0.8, do_sample=True)
                raw_caption = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
            else:  # GPT-2
                prompt = f"Instagram post about {transcription[:150]} and {visual_description[:50]}"
                inputs = self.tokenizer(prompt, return_tensors="pt", truncation=True, padding=True)
                inputs = {k: v.to(self.device) for k, v in inputs.items()}

                outputs = self.model.generate(
                    **inputs,
                    max_length=len(prompt.split()) + 50,
                    temperature=0.8,
                    pad_token_id=self.tokenizer.eos_token_id,
                    do_sample=True,
                    top_p=0.9
                )
                raw_caption = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
                # Remover o prompt da resposta
                raw_caption = raw_caption.replace(prompt, "").strip()

            # Melhorar a legenda
            caption = self._enhance_caption(raw_caption)
            self.logger.info("✅ Legenda gerada com sucesso")

            return caption

        except Exception as e:
            self.logger.error(f"Erro na geração de legenda: {str(e)}")
            return "Não foi possível gerar uma legenda automática."

    def _enhance_caption(self, caption):
        """Melhora a legenda adicionando hashtags se necessário"""
        # Se não tiver hashtags, adicionar algumas gerais
        if "#" not in caption:
            caption += "\n\n#reels #instagram #viral #trend #brasil"

        # Limitar tamanho
        words = caption.split()
        if len(words) > 150:
            caption = " ".join(words[:150])

        return caption.strip()

# Configuração alternativa para modelos Llama mais poderosos
class LlamaGenerator:
    """Implementação opcional para usar Llama via llama-cpp-python"""

    def __init__(self, model_path=None):
        self.logger = logging.getLogger(__name__)

        try:
            from llama_cpp import Llama

            # Procurar modelo
            if not model_path:
                models_dir = "./models"
                potential_models = [
                    os.path.join(models_dir, f)
                    for f in os.listdir(models_dir)
                    if f.endswith(".gguf")
                ] if os.path.exists(models_dir) else []

                if potential_models:
                    model_path = potential_models[0]
                else:
                    self.logger.error("❌ Nenhum modelo Llama encontrado")
                    self.llama = None
                    return

            # Carregar modelo
            self.logger.info(f"🦙 Carregando modelo Llama: {model_path}")
            self.llama = Llama(
                model_path=model_path,
                n_ctx=2048,
                n_threads=4,
                n_gpu_layers=0  # Alterar conforme disponibilidade de GPU
            )
        except ImportError:
            self.logger.error("❌ llama-cpp-python não está instalado")
            self.llama = None
        except Exception as e:
            self.logger.error(f"❌ Erro ao carregar Llama: {str(e)}")
            self.llama = None

    def generate_caption(self, transcription, visual_description=""):
        """Gera legenda usando Llama"""
        if not self.llama:
            return "Não foi possível gerar legenda. Modelo Llama não disponível."

        # Preparar prompt
        prompt = f"""[INST] <<SYS>>
Você é um especialista em criar legendas virais para Instagram Reels.
<</SYS>>

TRANSCRIÇÃO DO ÁUDIO:
{transcription[:500]}

DESCRIÇÃO VISUAL:
{visual_description[:300]}

Crie uma legenda perfeita para Instagram com:
1. Gancho atraente na primeira linha
2. Emojis relevantes
3. Hashtags em português
4. Tom natural e autêntico

Legenda: [/INST]"""

        # Gerar texto
        try:
            output = self.llama(
                prompt,
                max_tokens=300,
                temperature=0.7,
                top_p=0.9,
                repeat_penalty=1.1,
                stop=["[INST]"]
            )

            return output['choices'][0]['text'].strip()
        except Exception as e:
            self.logger.error(f"Erro na geração com Llama: {str(e)}")
            return "Não foi possível gerar uma legenda com Llama."
