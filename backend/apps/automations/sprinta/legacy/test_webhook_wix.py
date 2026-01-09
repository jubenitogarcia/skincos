#!/usr/bin/env python3
"""
🧪 Script de Teste do Webhook Wix

Testa se o webhook está funcionando corretamente sem precisar fazer
uma inscrição completa no Sprinta.

Uso:
    python test_webhook_wix.py
"""

import requests
import json
from datetime import datetime

# URL do webhook Wix
WIX_WEBHOOK_URL = "https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f"

def test_webhook():
    """Testa o envio de webhook para o Wix."""

    print("🧪 Testando Webhook do Wix")
    print("=" * 70)
    print(f"📅 Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    # Payload de teste
    payload = {
        "submissionId": "test-" + datetime.now().strftime('%Y%m%d-%H%M%S'),
        "success": True,
        "redirectUrl": "https://checkout.sprinta.com.br/v27310473FctPA32SzolNIrs"
    }

    print("📦 Payload de Teste:")
    print(json.dumps(payload, indent=2))
    print()

    print(f"🔗 URL do Webhook:")
    print(f"   {WIX_WEBHOOK_URL}")
    print()

    try:
        print("📤 Enviando webhook...")
        response = requests.post(
            WIX_WEBHOOK_URL,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Sprinta-Automation-Test/1.0"
            },
            timeout=30
        )

        print(f"📊 Status Code: {response.status_code}")
        print(f"📄 Response Headers:")
        for key, value in response.headers.items():
            print(f"   {key}: {value}")
        print()

        if response.text:
            print(f"📝 Response Body:")
            try:
                print(json.dumps(response.json(), indent=2))
            except:
                print(f"   {response.text}")
        print()

        response.raise_for_status()

        print("=" * 70)
        print("✅ SUCESSO! Webhook enviado com sucesso!")
        print("=" * 70)

        return True

    except requests.exceptions.HTTPError as e:
        print("=" * 70)
        print(f"❌ ERRO HTTP: {e}")
        print("=" * 70)
        print()
        print("🔍 Possíveis causas:")
        print("   • URL do webhook incorreta")
        print("   • Token de segurança expirado")
        print("   • Webhook desabilitado no Wix")
        print("   • Problema de rede/firewall")
        print()
        return False

    except requests.exceptions.Timeout:
        print("=" * 70)
        print("❌ ERRO: Timeout ao enviar webhook")
        print("=" * 70)
        print()
        print("🔍 Possíveis causas:")
        print("   • Servidor Wix não respondeu em 30 segundos")
        print("   • Problema de conexão de rede")
        print()
        return False

    except requests.exceptions.RequestException as e:
        print("=" * 70)
        print(f"❌ ERRO DE REDE: {e}")
        print("=" * 70)
        print()
        print("🔍 Verifique sua conexão de internet")
        print()
        return False

    except Exception as e:
        print("=" * 70)
        print(f"❌ ERRO INESPERADO: {e}")
        print("=" * 70)
        return False


def test_webhook_with_failure():
    """Testa o envio de webhook com falha."""

    print("\n" + "=" * 70)
    print("🧪 Testando Webhook com Falha (success: false)")
    print("=" * 70)

    payload = {
        "submissionId": "test-failure-" + datetime.now().strftime('%Y%m%d-%H%M%S'),
        "success": False,
        "redirectUrl": ""
    }

    print("📦 Payload:")
    print(json.dumps(payload, indent=2))
    print()

    try:
        print("📤 Enviando webhook...")
        response = requests.post(
            WIX_WEBHOOK_URL,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Sprinta-Automation-Test/1.0"
            },
            timeout=30
        )

        print(f"📊 Status Code: {response.status_code}")
        response.raise_for_status()

        print("✅ Webhook de falha enviado com sucesso!")
        return True

    except Exception as e:
        print(f"❌ Erro: {e}")
        return False


if __name__ == "__main__":
    print()
    print("╔═════════════════════════════════════════════════════════════════╗")
    print("║       🧪 TESTE DO WEBHOOK WIX - SPRINTA AUTOMATION            ║")
    print("╚═════════════════════════════════════════════════════════════════╝")
    print()

    # Teste 1: Webhook com sucesso
    success1 = test_webhook()

    # Aguardar um pouco antes do próximo teste
    if success1:
        import time
        print("\n⏳ Aguardando 2 segundos antes do próximo teste...")
        time.sleep(2)

        # Teste 2: Webhook com falha
        success2 = test_webhook_with_failure()

        print("\n" + "=" * 70)
        print("📊 RESUMO DOS TESTES")
        print("=" * 70)
        print(f"   Teste 1 (sucesso):  {'✅ PASSOU' if success1 else '❌ FALHOU'}")
        print(f"   Teste 2 (falha):    {'✅ PASSOU' if success2 else '❌ FALHOU'}")
        print("=" * 70)
        print()

        if success1 and success2:
            print("🎉 Todos os testes passaram! Webhook está funcionando corretamente!")
        else:
            print("⚠️  Alguns testes falharam. Verifique a configuração do webhook.")

    print()
