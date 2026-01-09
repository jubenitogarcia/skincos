#!/usr/bin/env python3
"""
Script de teste para aplicação de cupom em checkout URL.

Este script testa a funcionalidade de aplicar automaticamente o cupom
ESPACOFACIALNH10 em uma URL de checkout do Sprinta e envia notificação
via webhook para o Wix.

Uso:
    python test_apply_coupon.py [URL_DO_CHECKOUT] [SUBMISSION_ID] [WEBHOOK_URL]

Argumentos:
    URL_DO_CHECKOUT: URL completa do checkout (opcional, usa URL padrão se não fornecida)
    SUBMISSION_ID: ID da submissão/inscrição (opcional, usa "test_inscricao_001" se não fornecido)
    WEBHOOK_URL: URL do webhook do Wix (opcional, usa URL padrão se não fornecida)

Exemplos:
    # Teste básico com URL padrão
    python test_apply_coupon.py

    # Teste com URL específica
    python test_apply_coupon.py https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g

    # Teste completo com webhook
    python test_apply_coupon.py https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g inscricao_12345

    # Modo headless (sem abrir navegador)
    HEADLESS=true python test_apply_coupon.py https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g
"""

import sys
import os

# Importar a função do script principal
from sprinta_automation import apply_coupon_to_checkout_url


def main():
    """Função principal do script de teste."""

    # URL de teste padrão (fornecida pelo usuário)
    DEFAULT_CHECKOUT_URL = "https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g"
    DEFAULT_WEBHOOK_URL = "https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f"

    # Verificar se foi passada uma URL como argumento
    if len(sys.argv) > 1:
        checkout_url = sys.argv[1]
        print(f"📌 Usando URL fornecida: {checkout_url}")
    else:
        checkout_url = DEFAULT_CHECKOUT_URL
        print(f"📌 Usando URL padrão de teste: {checkout_url}")

    # Verificar argumentos opcionais
    submission_id = sys.argv[2] if len(sys.argv) > 2 else "test_inscricao_001"
    webhook_url = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_WEBHOOK_URL

    # Verificar se deve usar modo headless
    headless = os.environ.get('HEADLESS', '').lower() == 'true'

    print("\n" + "="*70)
    print("🧪 TESTE DE APLICAÇÃO DE CUPOM DE DESCONTO")
    print("="*70)
    print(f"🔗 Checkout URL: {checkout_url}")
    print(f"🎫 Cupom: ESPACOFACIALNH10")
    print(f"🆔 Submission ID: {submission_id}")
    print(f"📤 Webhook URL: {webhook_url[:50]}...")
    print(f"🐛 Modo Debug: Ativado")
    print(f"👻 Headless: {'Sim' if headless else 'Não (navegador visível)'}")
    print("="*70 + "\n")

    print("⏳ Iniciando teste...")
    print("💡 Dica: Observe o navegador para ver cada etapa sendo executada!\n")

    try:
        # Executar a aplicação do cupom
        success = apply_coupon_to_checkout_url(
            checkout_url=checkout_url,
            coupon_code="ESPACOFACIALNH10",
            debug_mode=True,
            headless=headless,
            submission_id=submission_id,
            webhook_url=webhook_url
        )

        if success:
            print("\n" + "="*70)
            print("✅ TESTE CONCLUÍDO COM SUCESSO!")
            print("="*70)
            print("✅ O cupom foi aplicado corretamente na página de checkout")
            print("✅ Webhook enviado para o Wix (se ID fornecido)")
            print("✅ Você pode verificar que o desconto foi aplicado")
            print("="*70 + "\n")
            return 0
        else:
            print("\n" + "="*70)
            print("❌ TESTE FALHOU")
            print("="*70)
            print("❌ O cupom não pôde ser aplicado")
            print("💡 Verifique os logs acima para identificar o problema")
            print("="*70 + "\n")
            return 1

    except KeyboardInterrupt:
        print("\n\n⚠️  Teste interrompido pelo usuário (Ctrl+C)")
        return 130

    except Exception as e:
        print("\n" + "="*70)
        print("❌ ERRO INESPERADO")
        print("="*70)
        print(f"Erro: {e}")
        print("="*70 + "\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
