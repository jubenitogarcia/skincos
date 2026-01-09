#!/usr/bin/env python3
"""
🧪 Teste Simples do Webhook (Sem Autenticação)

Testa o envio básico para verificar se o webhook está funcionando.
"""

from sprinta_automation import send_wix_webhook

# URL do webhook
WEBHOOK_URL = "http://localhost:5678/webhook/sprinta"

print("\n" + "╔═══════════════════════════════════════════════════════════════╗")
print("║         🧪 TESTE SIMPLES - WEBHOOK SEM AUTENTICAÇÃO          ║")
print("╚═══════════════════════════════════════════════════════════════╝")
print()
print(f"🔗 URL: {WEBHOOK_URL}")
print("🔓 Sem autenticação")
print()

# Dados mínimos de teste
participant_data = {
    "submission_id": "test-123",
    "name": "João Silva",
    "email": "joao@test.com",
    "phone": "51999887766",
    "cpf": "12345678900",
    "bday": "15/03/1990",
    "gender": "Masculino",
    "team": "5K",
    "shirt_size": "G"
}

redirect_url = "https://checkout.sprinta.com.br/test"

print("📋 Dados do Teste:")
print(f"   ID: {participant_data['submission_id']}")
print(f"   Nome: {participant_data['name']}")
print(f"   Email: {participant_data['email']}")
print()

# Enviar webhook SEM autenticação
success = send_wix_webhook(
    participant_data=participant_data,
    success=True,
    redirect_url=redirect_url,
    webhook_url=WEBHOOK_URL,
    webhook_user=None,      # ← Sem autenticação
    webhook_password=None   # ← Sem autenticação
)

if success:
    print("\n" + "="*70)
    print("🎉 SUCESSO! Webhook funcionou!")
    print("="*70)
    print()
    print("✅ Próximos passos:")
    print("   1. Verificar logs do n8n")
    print("   2. Confirmar que dados foram recebidos")
    print("   3. Configurar processamento no workflow")
else:
    print("\n" + "="*70)
    print("❌ FALHA! Webhook não funcionou")
    print("="*70)
    print()
    print("🔍 Possíveis causas:")
    print("   1. Webhook configurado como GET (precisa ser POST)")
    print("   2. Path incorreto no n8n")
    print("   3. Workflow não está ativo")
    print()
    print("🛠️  Configuração no n8n:")
    print("   • HTTP Method: POST (não GET)")
    print("   • Path: sprinta")
    print("   • Authentication: None")
    print("   • Workflow: ACTIVE")

print()
