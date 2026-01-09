#!/usr/bin/env python3
"""
🧪 Teste do Webhook Local com Basic Auth

Testa o envio para o webhook localhost:5678 com autenticação Basic Auth.
"""

from sprinta_automation import send_wix_webhook
from datetime import datetime

# Configurações do webhook local
WEBHOOK_URL = "http://localhost:5678/webhook/sprinta"
WEBHOOK_USER = "novohamburgo@espacofacial.com.br"
WEBHOOK_PASSWORD = "tavpyw-gehgeP-7fytfy"

def test_webhook_local_completo():
    """Testa webhook local com payload completo (12 campos)."""

    print("\n" + "="*70)
    print("🧪 TESTE: Webhook Local com Payload Completo")
    print("="*70)
    print(f"🔗 URL: {WEBHOOK_URL}")
    print(f"🔐 Usuário: {WEBHOOK_USER}")
    print("="*70)

    # Dados completos de um participante
    participant_data = {
        "submission_id": "inscricao_2025-10-05T18-45-30_idf3da204f_linha3",
        "name": "João Silva Santos",
        "email": "joao.silva@espacofacial.com.br",
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
    print(f"   Submission ID: {participant_data['submission_id']}")
    print(f"   Nome: {participant_data['name']}")
    print(f"   Email: {participant_data['email']}")
    print(f"   CPF: {participant_data['cpf']}")
    print(f"   Telefone: {participant_data['phone']}")
    print(f"   Gênero: {participant_data['gender']}")
    print(f"   Corrida: {participant_data['team']}")
    print(f"   Data Nasc: {participant_data['bday']}")
    print(f"   Tamanho: {participant_data['shirt_size']}")
    print(f"   Checkout URL: {redirect_url}")
    print()

    success = send_wix_webhook(
        participant_data=participant_data,
        success=True,
        redirect_url=redirect_url,
        webhook_url=WEBHOOK_URL,
        webhook_user=WEBHOOK_USER,
        webhook_password=WEBHOOK_PASSWORD
    )

    if success:
        print("\n" + "="*70)
        print("✅ SUCESSO! Webhook enviado para servidor local!")
        print("="*70)
        return True
    else:
        print("\n" + "="*70)
        print("❌ FALHA! Verifique se o servidor está rodando em localhost:5678")
        print("="*70)
        return False


def test_webhook_local_falha():
    """Testa webhook local com falha (success: false)."""

    print("\n" + "="*70)
    print("🧪 TESTE: Webhook Local - Inscrição com Falha")
    print("="*70)

    participant_data = {
        "submission_id": "inscricao_2025-10-05T18-48-15_ide4bc305g_linha7",
        "name": "Maria Santos",
        "email": "maria.santos@espacofacial.com.br",
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
    print(f"   Status: ❌ FALHA")
    print()

    success = send_wix_webhook(
        participant_data=participant_data,
        success=False,
        redirect_url=None,
        webhook_url=WEBHOOK_URL,
        webhook_user=WEBHOOK_USER,
        webhook_password=WEBHOOK_PASSWORD
    )

    if success:
        print("\n" + "="*70)
        print("✅ SUCESSO! Webhook de falha enviado!")
        print("="*70)
        return True
    else:
        print("\n" + "="*70)
        print("❌ FALHA! Não foi possível enviar webhook.")
        print("="*70)
        return False


def test_webhook_local_simplificado():
    """Testa webhook local com payload simplificado (3 campos)."""

    print("\n" + "="*70)
    print("🧪 TESTE: Webhook Local - Payload Simplificado")
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
        webhook_url=WEBHOOK_URL,
        webhook_user=WEBHOOK_USER,
        webhook_password=WEBHOOK_PASSWORD
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


if __name__ == "__main__":
    print("\n" + "╔═══════════════════════════════════════════════════════════════╗")
    print("║       🧪 TESTE WEBHOOK LOCAL COM BASIC AUTH                  ║")
    print("╚═══════════════════════════════════════════════════════════════╝")
    print()
    print(f"🔗 Servidor: {WEBHOOK_URL}")
    print(f"🔐 Autenticação: Basic Auth")
    print(f"👤 Usuário: {WEBHOOK_USER}")
    print()
    print("⚠️  IMPORTANTE: Certifique-se de que o servidor está rodando!")
    print()

    input("Pressione ENTER para continuar com os testes... ")

    results = []

    # Teste 1: Payload completo (sucesso)
    results.append(("Payload Completo (12 campos)", test_webhook_local_completo()))

    import time
    print("\n⏳ Aguardando 2 segundos...")
    time.sleep(2)

    # Teste 2: Payload de falha
    results.append(("Payload de Falha", test_webhook_local_falha()))

    print("\n⏳ Aguardando 2 segundos...")
    time.sleep(2)

    # Teste 3: Payload simplificado
    results.append(("Payload Simplificado (3 campos)", test_webhook_local_simplificado()))

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
        print("✅ O webhook local está funcionando corretamente!")
        print()
        print("📝 Próximos passos:")
        print("   1. Verificar logs do servidor localhost:5678")
        print("   2. Confirmar que os dados foram recebidos corretamente")
        print("   3. Atualizar variáveis de ambiente no GitHub Actions")
    else:
        print("\n⚠️  Alguns testes falharam.")
        print()
        print("🔍 Troubleshooting:")
        print("   1. Verifique se o servidor está rodando: curl http://localhost:5678/health")
        print("   2. Teste autenticação: curl -u 'novohamburgo@espacofacial.com.br:tavpyw-gehgeP-7fytfy' http://localhost:5678/webhook/sprinta")
        print("   3. Verifique logs do servidor")
        print("   4. Confirme que Basic Auth está habilitado")

    print()
