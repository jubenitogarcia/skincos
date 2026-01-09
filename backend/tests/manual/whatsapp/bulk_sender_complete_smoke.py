#!/usr/bin/env python3
"""
🧪 Teste final completo do WhatsApp Bulk Sender
"""

from whatsapp_bulk_sender import WhatsAppBulkSender

def test_complete():
    print("🧪 TESTE COMPLETO - WhatsApp Bulk Sender")
    print("=" * 50)

    sender = WhatsAppBulkSender()

    # Dados de teste com quebras de linha
    message = "🎉 Promoção especial!\\n\\n✅ 50% de desconto\\n✅ Válido até amanhã\\n\\nNão perca! 🔥"
    phones = ["555191691217", "555192770065", "555196966063"]
    media_url = "https://picsum.photos/400/300"

    print("📝 Mensagem de teste (com \\n):")
    processed_message = message.replace('\\n', '\n')
    print(f'"{processed_message}"')
    print()

    # Simular resumo
    sender.display_summary(phones, message, media_url)

    print("⚠️ Este é apenas um TESTE SIMULADO")
    print("💡 Para envio real, use: python3 whatsapp_bulk_sender.py")

if __name__ == "__main__":
    test_complete()
