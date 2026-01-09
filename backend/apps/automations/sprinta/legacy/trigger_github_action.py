#!/usr/bin/env python3
"""
Script para acionar o Sprinta Scraper via GitHub Actions API.

Permite enviar arquivos CSV para processamento automatizado na nuvem
e receber as URLs de checkout geradas.

Uso:
    python trigger_github_action.py participants.csv

Requisitos:
    - GitHub Personal Access Token (com scopo 'repo' e 'workflow')
    - Arquivo .env com GITHUB_TOKEN, REPO_OWNER e REPO_NAME
"""

import os
import sys
import requests
import base64
from typing import Optional
from dotenv import load_dotenv


def load_config():
    """Carrega configurações de variáveis de ambiente."""
    load_dotenv()

    config = {
        'github_token': os.environ.get('GITHUB_TOKEN'),
        'repo_owner': os.environ.get('REPO_OWNER'),
        'repo_name': os.environ.get('REPO_NAME', 'Sprinta-Scraper'),
        'callback_url': os.environ.get('CALLBACK_URL'),
    }

    # Validar configurações obrigatórias
    if not config['github_token']:
        print("❌ Erro: GITHUB_TOKEN não encontrado!")
        print("💡 Crie um arquivo .env com:")
        print("   GITHUB_TOKEN=ghp_seu_token_aqui")
        print("   REPO_OWNER=seu-usuario-github")
        print("   REPO_NAME=Sprinta-Scraper")
        sys.exit(1)

    if not config['repo_owner']:
        print("❌ Erro: REPO_OWNER não encontrado!")
        print("💡 Adicione ao arquivo .env:")
        print("   REPO_OWNER=seu-usuario-github")
        sys.exit(1)

    return config


def read_csv_file(filepath: str) -> str:
    """Lê arquivo CSV e retorna conteúdo."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        print(f"❌ Erro: Arquivo '{filepath}' não encontrado!")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Erro ao ler arquivo: {e}")
        sys.exit(1)


def trigger_github_action(
    config: dict,
    csv_content: str,
    use_base64: bool = False,
    callback_url: Optional[str] = None
) -> bool:
    """
    Aciona GitHub Action via repository_dispatch.

    Args:
        config: Dicionário com configurações (token, repo, etc)
        csv_content: Conteúdo do arquivo CSV
        use_base64: Se True, envia CSV em base64 (recomendado para arquivos grandes)
        callback_url: URL para receber resultado via webhook

    Returns:
        True se sucesso, False caso contrário
    """
    url = f"https://api.github.com/repos/{config['repo_owner']}/{config['repo_name']}/dispatches"

    headers = {
        'Accept': 'application/vnd.github+json',
        'Authorization': f"Bearer {config['github_token']}",
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
    }

    # Preparar payload
    client_payload = {}

    if use_base64:
        csv_base64 = base64.b64encode(csv_content.encode('utf-8')).decode('utf-8')
        client_payload['csv_base64'] = csv_base64
    else:
        client_payload['csv_content'] = csv_content

    if callback_url or config['callback_url']:
        client_payload['callback_url'] = callback_url or config['callback_url']

    payload = {
        'event_type': 'process-inscricoes',
        'client_payload': client_payload
    }

    # Enviar requisição
    try:
        print(f"🚀 Enviando requisição para GitHub Actions...")
        print(f"   Repositório: {config['repo_owner']}/{config['repo_name']}")

        response = requests.post(url, headers=headers, json=payload)

        if response.status_code == 204:
            print("✅ Processamento iniciado com sucesso!")
            print(f"\n📍 Acompanhe em: https://github.com/{config['repo_owner']}/{config['repo_name']}/actions")

            if client_payload.get('callback_url'):
                print(f"🔔 Resultados serão enviados para: {client_payload['callback_url']}")
            else:
                print("💡 Os resultados estarão disponíveis nos artifacts da action")

            return True
        else:
            print(f"❌ Erro ao acionar GitHub Action: {response.status_code}")
            print(f"   Resposta: {response.text}")
            return False

    except Exception as e:
        print(f"❌ Erro na requisição: {e}")
        return False


def main():
    """Função principal."""
    print("╔═══════════════════════════════════════════════════════════════╗")
    print("║          🏃‍♂️ Sprinta Scraper - GitHub Actions Trigger        ║")
    print("╚═══════════════════════════════════════════════════════════════╝\n")

    # Verificar argumentos
    if len(sys.argv) < 2:
        print("❌ Uso: python trigger_github_action.py <arquivo.csv>")
        print("\nExemplo:")
        print("  python trigger_github_action.py participants.csv")
        sys.exit(1)

    csv_filepath = sys.argv[1]

    # Carregar configurações
    config = load_config()

    # Ler arquivo CSV
    print(f"📄 Lendo arquivo: {csv_filepath}")
    csv_content = read_csv_file(csv_filepath)

    # Contar linhas (participantes)
    lines = csv_content.strip().split('\n')
    num_participants = len(lines) - 1  # Subtrair cabeçalho
    print(f"👥 Participantes encontrados: {num_participants}")

    # Determinar se deve usar base64 (arquivos > 10KB)
    csv_size = len(csv_content.encode('utf-8'))
    use_base64 = csv_size > 10240  # 10KB

    if use_base64:
        print(f"📦 Arquivo grande ({csv_size} bytes), usando codificação base64")

    # Estimar tempo de processamento
    estimated_time_seconds = num_participants * 8  # ~8s por participante em modo rápido
    estimated_time_minutes = estimated_time_seconds / 60
    print(f"⏱️  Tempo estimado: ~{estimated_time_minutes:.1f} minutos")

    print("\n" + "="*60)

    # Acionar GitHub Action
    success = trigger_github_action(
        config=config,
        csv_content=csv_content,
        use_base64=use_base64,
        callback_url=None  # Ou passe uma URL específica aqui
    )

    if success:
        print("\n" + "="*60)
        print("✅ SUCESSO!")
        print("="*60)
        print("\n📋 Próximos passos:")
        print("   1. Acesse a aba Actions no GitHub")
        print(f"   2. URL: https://github.com/{config['repo_owner']}/{config['repo_name']}/actions")
        print("   3. Aguarde o processamento (acompanhe logs em tempo real)")
        print("   4. Baixe os resultados em 'Artifacts' → 'checkout-urls'")
        print("\n💡 Dica: Configure CALLBACK_URL no .env para receber resultados automaticamente")
    else:
        print("\n" + "="*60)
        print("❌ FALHA ao iniciar processamento")
        print("="*60)
        sys.exit(1)


if __name__ == '__main__':
    main()
