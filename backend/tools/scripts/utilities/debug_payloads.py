#!/usr/bin/env python3
"""
Debug detalhado para comparar teste direto vs automação
"""

import logging
from automation import AutomationExecutor
from libs.whatsapp import MessageSender
from config import ConfigManager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger()

def compare_payloads():
    """Compara payloads do teste direto vs automação"""

    print("🔍 ANÁLISE COMPARATIVA: Teste Direto vs Automação")
    print("=" * 60)

    # 1. Teste direto (que funcionou)
    print("\n1️⃣ TESTE DIRETO (funcionou):")
    config = ConfigManager.get_config()
    test_phone = config.get('global', {}).get('test_phone_number')
    test_image = "https://res.cloudinary.com/do981y6g1/image/upload/v1754426106/o4ixnewrznt0ty67hzvu.png"

    direct_payload = {
        "number": test_phone,
        "message": "🧪 TESTE: Imagem enviada via API diretamente!",
        "mediaUrl": test_image,
        "type": "media"
    }
    print(f"📤 Payload direto: {direct_payload}")

    # 2. Executar automação e interceptar payload
    print("\n2️⃣ AUTOMAÇÃO (problemas?):")

    # Substituir cliente para interceptar
    class InterceptClient:
        def __init__(self, original_client):
            self.original = original_client

        def send_media(self, phone_number, media_url, caption, **kwargs):
            print(f"📞 Phone: {phone_number}")
            print(f"🖼️ Media URL: {media_url}")
            print(f"📝 Caption: {caption[:100]}...")
            print(f"🎯 Kwargs: {kwargs}")

            # Chamar método original
            return self.original.send_media(phone_number, media_url, caption, **kwargs)

        def send_message(self, phone_number, message, **kwargs):
            print(f"📞 Phone: {phone_number}")
            print(f"📝 Message: {message[:100]}...")
            print(f"🎯 Kwargs: {kwargs}")

            # Chamar método original
            return self.original.send_message(phone_number, message, **kwargs)

    # Substituir na automação
    executor = AutomationExecutor()
    original_client = executor.message_sender.client
    executor.message_sender.client = InterceptClient(original_client)

    print("🚀 Executando automação interceptada...")
    try:
        result = executor.execute_morning('nh', test_mode=True)
        print(f"✅ Resultado: {result.get('type', 'unknown') if isinstance(result, dict) else 'N/A'}")
    except Exception as e:
        print(f"❌ Erro: {e}")

    print("\n" + "=" * 60)
    print("🎯 COMPARAÇÃO CONCLUÍDA")

if __name__ == "__main__":
    compare_payloads()
