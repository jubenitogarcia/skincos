#!/usr/bin/env python3
"""
🚀 Teste Rápido do Webhook Local

Envia um único teste para o webhook local.
"""

from sprinta_automation import send_wix_webhook
from datetime import datetime
import os

# Configurações
WEBHOOK_URL = os.getenv("SPRINTA_WEBHOOK_URL", "http://localhost:5678/webhook/sprinta")
WEBHOOK_USER = os.getenv("SPRINTA_WEBHOOK_USER", "")
WEBHOOK_PASSWORD = os.getenv("SPRINTA_WEBHOOK_PASSWORD", "")

if not WEBHOOK_USER or not WEBHOOK_PASSWORD:
    raise RuntimeError(
        "Configure SPRINTA_WEBHOOK_USER e SPRINTA_WEBHOOK_PASSWORD no ambiente antes de executar."
    )

print("\n" + "╔═══════════════════════════════════════════════════════════════╗")
print("║           🚀 TESTE RÁPIDO - WEBHOOK LOCAL                    ║")
print("╚═══════════════════════════════════════════════════════════════╝")
print()
print(f"🔗 URL: {WEBHOOK_URL}")
print(f"🔐 Basic Auth: {WEBHOOK_USER}")
print()

# Dados do participante
participant_data = {
    "submission_id": "inscricao_2025-10-05T18-45-30_idf3da204f_linha3",
    "name": "João Silva Santos",
    "email": "joao.silva@espacofacial.com.br",
    "phone": "51999887766",
    "cpf": "12345678900",
    "bday": "15/03/1990",
    "gender": "Masculino",
    "team": "5K Espaço Facial",
    "shirt_size": "G"
}

redirect_url = "https://checkout.sprinta.com.br/v27310473FctPA32SzolNIrs"

print("📋 Dados do Participante:")
print(f"   ID: {participant_data['submission_id']}")
print(f"   Nome: {participant_data['name']}")
print(f"   Email: {participant_data['email']}")
print(f"   Checkout: {redirect_url}")

# Enviar webhook
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
    print("🎉 SUCESSO! Webhook enviado para o servidor local!")
    print("="*70)
    print()
    print("✅ Verifique os logs do servidor localhost:5678")
    print()
else:
    print("\n" + "="*70)
    print("❌ FALHA ao enviar webhook")
    print("="*70)
    print()
    print("🔍 Possíveis causas:")
    print("   1. Servidor não está rodando em localhost:5678")
    print("   2. Credenciais Basic Auth incorretas")
    print("   3. Endpoint /webhook/sprinta não existe")
    print()
    print("🧪 Teste manual com curl:")
    print(f'   curl -X POST \\')
    print(f'     -u "{WEBHOOK_USER}:{WEBHOOK_PASSWORD}" \\')
    print(f'     -H "Content-Type: application/json" \\')
    print(f'     -d \'{{"test": "data"}}\' \\')
    print(f'     {WEBHOOK_URL}')
    print()
