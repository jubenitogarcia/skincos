#!/usr/bin/env python3
"""
Teste para identificar formato correto de mídia na API WhatsApp
"""

import requests
import logging
from config import ConfigManager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_media_formats():
    """Testa diferentes formatos de payload para mídia"""

    config = ConfigManager.get_config()
    whatsapp_config = config.get('whatsapp_config', {})
    api_url = whatsapp_config.get('api_url', 'https://wa.skincos.com.br')

    test_phone = "+555195103563"
    test_image = "https://res.cloudinary.com/do981y6g1/image/upload/v1754425881/ozwhnoqbwsyyt1bnrqmo.png"
    test_caption = "Teste de mídia - formato {}"

    # Diferentes formatos para testar
    payload_formats = [
        {
            "name": "Formato 1: mediaUrl + message",
            "payload": {
                "number": test_phone,
                "message": test_caption.format("1"),
                "mediaUrl": test_image
            }
        },
        {
            "name": "Formato 2: imageUrl + caption",
            "payload": {
                "number": test_phone,
                "imageUrl": test_image,
                "caption": test_caption.format("2")
            }
        },
        {
            "name": "Formato 3: mediaUrl + caption",
            "payload": {
                "number": test_phone,
                "mediaUrl": test_image,
                "caption": test_caption.format("3")
            }
        },
        {
            "name": "Formato 4: image + text",
            "payload": {
                "number": test_phone,
                "image": test_image,
                "text": test_caption.format("4")
            }
        },
        {
            "name": "Formato 5: url + message",
            "payload": {
                "number": test_phone,
                "url": test_image,
                "message": test_caption.format("5")
            }
        },
        {
            "name": "Formato 6: media object",
            "payload": {
                "number": test_phone,
                "message": test_caption.format("6"),
                "media": {
                    "url": test_image,
                    "type": "image"
                }
            }
        }
    ]

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "SKINCOS-Test/1.0"
    }

    for test_format in payload_formats:
        logger.info(f"\n🧪 {test_format['name']}")
        logger.info(f"📤 Payload: {test_format['payload']}")

        try:
            response = requests.post(
                f"{api_url}/send",
                json=test_format['payload'],
                headers=headers,
                timeout=10
            )

            logger.info(f"📊 Status: {response.status_code}")

            if response.content:
                try:
                    result = response.json()
                    logger.info(f"📋 Resposta: {result}")

                    # Verificar se foi enviado como mídia
                    message_type = result.get('type', 'unknown')
                    if message_type in ['image', 'media', 'document']:
                        logger.info(f"✅ SUCESSO! Formato aceito para mídia: {message_type}")
                    elif message_type == 'text':
                        logger.warning(f"⚠️ Enviado como texto, mídia ignorada")
                    else:
                        logger.info(f"🔍 Tipo: {message_type}")

                except Exception as e:
                    logger.warning(f"❌ Erro ao parsear JSON: {e}")
                    logger.info(f"📄 Resposta bruta: {response.text}")
            else:
                logger.info("📋 Resposta vazia")

        except Exception as e:
            logger.error(f"❌ Erro na requisição: {e}")

        logger.info("-" * 50)

if __name__ == "__main__":
    test_media_formats()
