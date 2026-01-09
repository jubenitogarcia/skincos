#!/usr/bin/env python3
"""
Status Final - Exibe um relatório completo do status do sistema
"""
import os
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
import subprocess
import platform
import shutil

from libs.scheduler_config import ConfigManager, scheduled_dir, scheduled_posting_var_dir

# Cores para o terminal
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'

def check_command_exists(command):
    """Verifica se um comando existe no sistema"""
    return shutil.which(command) is not None

def format_path(path, max_length=40):
    """Formata um caminho para exibição"""
    path_str = str(path)
    if len(path_str) > max_length:
        return "..." + path_str[-(max_length-3):]
    return path_str

def get_config():
    """Carrega as configurações do sistema"""
    try:
        return ConfigManager().data
    except Exception:
        return {}

def get_python_packages():
    """Retorna uma lista dos pacotes Python instalados relevantes para o sistema"""
    packages = [
        ("torch", "PyTorch (ML)"),
        ("faster_whisper", "Faster Whisper (Transcrição)"),
        ("transformers", "Transformers (BLIP/GPT)"),
        ("moviepy", "MoviePy (Vídeo)"),
        ("cv2", "OpenCV (Imagem)"),
        ("PIL", "Pillow (Imagem)")
    ]

    result = []
    for module, name in packages:
        try:
            __import__(module)
            result.append((name, "Instalado", True))
        except ImportError:
            result.append((name, "Não instalado", False))

    return result

def check_folders():
    """Verifica as pastas necessárias"""
    models_dir = Path(os.environ.get("SCHEDULED_POSTING_MODELS_DIR", str(Path.home() / "scheduled_posting_models")))
    folders = [
        (scheduled_dir(), "Pasta de agendamentos"),
        (models_dir, "Modelos de IA"),
        (scheduled_posting_var_dir() / "media", "Arquivos de mídia"),
        (scheduled_posting_var_dir() / "logs", "Logs do sistema"),
        (scheduled_posting_var_dir() / "data", "Dados de processamento"),
        (scheduled_posting_var_dir() / "posts", "Logs de posts"),
    ]

    result = []
    for path, description in folders:
        exists = path.exists() and path.is_dir()
        result.append((description, format_path(path), exists))

    return result

def check_key_files():
    """Verifica arquivos-chave do sistema"""
    module_root = Path(__file__).resolve().parents[1]
    files = [
        (module_root / "__main__.py", "Script principal"),
        (module_root / "scheduling" / "scheduled_media_handler.py", "Gerenciador de mídia agendada"),
        (module_root / "ops" / "automated_poster.py", "Postador automático"),
        (module_root / "media" / "simple_video_processor.py", "Processador de vídeo"),
        (module_root / "media" / "media_processor.py", "Processador de mídia"),
        (module_root / "ops" / "daily_monitor.py", "Monitor diário"),
    ]

    result = []
    for path, description in files:
        exists = path.exists() and path.is_file()
        size = path.stat().st_size if exists else 0
        result.append((description, format_path(path), exists, size))

    return result

def check_scheduled_posts():
    """Verifica posts agendados para hoje e próximos dias"""
    today = datetime.now()
    config = get_config()
    scheduled_folder = config.get("scheduled_posting", {}).get("base_folder")
    base_path = Path(scheduled_folder) if scheduled_folder else scheduled_dir()

    result = []

    # Próximos 7 dias (incluindo hoje)
    for i in range(7):
        check_date = today + timedelta(days=i)
        year_folder = base_path / check_date.strftime("%Y")
        month_folder = year_folder / check_date.strftime("%m")
        day_prefix = check_date.strftime("%d")

        if month_folder.exists():
            files = [f for f in month_folder.glob(f"{day_prefix}*") if f.is_file()]
            status = "✅" if files else "❌"
            file_count = len(files)

            date_str = check_date.strftime("%d/%m/%Y")
            if i == 0:
                date_str += " (hoje)"
            elif i == 1:
                date_str += " (amanhã)"

            result.append((date_str, status, file_count, files))

    return result

def get_post_logs():
    """Recupera logs de posts recentes"""
    posts = []
    posts_dir = scheduled_posting_var_dir() / "posts"
    for post_file in sorted(posts_dir.glob("post_*.txt"), reverse=True) if posts_dir.exists() else []:
        try:
            with open(post_file, "r", encoding="utf-8") as f:
                content = f.read()
                # Extrair data
                date_line = next((line for line in content.split("\n") if line.startswith("Data:")), None)
                if date_line:
                    date_str = date_line.replace("Data:", "").strip()
                    try:
                        date_obj = datetime.fromisoformat(date_str)
                        posts.append((post_file, date_obj))
                    except ValueError:
                        pass
        except Exception:
            pass

    return posts[:5]  # Retorna os 5 mais recentes

def get_system_info():
    """Retorna informações sobre o sistema"""
    info = {}
    info["os"] = platform.system()
    info["os_version"] = platform.release()
    info["python"] = platform.python_version()
    info["machine"] = platform.machine()

    # Verificar GPU
    try:
        import torch
        info["gpu"] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "Não disponível"
        info["cuda"] = torch.version.cuda if torch.cuda.is_available() else "Não instalado"
    except ImportError:
        info["gpu"] = "PyTorch não disponível"
        info["cuda"] = "PyTorch não disponível"

    return info

def main():
    """Função principal que exibe o status do sistema"""
    print(f"\n{Colors.BOLD}{Colors.HEADER}{'='*80}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.HEADER} STATUS DO SISTEMA (Scheduled Posting) {Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.HEADER}{'='*80}{Colors.ENDC}")

    # Informações do sistema
    print(f"\n{Colors.BOLD}{Colors.BLUE}[1] INFORMAÇÕES DO SISTEMA{Colors.ENDC}")
    system_info = get_system_info()

    print(f"  OS: {Colors.BOLD}{system_info['os']} {system_info['os_version']}{Colors.ENDC}")
    print(f"  Python: {Colors.BOLD}{system_info['python']}{Colors.ENDC}")
    print(f"  Arquitetura: {system_info['machine']}")
    print(f"  GPU: {Colors.BOLD}{system_info['gpu']}{Colors.ENDC}")
    print(f"  CUDA: {system_info['cuda']}")

    # Pacotes instalados
    print(f"\n{Colors.BOLD}{Colors.BLUE}[2] COMPONENTES{Colors.ENDC}")
    packages = get_python_packages()
    for name, status, installed in packages:
        color = Colors.GREEN if installed else Colors.RED
        icon = "✓" if installed else "✗"
        print(f"  {color}{icon} {name:<25} {status}{Colors.ENDC}")

    # Verificar pastas
    print(f"\n{Colors.BOLD}{Colors.BLUE}[3] DIRETÓRIOS{Colors.ENDC}")
    folders = check_folders()
    for name, path, exists in folders:
        color = Colors.GREEN if exists else Colors.RED
        icon = "✓" if exists else "✗"
        print(f"  {color}{icon} {name:<25} {path}{Colors.ENDC}")

    # Arquivos principais
    print(f"\n{Colors.BOLD}{Colors.BLUE}[4] ARQUIVOS PRINCIPAIS{Colors.ENDC}")
    files = check_key_files()
    for name, path, exists, size in files:
        color = Colors.GREEN if exists else Colors.RED
        icon = "✓" if exists else "✗"
        size_str = f"{size/1024:.1f} KB" if exists else "0 KB"
        print(f"  {color}{icon} {name:<25} {path:<25} {size_str}{Colors.ENDC}")

    # Verificar agendamento
    print(f"\n{Colors.BOLD}{Colors.BLUE}[5] POSTS AGENDADOS{Colors.ENDC}")
    scheduled = check_scheduled_posts()
    for date, status, count, files in scheduled:
        if status == "✅":
            print(f"  {Colors.GREEN}{status} {date:<20} {count} arquivos{Colors.ENDC}")
            for f in files[:2]:  # Mostrar apenas os 2 primeiros
                print(f"     ↳ {f.name}")
            if len(files) > 2:
                print(f"     ↳ ... e mais {len(files)-2} arquivo(s)")
        else:
            print(f"  {Colors.YELLOW}{status} {date:<20} {count} arquivos{Colors.ENDC}")

    # Posts recentes
    print(f"\n{Colors.BOLD}{Colors.BLUE}[6] POSTS RECENTES{Colors.ENDC}")
    posts = get_post_logs()
    if posts:
        for post_file, date in posts:
            print(f"  {Colors.GREEN}✓ {date.strftime('%d/%m/%Y %H:%M')} - {post_file.name}{Colors.ENDC}")
    else:
        print(f"  {Colors.YELLOW}⚠️ Nenhum post recente encontrado{Colors.ENDC}")

    # Configurações
    print(f"\n{Colors.BOLD}{Colors.BLUE}[7] CONFIGURAÇÕES{Colors.ENDC}")
    config = get_config()

    scheduled_config = config.get("scheduled_posting", {})
    enabled = scheduled_config.get("enabled", False)
    auto_post = scheduled_config.get("auto_post", False)

    print(f"  Sistema agendado: {Colors.GREEN + '✓ Ativado' + Colors.ENDC if enabled else Colors.YELLOW + '⚠️ Desativado' + Colors.ENDC}")
    print(f"  Postagem automática: {Colors.GREEN + '✓ Ativado' + Colors.ENDC if auto_post else Colors.YELLOW + '⚠️ Desativado' + Colors.ENDC}")
    print(f"  Pasta base: {scheduled_config.get('base_folder', 'Scheduled')}")
    print(f"  Verificação diária: {scheduled_config.get('daily_check_time', 'Não configurado')}")

    # Hashtags padrão
    hashtags = scheduled_config.get("post_defaults", {}).get("hashtags", [])
    if hashtags:
        print(f"  Hashtags padrão: {Colors.CYAN}{' '.join(['#'+h for h in hashtags])}{Colors.ENDC}")

    print(f"\n{Colors.BOLD}{Colors.HEADER}{'='*80}{Colors.ENDC}")
    print(f"{Colors.BOLD}Data/Hora: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}{Colors.ENDC}")
    print()

if __name__ == "__main__":
    main()
