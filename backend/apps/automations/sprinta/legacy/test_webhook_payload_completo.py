#!/usr/bin/env python3
"""
🧪 Teste do Webhook com Payload Completo (12 campos)

Testa o envio do webhook com todos os dados do participante.
"""

from sprinta_automation import send_wix_webhook
from datetime import datetime

# URL do webhook Wix
WIX_WEBHOOK_URL = "https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f"

def test_payload_completo():
    """Testa webhook com dados completos do participante."""

    print("\n" + "="*70)
    print("🧪 TESTE: Webhook com Payload Completo (12 campos)")
    print("="*70)

    # Dados completos de um participante
    participant_data = {
        "submission_id": "test-" + datetime.now().strftime('%Y%m%d-%H%M%S'),
        "name": "João Silva",
        "email": "joao.silva@test.com",
        "phone": "51999887766",
        "cpf": "12345678900",
        "bday": "15/03/1990",
        "gender": "Masculino",
        "team": "5K Espaço Facial",
        "shirt_size": "G",
        "data_inscricao": "2025-10-05"
    }

    redirect_url = "https://checkout.sprinta.com.br/v27310473FctPA32SzolNIrs"

    print("\n📋 Dados do Participante:")
    print(f"   Nome: {participant_data['name']}")
    print(f"   Email: {participant_data['email']}")
    print(f"   CPF: {participant_data['cpf']}")
    print(f"   Telefone: {participant_data['phone']}")
    print(f"   Gênero: {participant_data['gender']}")
    print(f"   Corrida: {participant_data['team']}")
    print(f"   Data Nasc: {participant_data['bday']}")
    print(f"   Tamanho: {participant_data['shirt_size']}")
    print()

    success = send_wix_webhook(
        participant_data=participant_data,
        success=True,
        redirect_url=redirect_url,
        webhook_url=WIX_WEBHOOK_URL
    )

    if success:
        print("\n" + "="*70)
        print("✅ SUCESSO! Webhook com 12 campos enviado!")
        print("="*70)
        return True
    else:
        print("\n" + "="*70)
        print("❌ FALHA! Webhook não foi enviado.")
        print("="*70)
        return False


def test_payload_simplificado():
    """Testa webhook com apenas 3 campos (compatibilidade)."""

    print("\n" + "="*70)
    print("🧪 TESTE: Webhook Simplificado (3 campos - compatibilidade)")
    print("="*70)

    submission_id = "test-simple-" + datetime.now().strftime('%Y%m%d-%H%M%S')
    redirect_url = "https://checkout.sprinta.com.br/v27310473FctPA32SzolNIrs"

    print(f"\n📋 Dados Simplificados:")
    print(f"   Submission ID: {submission_id}")
    print(f"   Success: True")
    print(f"   Redirect URL: {redirect_url}")
    print()

    success = send_wix_webhook(
        submission_id=submission_id,
        success=True,
        redirect_url=redirect_url,
        webhook_url=WIX_WEBHOOK_URL
    )

    if success:
        print("\n" + "="*70)
        print("✅ SUCESSO! Webhook simplificado enviado!")
        print("="*70)
        return True
    else:
        print("\n" + "="*70)
        print("❌ FALHA! Webhook não foi enviado.")
        print("="*70)
        return False


def test_payload_falha():
    """Testa webhook de falha com dados completos."""

    print("\n" + "="*70)
    print("🧪 TESTE: Webhook de Falha (success: false)")
    print("="*70)

    participant_data = {
        "submission_id": "test-failure-" + datetime.now().strftime('%Y%m%d-%H%M%S'),
        "name": "Maria Santos",
        "email": "maria.santos@test.com",
        "phone": "51988776655",
        "cpf": "98765432100",
        "bday": "20/08/1992",
        "gender": "Feminino",
        "team": "10K",
        "shirt_size": "M",
        "data_inscricao": "2025-10-05"
    }

    print(f"\n📋 Dados do Participante:")
    print(f"   Nome: {participant_data['name']}")
    print(f"   Email: {participant_data['email']}")
    print(f"   Success: False (falha na inscrição)")
    print()

    success = send_wix_webhook(
        participant_data=participant_data,
        success=False,
        redirect_url=None,
        webhook_url=WIX_WEBHOOK_URL
    )

    if success:
        print("\n" + "="*70)
        print("✅ SUCESSO! Webhook de falha enviado!")
        print("="*70)
        return True
    else:
        print("\n" + "="*70)
        print("❌ FALHA! Webhook não foi enviado.")
        print("="*70)
        return False


if __name__ == "__main__":
    print("\n" + "╔═══════════════════════════════════════════════════════════════╗")
    print("║     🧪 TESTES DO WEBHOOK - PAYLOAD COMPLETO (12 CAMPOS)      ║")
    print("╚═══════════════════════════════════════════════════════════════╝")

    results = []

    # Teste 1: Payload completo (12 campos)
    results.append(("Payload Completo (12 campos)", test_payload_completo()))

    import time
    print("\n⏳ Aguardando 2 segundos...")
    time.sleep(2)

    # Teste 2: Payload simplificado (3 campos)
    results.append(("Payload Simplificado (3 campos)", test_payload_simplificado()))

    print("\n⏳ Aguardando 2 segundos...")
    time.sleep(2)

    # Teste 3: Payload de falha
    results.append(("Payload de Falha", test_payload_falha()))

    # Resumo
    print("\n" + "="*70)
    print("📊 RESUMO DOS TESTES")
    print("="*70)

    for test_name, result in results:
        status = "✅ PASSOU" if result else "❌ FALHOU"
        print(f"   {test_name}: {status}")

    print("="*70)

    all_passed = all(result for _, result in results)

    if all_passed:
        print("\n🎉 Todos os testes passaram!")
        print("✅ O webhook está funcionando com payload completo!")
    else:
        print("\n⚠️  Alguns testes falharam.")
        print("🔍 Verifique a configuração do webhook.")

    print()
