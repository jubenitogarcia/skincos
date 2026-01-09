#!/usr/bin/env python3
"""
Teste comparativo: Formato atual vs Documentação da API WhatsApp
"""

import logging
import requests
import sys
import os

# Adicionar diretório raiz ao path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def test_whatsapp_api_formats():
    """Testa diferentes formatos da API WhatsApp"""

    logger.info("📱 === TESTE FORMATOS API WHATSAPP ===")

    # URL da API
    api_url = "https://wa.skincos.com.br"

    # Número de teste
    test_number = "555195103563"

    # URL de imagem teste
    test_image = "https://res.cloudinary.com/do981y6g1/image/upload/v1754672009/qn8mblyxer4psrpheglb.png"

    try:
        # 1. Verificar status da API
        logger.info("🔍 1. Verificando status da API...")
        response = requests.get(f"{api_url}/status", timeout=10)
        logger.info(f"Status API: {response.status_code}")
        if response.status_code == 200:
            status_data = response.json()
            logger.info(f"Ready: {status_data.get('ready', False)}")

        # 2. Teste formato DOCUMENTAÇÃO (recomendado)
        logger.info("📋 2. Testando formato DOCUMENTAÇÃO...")
        payload_doc = {
            "number": test_number,
            "type": "image",
            "url": test_image,
            "message": "🧪 TESTE: Formato da documentação oficial"
        }

        logger.info(f"Payload documentação: {payload_doc}")
        response_doc = requests.post(
            f"{api_url}/send",
            json=payload_doc,
            timeout=30
        )
        logger.info(f"Resultado documentação: {response_doc.status_code}")
        if response_doc.status_code == 200:
            logger.info(f"✅ Sucesso documentação: {response_doc.json()}")
        else:
            logger.error(f"❌ Falha documentação: {response_doc.text}")

        # 3. Teste formato ATUAL (legado)
        logger.info("🤖 3. Testando formato ATUAL do sistema...")
        payload_atual = {
            "number": test_number,
            "message": "🧪 TESTE: Formato atual (legado)",
            "mediaUrl": test_image,
            "type": "media"
        }

        logger.info(f"Payload atual: {payload_atual}")
        response_atual = requests.post(
            f"{api_url}/send",
            json=payload_atual,
            timeout=30
        )
        logger.info(f"Resultado atual: {response_atual.status_code}")
        if response_atual.status_code == 200:
            logger.info(f"✅ Sucesso atual: {response_atual.json()}")
        else:
            logger.error(f"❌ Falha atual: {response_atual.text}")

        # 4. Comparação e recomendação
        logger.info("📊 === ANÁLISE COMPARATIVA ===")

        doc_works = response_doc.status_code == 200
        current_works = response_atual.status_code == 200

        logger.info(f"Formato documentação funciona: {doc_works}")
        logger.info(f"Formato atual funciona: {current_works}")

        if doc_works and current_works:
            logger.info("✅ Ambos formatos funcionam - sistema atual OK")
        elif doc_works and not current_works:
            logger.info("🔄 Recomendação: Atualizar para formato da documentação")
        elif not doc_works and current_works:
            logger.info("📋 Documentação desatualizada - formato atual está correto")
        else:
            logger.info("❌ Nenhum formato funciona - verificar API")

        return {
            'doc_format_works': doc_works,
            'current_format_works': current_works,
            'doc_response': response_doc.status_code,
            'current_response': response_atual.status_code
        }

    except Exception as e:
        logger.error(f"❌ Erro durante teste: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    test_whatsapp_api_formats()
