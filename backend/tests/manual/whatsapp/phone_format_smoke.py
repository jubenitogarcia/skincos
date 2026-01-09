#!/usr/bin/env python3
"""
🧪 Teste específico para formato 555XXXXXXXXX
"""

from whatsapp_bulk_sender import WhatsAppBulkSender

def test_phone_format():
    sender = WhatsAppBulkSender()

    # Testar formatação de números
    test_numbers = [
        "555191691217",
        "555192770065",
        "555196966063",
        "51999999999",  # Formato antigo
        "+5551999999999"  # Com +
    ]

    print("🧪 TESTE DE FORMATAÇÃO DE NÚMEROS")
    print("=" * 40)

    for number in test_numbers:
        formatted = sender.format_phone_number(number)
        print(f"📱 {number} → {formatted}")

    # Testar parse de lista
    phone_list = "555191691217, 555192770065, 555196966063"
    parsed = sender.parse_phone_list(phone_list)

    print(f"\n📋 Lista original: {phone_list}")
    print(f"📋 Lista processada: {parsed}")

    print("\n✅ Teste de formatação concluído!")

if __name__ == "__main__":
    test_phone_format()
