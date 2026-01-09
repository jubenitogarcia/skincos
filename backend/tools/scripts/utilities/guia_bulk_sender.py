#!/usr/bin/env python3
"""
📋 Guia de uso do WhatsApp Bulk Sender
"""

print("""
🚀 WhatsApp Bulk Sender - Guia de Uso
======================================

📋 FUNCIONALIDADES:
   • Envio em massa de mensagens de texto
   • Suporte a imagens, vídeos, documentos e áudios
   • Detecção automática do tipo de mídia pela extensão
   • Intervalos aleatórios entre envios (5-15s)
   • Pausas entre blocos de mensagens (1-5 min)
   • Blocos de tamanho variável (5-15 números)
   • Interface amigável com progresso em tempo real

📱 COMO USAR:
   1. Execute: python3 whatsapp_bulk_sender.py
   2. Digite a mensagem que será enviada
   3. Cole a URL da mídia (opcional)
   4. Digite os números separados por vírgula
   5. Confirme o envio

📝 EXEMPLO DE NÚMEROS:
   51999999999, 51888888888, 11777777777

🔗 TIPOS DE MÍDIA SUPORTADOS:
   🖼️ Imagens: .jpg, .jpeg, .png, .gif, .webp, .bmp
   🎥 Vídeos: .mp4, .avi, .mov, .wmv, .flv, .webm, .mkv
   📄 Documentos: .pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx, .txt
   🎵 Áudios: .mp3, .wav, .ogg, .m4a, .aac

⚠️ CONFIGURAÇÃO:
   • API URL padrão: http://efnh.skincos.com.br
   • Para alterar, edite a linha 15 do script

🧪 PARA TESTAR:
   python3 test_bulk_sender.py

🚀 EXECUTAR:
   python3 whatsapp_bulk_sender.py
""")
