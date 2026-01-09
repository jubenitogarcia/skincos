#!/usr/bin/env python3
"""Testa os modelos instalados"""

print("🧪 Testando modelos instalados...\n")

# Testar Whisper
try:
    from faster_whisper import WhisperModel
    print("✅ Faster-Whisper: OK")
except ImportError as e:
    print(f"❌ Faster-Whisper: {e}")

# Testar BLIP
try:
    from transformers import BlipProcessor
    print("✅ BLIP (Visão): OK")
except ImportError as e:
    print(f"❌ BLIP: {e}")

# Testar modelo de texto
try:
    from apps.automations.scheduled_posting.media.alternative_models import get_text_generator
    model_type, _, _ = get_text_generator()
    print(f"✅ Modelo de texto: OK (usando {model_type})")
except Exception as e:
    print(f"❌ Modelo de texto: {e}")

# Testar PyTorch
try:
    import torch
    print(f"✅ PyTorch: OK (GPU: {torch.cuda.is_available()})")
except ImportError as e:
    print(f"❌ PyTorch: {e}")

# Testar MoviePy
try:
    from moviepy.editor import VideoFileClip
    print("✅ MoviePy: OK")
except ImportError as e:
    print(f"❌ MoviePy: {e}")

# Testar OpenCV
try:
    import cv2
    print("✅ OpenCV: OK")
except ImportError as e:
    print(f"❌ OpenCV: {e}")

print("\n✨ Teste concluído!")
print("\nPara testar o processamento:")
print("python simple_video_processor.py seu_video.mp4")
