#!/usr/bin/env python3
"""
Verifica a estrutura Scheduled e mostra o status
"""
from datetime import datetime
from pathlib import Path
import json
from libs.scheduler_config import scheduled_dir

def check_scheduled_system():
    print("=" * 50)
    print("🔍 VERIFICAÇÃO DO SISTEMA SCHEDULED")
    print("=" * 50)

    # Data atual
    now = datetime.now()
    year = now.strftime("%Y")
    month = now.strftime("%m")
    day = now.strftime("%d")

    print(f"\n📅 Data atual: {now.strftime('%d/%m/%Y')}")
    print(f"📁 Estrutura esperada: Scheduled/{year}/{month}/")
    print(f"📄 Arquivos esperados: contendo '{day}' no nome\n")

    # Verificar pasta Scheduled
    scheduled = scheduled_dir()
    if not scheduled.exists():
        print("❌ Pasta 'Scheduled' não encontrada!")
        print("📁 Criando estrutura...")
        scheduled.mkdir(exist_ok=True)
    else:
        print("✅ Pasta 'Scheduled' existe")

    # Verificar estrutura ano/mês
    target_path = scheduled / year / month
    if not target_path.exists():
        print(f"❌ Pasta '{target_path}' não encontrada!")
        print("📁 Criando estrutura...")
        target_path.mkdir(parents=True, exist_ok=True)
    else:
        print(f"✅ Pasta '{target_path}' existe")

    # Listar arquivos
    print(f"\n📂 Conteúdo de {target_path}:")
    if target_path.exists():
        files = list(target_path.iterdir())
        if files:
            for f in files:
                if f.is_file():
                    if day in f.name:
                        print(f"  ✅ {f.name} (arquivo do dia)")
                    else:
                        print(f"  📄 {f.name}")
        else:
            print("  ⚠️ Pasta vazia")

    # Criar exemplo
    print("\n💡 Exemplo de uso:")
    print(f"  1. Coloque arquivos em: {target_path}")
    print(f"  2. Nome do arquivo deve conter '{day}'")
    print(f"  3. Exemplos: {day}_selfie.jpg, {day}_video.mp4")

    # Verificar se o entrypoint referencia a estrutura correta
    print("\n🔧 Verificando integração com apps.automations.scheduled_posting...")
    entrypoint = Path(__file__).resolve().parents[1] / "__main__.py"
    if entrypoint.exists():
        with open(entrypoint, "r", encoding="utf-8") as f:
            content = f.read()
            if "Scheduled" in content:
                print("✅ Entrypoint referencia pasta Scheduled")
            else:
                print("⚠️ Entrypoint pode precisar de atualização")

    print("\n" + "=" * 50)

if __name__ == "__main__":
    check_scheduled_system()
