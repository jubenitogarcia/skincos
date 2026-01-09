#!/usr/bin/env python3
"""
🔧 Gerador Rápido de Relatório do Terminal
Versão simplificada para extrair dados rapidamente
"""

import os
from pathlib import Path


def _backend_dir() -> Path:
    return Path(__file__).resolve().parents[3]

def _example_terminal_output_path() -> Path:
    return Path(__file__).resolve().parent / 'exemplo_terminal_output.example.txt'

def _default_output_dir() -> Path:
    env = os.environ.get('REPORTS_DIR')
    if env:
        return Path(env)
    var_dir = os.environ.get('VAR_DIR')
    if var_dir:
        return Path(var_dir) / 'reports' / 'terminal'
    return _backend_dir() / 'var' / 'reports' / 'terminal'


def extrair_relatorio_rapido():
    """Extrai relatório de forma simples e rápida"""

    print("🚀 GERADOR RÁPIDO DE RELATÓRIO")
    print("=" * 50)
    print("\n📋 Cole aqui o texto do terminal (Ctrl+D ou Ctrl+Z quando terminar):")
    print("💡 Ou digite 'exemplo' para usar dados de demonstração")

    # Ler input do usuário
    lines = []
    try:
        while True:
            line = input()
            if line.strip().lower() == 'exemplo':
                # Usar dados de exemplo
                example_path = _example_terminal_output_path()
                terminal_text = example_path.read_text(encoding='utf-8')
                break
            lines.append(line)
    except (EOFError, KeyboardInterrupt):
        terminal_text = '\n'.join(lines)

    if not terminal_text.strip():
        print("❌ Nenhum texto fornecido!")
        return

    # Extrair números
    import re
    sucessos = []
    falhas = []

    for line in terminal_text.split('\n'):
        line = line.strip()

        # Buscar sucessos
        if '✅' in line and 'Enviado com sucesso' in line:
            match = re.search(r'(\d{10,15})', line)
            if match:
                sucessos.append(match.group(1))

        # Buscar falhas
        elif '❌' in line and 'Erro' in line:
            match = re.search(r'(\d{10,15}).*?(Erro.*)', line)
            if match:
                falhas.append(f"{match.group(1)} - {match.group(2)}")

    # Gerar arquivo simples
    from datetime import datetime
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"relatorio_simples_{timestamp}.txt"

    output_dir = _default_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / filename

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("📱 RELATÓRIO DE ENVIO WhatsApp\n")
        f.write("=" * 50 + "\n\n")
        f.write(f"📅 Data: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\n")
        f.write(f"📊 Total: {len(sucessos) + len(falhas)} números\n")
        f.write(f"✅ Sucessos: {len(sucessos)}\n")
        f.write(f"❌ Falhas: {len(falhas)}\n")

        if len(sucessos) + len(falhas) > 0:
            taxa = len(sucessos) / (len(sucessos) + len(falhas)) * 100
            f.write(f"📈 Taxa de Sucesso: {taxa:.1f}%\n\n")

        # Números com sucesso
        if sucessos:
            f.write("✅ NÚMEROS QUE RECEBERAM A MENSAGEM:\n")
            f.write("-" * 40 + "\n")
            for i, phone in enumerate(sucessos, 1):
                f.write(f"{i:3d}. {phone}\n")
            f.write("\n")

        # Números com falha
        if falhas:
            f.write("❌ NÚMEROS QUE NÃO RECEBERAM A MENSAGEM:\n")
            f.write("-" * 40 + "\n")
            for i, info in enumerate(falhas, 1):
                f.write(f"{i:3d}. {info}\n")
            f.write("\n")

        f.write("=" * 50 + "\n")
        f.write("Relatório gerado automaticamente\n")

    # Mostrar resultado
    print(f"\n✅ RELATÓRIO GERADO:")
    print(f"   📄 Arquivo: {output_path}")
    print(f"   ✅ Sucessos: {len(sucessos)}")
    print(f"   ❌ Falhas: {len(falhas)}")

    if len(sucessos) + len(falhas) > 0:
        taxa = len(sucessos) / (len(sucessos) + len(falhas)) * 100
        print(f"   📈 Taxa: {taxa:.1f}%")

    # Mostrar preview
    if sucessos:
        print(f"\n📋 Primeiros números com sucesso:")
        for phone in sucessos[:5]:
            print(f"   • {phone}")

    if falhas:
        print(f"\n⚠️ Números com falha:")
        for info in falhas:
            print(f"   • {info}")

if __name__ == "__main__":
    extrair_relatorio_rapido()
