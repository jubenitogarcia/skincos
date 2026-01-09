"""
Cliente de exemplo para testar o webhook server.

Este script demonstra como enviar um CSV para o webhook server.
"""

import requests
import sys

# Configuração
WEBHOOK_URL = "http://localhost:5001/webhook/sprinta"
SECRET_TOKEN = "change-this-secret"  # Deve coincidir com WEBHOOK_SECRET no servidor
CALLBACK_URL = "http://localhost:5001/webhook/sprinta/callback"  # Opcional

def send_csv_file(csv_filepath):
    """
    Envia arquivo CSV para o webhook.

    Args:
        csv_filepath: Caminho para o arquivo CSV
    """
    print(f"📤 Enviando arquivo: {csv_filepath}")

    with open(csv_filepath, 'rb') as f:
        files = {'file': f}
        headers = {
            'X-Secret-Token': SECRET_TOKEN,
            'X-Callback-URL': CALLBACK_URL
        }

        response = requests.post(WEBHOOK_URL, files=files, headers=headers)

    return response

def send_csv_json(csv_content):
    """
    Envia conteúdo CSV via JSON para o webhook.

    Args:
        csv_content: String com conteúdo do CSV
    """
    print("📤 Enviando CSV via JSON")

    headers = {
        'X-Secret-Token': SECRET_TOKEN,
        'X-Callback-URL': CALLBACK_URL,
        'Content-Type': 'application/json'
    }

    data = {
        'csv_content': csv_content,
        'callback_url': CALLBACK_URL
    }

    response = requests.post(WEBHOOK_URL, json=data, headers=headers)

    return response

def test_health():
    """Testa o health check do servidor."""
    print("🏥 Testando health check...")

    response = requests.get("http://localhost:5000/health")

    print(f"Status: {response.status_code}")
    print(f"Resposta: {response.json()}")
    print()

if __name__ == '__main__':
    print("╔═══════════════════════════════════════════════════════════════╗")
    print("║          🧪 TESTE DO WEBHOOK - SPRINTA SCRAPER               ║")
    print("╚═══════════════════════════════════════════════════════════════╝")
    print()

    # Health check
    test_health()

    # Exemplo 1: Enviar arquivo CSV
    if len(sys.argv) > 1:
        csv_file = sys.argv[1]
        response = send_csv_file(csv_file)
    else:
        # Exemplo 2: Enviar CSV via JSON (dados de teste)
        csv_content = """name;email;phone;cpf;bday;gender;shirt_size;team
João Silva;joao.teste@example.com;51999990000;02443423000;01/01/1985;m;G;Equipe Alpha"""

        response = send_csv_json(csv_content)

    # Exibir resultado
    print()
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print(f"📊 RESULTADO:")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print(f"Status Code: {response.status_code}")
    print(f"Resposta: {response.json()}")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    if response.status_code == 202:
        print()
        print("✅ GitHub Action acionada com sucesso!")
        print("🔗 Acompanhe em:", response.json().get('actions_url'))
    else:
        print()
        print("❌ Erro ao acionar GitHub Action")
