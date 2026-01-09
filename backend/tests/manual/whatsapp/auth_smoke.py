#!/usr/bin/env python3

print("=== TESTE COM AUTENTICAÇÃO ===")

import requests

try:
    from config import ConfigManager

    config = ConfigManager.get_config()
    whatsapp_config = config.get('whatsapp_config', {})

    api_url = whatsapp_config.get('api_url')
    api_key = whatsapp_config.get('api_key')
    test_phone = config.get('global', {}).get('test_phone_number')

    print(f"🌐 API: {api_url}")
    print(f"🔑 API Key: {api_key}")
    print(f"📱 Phone: {test_phone}")

    test_image = "https://res.cloudinary.com/do981y6g1/image/upload/v1754426106/o4ixnewrznt0ty67hzvu.png"

    # Teste com diferentes headers de autenticação
    test_auths = [
        {
            "name": "Sem autenticação",
            "headers": {
                "Content-Type": "application/json",
                "User-Agent": "SKINCOS-AuthTest/1.0"
            }
        },
        {
            "name": "Bearer token",
            "headers": {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
                "User-Agent": "SKINCOS-AuthTest/1.0"
            }
        },
        {
            "name": "API Key header",
            "headers": {
                "Content-Type": "application/json",
                "X-API-Key": api_key,
                "User-Agent": "SKINCOS-AuthTest/1.0"
            }
        },
        {
            "name": "API Key no payload",
            "headers": {
                "Content-Type": "application/json",
                "User-Agent": "SKINCOS-AuthTest/1.0"
            },
            "extra_payload": {"apiKey": api_key}
        }
    ]

    base_payload = {
        "number": test_phone,
        "message": "🧪 Teste auth: {name}",
        "mediaUrl": test_image,
        "type": "media"
    }

    for i, auth in enumerate(test_auths, 1):
        print(f"\n{i}️⃣ {auth['name']}:")

        # Preparar payload
        payload = base_payload.copy()
        payload["message"] = payload["message"].format(name=auth["name"])

        if "extra_payload" in auth:
            payload.update(auth["extra_payload"])

        print(f"📤 Headers: {auth['headers']}")
        if "extra_payload" in auth:
            print(f"➕ Extra payload: {auth['extra_payload']}")

        try:
            response = requests.post(
                f"{api_url}/send",
                json=payload,
                headers=auth["headers"],
                timeout=15
            )

            print(f"📊 Status: {response.status_code}")

            if response.content:
                result = response.json()
                print(f"📋 Tipo: {result.get('type', 'N/A')}")
                print(f"✅ Success: {result.get('success', False)}")

                # Se for mídia, destacar
                if result.get('type') == 'media':
                    print(f"🎉 MÍDIA ENVIADA!")
                elif result.get('type') == 'text':
                    print(f"⚠️ Apenas texto")
            else:
                print("📋 Sem conteúdo na resposta")

        except Exception as e:
            print(f"❌ Erro: {e}")

        print("-" * 40)

except Exception as e:
    print(f"❌ ERRO GERAL: {e}")
    import traceback
    traceback.print_exc()

print("=== FIM TESTE AUTENTICAÇÃO ===")
