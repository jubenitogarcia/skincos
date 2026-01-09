"""
Modelos alternativos quando T5 não está disponível
"""
import logging

logger = logging.getLogger(__name__)

def get_text_generator():
    """Retorna um gerador de texto que funciona sem sentencepiece"""
    try:
        from transformers import T5ForConditionalGeneration, T5Tokenizer
        tokenizer = T5Tokenizer.from_pretrained('google/flan-t5-small')
        model = T5ForConditionalGeneration.from_pretrained('google/flan-t5-small')
        logger.info("✅ Usando modelo T5")
        return "t5", tokenizer, model
    except ImportError:
        logger.info("⚠️ T5 não disponível, usando GPT-2...")
        from transformers import GPT2LMHeadModel, GPT2Tokenizer
        tokenizer = GPT2Tokenizer.from_pretrained('gpt2')
        model = GPT2LMHeadModel.from_pretrained('gpt2')
        # Adicionar pad_token ao GPT2
        tokenizer.pad_token = tokenizer.eos_token
        return "gpt2", tokenizer, model

def get_vision_model():
    """Retorna modelo de visão disponível"""
    from transformers import BlipProcessor, BlipForConditionalGeneration
    processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
    model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base")
    return processor, model
