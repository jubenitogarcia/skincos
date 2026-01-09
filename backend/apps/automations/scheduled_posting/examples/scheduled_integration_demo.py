#!/usr/bin/env python3
"""
Script de teste para o sistema unificado de mídias agendadas.
Demonstra como alternar entre pasta local e Google Drive.
"""

import json
import logging
from pathlib import Path
from apps.automations.scheduled_posting.scheduling.unified_scheduled_media_handler import UnifiedScheduledMediaHandler
from libs.scheduler_config import default_config_path, scheduled_dir

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def test_local_mode():
    """Testa o modo pasta local"""
    print("\n" + "="*60)
    print("🗂️ TESTE - MODO PASTA LOCAL")
    print("="*60)

    # Carregar config e forçar modo local
    config_path = default_config_path()
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)

    config["scheduled_posting"]["use_google_drive"] = False
    config["scheduled_posting"]["base_folder"] = str(scheduled_dir())

    # Criar handler
    handler = UnifiedScheduledMediaHandler(config)

    # Mostrar configuração
    print(f"📁 Modo de armazenamento: {'Google Drive' if handler.use_google_drive else 'Local'}")
    print(f"📂 Pasta base: {handler.base_folder}")
    print(f"📍 Caminho de hoje: {handler.get_today_path()}")

    # Buscar arquivos
    files = handler.get_today_files()
    print(f"📄 Arquivos encontrados: {len(files)}")

    for i, file in enumerate(files, 1):
        if isinstance(file, dict):
            # Google Drive file
            file_name = file.get('name', 'Unknown')
            file_size = file.get('size', 'Unknown')
            print(f"  {i}. {file_name} ({file_size} bytes)")
        else:
            # Local file
            print(f"  {i}. {file.name} ({file.stat().st_size / 1024 / 1024:.1f} MB)")

    return handler

def test_google_drive_mode():
    """Testa o modo Google Drive"""
    print("\n" + "="*60)
    print("🌐 TESTE - MODO GOOGLE DRIVE")
    print("="*60)

    # Carregar config e forçar modo Google Drive
    config_path = default_config_path()
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)

    config["scheduled_posting"]["use_google_drive"] = True

    # Criar handler
    handler = UnifiedScheduledMediaHandler(config)

    # Mostrar configuração
    print(f"📁 Modo de armazenamento: {'Google Drive' if handler.use_google_drive else 'Local'}")
    print(f"🔗 Folder ID agendado: {handler.scheduled_folder_id}")
    print(f"🔗 Folder ID publicado: {handler.published_folder_id}")
    print(f"📍 ID da pasta de hoje: {handler.get_today_path()}")

    # Buscar arquivos
    files = handler.get_today_files()
    print(f"📄 Arquivos encontrados: {len(files)}")

    for i, file in enumerate(files, 1):
        if isinstance(file, dict):
            # Google Drive file
            file_name = file.get('name', 'Unknown')
            file_size = file.get('size', 'Unknown')
            print(f"  {i}. {file_name} ({file_size} bytes)")
        else:
            # Local file
            print(f"  {i}. {file.name} ({file.stat().st_size / 1024 / 1024:.1f} MB)")

    return handler

def show_current_config():
    """Mostra a configuração atual"""
    print("\n" + "="*60)
    print("⚙️ CONFIGURAÇÃO ATUAL")
    print("="*60)

    try:
        config_path = default_config_path()
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)

        scheduled_config = config.get("scheduled_posting", {})

        print(f"📁 Pasta base: {scheduled_config.get('base_folder', str(scheduled_dir()))}")
        print(f"🌐 Usar Google Drive: {scheduled_config.get('use_google_drive', False)}")
        print(f"🔗 Folder ID agendado: {config.get('drive_scheduled_folder', 'Não configurado')}")
        print(f"🔗 Folder ID publicado: {config.get('drive_published_folder', 'Não configurado')}")

        # Verificar credenciais do Google Drive
        if config.get('google_credentials'):
            print("🔑 Credenciais Google: ✅ Configuradas")
        else:
            print("🔑 Credenciais Google: ❌ Não configuradas")

    except Exception as e:
        print(f"❌ Erro ao ler configuração: {e}")

def toggle_google_drive_mode():
    """Alterna entre modo local e Google Drive"""
    print("\n" + "="*60)
    print("🔄 ALTERNAR MODO DE ARMAZENAMENTO")
    print("="*60)

    try:
        config_path = default_config_path()
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)

        config.setdefault("scheduled_posting", {})
        current_mode = config["scheduled_posting"].get("use_google_drive", False)
        new_mode = not current_mode

        config["scheduled_posting"]["use_google_drive"] = new_mode

        config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)

        mode_name = "Google Drive" if new_mode else "Local"
        print(f"✅ Modo alterado para: {mode_name}")

    except Exception as e:
        print(f"❌ Erro ao alterar modo: {e}")

def main():
    """Função principal"""
    print("🤖 Scheduled Posting - teste de integração de mídia agendada")

    while True:
        print("\n" + "="*60)
        print("🎯 MENU DE TESTE")
        print("="*60)
        print("1. 📊 Ver configuração atual")
        print("2. 🗂️ Testar modo pasta local")
        print("3. 🌐 Testar modo Google Drive")
        print("4. 🔄 Alternar modo de armazenamento")
        print("5. 📝 Ver estrutura de pastas")
        print("0. 🚪 Sair")
        print("="*60)

        try:
            opcao = input("\n🎯 Escolha uma opção: ").strip()

            if opcao == "0":
                print("👋 Teste finalizado!")
                break
            elif opcao == "1":
                show_current_config()
            elif opcao == "2":
                test_local_mode()
            elif opcao == "3":
                test_google_drive_mode()
            elif opcao == "4":
                toggle_google_drive_mode()
            elif opcao == "5":
                show_folder_structure()
            else:
                print("❌ Opção inválida!")

        except (KeyboardInterrupt, EOFError):
            print("\n\n👋 Teste cancelado.")
            break
        except Exception as e:
            print(f"❌ Erro: {e}")

        input("\n⏸️ Pressione Enter para continuar...")

def show_folder_structure():
    """Mostra a estrutura de pastas local"""
    print("\n" + "="*60)
    print("📂 ESTRUTURA DE PASTAS LOCAL")
    print("="*60)

    scheduled_path = scheduled_dir()

    if not scheduled_path.exists():
        print("❌ Pasta 'Scheduled' não encontrada")
        return

    def show_tree(path, prefix=""):
        """Mostra árvore de diretórios"""
        items = list(path.iterdir())
        items.sort(key=lambda x: (x.is_file(), x.name))

        for i, item in enumerate(items):
            is_last = i == len(items) - 1
            current_prefix = "└── " if is_last else "├── "
            print(f"{prefix}{current_prefix}{item.name}")

            if item.is_dir():
                next_prefix = prefix + ("    " if is_last else "│   ")
                show_tree(item, next_prefix)

    print(f"📁 {scheduled_path.name}/")
    show_tree(scheduled_path)

if __name__ == "__main__":
    main()
