"""
Script de teste para depuração do login no Sprinta.
Este script APENAS testa o fluxo de login, permitindo visualizar o processo completo.
"""

from sprinta_automation import create_driver, login, check_if_logged_in
import time
import os

def test_login_visual():
    """Testa o login com visualização completa."""
    print("\n" + "="*70)
    print("🧪 TESTE DE LOGIN - MODO VISUAL")
    print("="*70)
    print("Este teste irá:")
    print("  1. Abrir o Chrome visível com perfil persistente")
    print("  2. Verificar se já está logado")
    print("  3. Fazer login apenas se necessário")
    print("  4. Pausar em cada etapa para você visualizar")
    print("  5. Manter o navegador aberto por 30s após o login")
    print("="*70 + "\n")

    driver = create_driver(debug_mode=True, use_persistent_session=True)

    try:
        # Verificar se já está logado
        print("🔍 Verificando se já está logado...")
        is_logged_in = check_if_logged_in(driver, debug_mode=True)

        if not is_logged_in:
            # Credenciais
            username = os.getenv("SPRINTA_LOGIN_USER", "")
            password = os.getenv("SPRINTA_LOGIN_PASSWORD", "")
            if not username or not password:
                raise RuntimeError(
                    "Configure SPRINTA_LOGIN_USER e SPRINTA_LOGIN_PASSWORD no ambiente antes de executar."
                )

            print("⏸️  Iniciando login em 3 segundos...")
            time.sleep(3)

            # Tenta fazer login
            login(driver, username, password, debug_mode=True)
        else:
            print("✅ Já está logado! Sessão persistente funcionando.")

        print("\n" + "="*70)
        print("✅ TESTE CONCLUÍDO!")
        print("="*70)
        print("⏸️  O navegador ficará aberto por 30 segundos.")
        print("    Use este tempo para:")
        print("    - Verificar se o login foi bem-sucedido")
        print("    - Inspecionar elementos da página")
        print("    - Identificar possíveis problemas")
        print("="*70 + "\n")

        time.sleep(30)

    except Exception as e:
        print(f"\n❌ ERRO NO TESTE: {e}")
        print("⏸️  Mantendo navegador aberto por 30s para inspeção...")
        time.sleep(30)

    finally:
        print("\n🔒 Fechando navegador...")
        driver.quit()
        print("✅ Teste concluído!\n")


if __name__ == "__main__":
    test_login_visual()
