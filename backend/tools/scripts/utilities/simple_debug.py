#!/usr/bin/env python3

print("=== DEBUG WHATSAPP MEDIA ===")

try:
    from config import ConfigManager
    print("✅ Config importado")

    config = ConfigManager.get_config()
    test_phone = config.get('global', {}).get('test_phone_number')
    print(f"📞 Phone: {test_phone}")

    from libs.whatsapp import WhatsAppClient
    print("✅ Cliente importado")

    client = WhatsAppClient()
    print("✅ Cliente criado")

    # Teste simples
    test_image = "https://res.cloudinary.com/do981y6g1/image/upload/v1754426106/o4ixnewrznt0ty67hzvu.png"
    test_caption = "Debug test"

    print(f"🖼️ Imagem: {test_image}")
    print(f"📝 Caption: {test_caption}")

    print("🚀 Enviando...")
    response = client.send_media(test_phone, test_image, test_caption)

    print(f"📊 Status: {response.status_code}")

    if response.content:
        result = response.json()
        print(f"📋 Resposta: {result}")
        print(f"🎯 Tipo: {result.get('type', 'N/A')}")
    else:
        print("📋 Sem conteúdo na resposta")

except Exception as e:
    print(f"❌ ERRO: {e}")
    import traceback
    traceback.print_exc()

print("=== FIM DEBUG ===")
