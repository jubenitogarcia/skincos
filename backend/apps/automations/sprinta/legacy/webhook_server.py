"""
Servidor webhook para receber CSV e acionar GitHub Actions automaticamente.

Este servidor Flask expõe um endpoint que:
1. Recebe um arquivo CSV via POST
2. Aciona automaticamente a GitHub Action
3. Retorna o status da operação

Uso:
    python webhook_server.py

Endpoint:
    POST http://localhost:5000/webhook/sprinta

    Body (form-data):
        - file: arquivo CSV

    ou

    Body (JSON):
        - csv_content: string com conteúdo do CSV
"""

import os
import json
import requests
from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
import logging

# Carregar variáveis de ambiente
# override=True força .env a sobrescrever variáveis do shell
load_dotenv(override=True)

# Configuração do Flask
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max

# Configuração de logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configurações do GitHub
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN')
GITHUB_REPO_OWNER = os.environ.get('GITHUB_REPO_OWNER', 'jubenitogarcia')
GITHUB_REPO_NAME = os.environ.get('GITHUB_REPO_NAME', 'Sprinta-Scraper')
WEBHOOK_SECRET = os.environ.get('WEBHOOK_SECRET', 'change-this-secret')

def validate_secret(request_secret):
    """Valida o secret token para segurança."""
    return request_secret == WEBHOOK_SECRET

def trigger_github_action(csv_content, callback_url=None):
    """
    Aciona a GitHub Action via repository_dispatch.

    Args:
        csv_content: Conteúdo do arquivo CSV
        callback_url: URL para receber o resultado (opcional)

    Returns:
        tuple: (success: bool, message: str)
    """
    if not GITHUB_TOKEN:
        return False, "GitHub token não configurado"

    url = f"https://api.github.com/repos/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/dispatches"

    headers = {
        'Accept': 'application/vnd.github+json',
        'Authorization': f'Bearer {GITHUB_TOKEN}',
        'X-GitHub-Api-Version': '2022-11-28',
    }

    payload = {
        'event_type': 'process-inscricoes',
        'client_payload': {
            'csv_content': csv_content
        }
    }

    if callback_url:
        payload['client_payload']['callback_url'] = callback_url

    try:
        response = requests.post(url, headers=headers, json=payload)

        if response.status_code == 204:
            return True, "GitHub Action acionada com sucesso"
        else:
            return False, f"Erro ao acionar GitHub Action: {response.status_code} - {response.text}"

    except Exception as e:
        return False, f"Erro na requisição: {str(e)}"

@app.route('/health', methods=['GET'])
def health_check():
    """Endpoint de health check."""
    return jsonify({
        'status': 'healthy',
        'service': 'Sprinta Webhook Server',
        'github_token_configured': bool(GITHUB_TOKEN)
    }), 200

@app.route('/webhook/sprinta', methods=['POST'])
def webhook_sprinta():
    """
    Endpoint principal que recebe CSV e aciona GitHub Action.

    Aceita:
    1. Arquivo CSV via multipart/form-data (campo 'file')
    2. JSON com campo 'csv_content'

    Headers opcionais:
    - X-Secret-Token: Token de segurança
    - X-Callback-URL: URL para receber resultados
    """
    # Validar secret token
    secret_token = request.headers.get('X-Secret-Token')
    if not validate_secret(secret_token):
        logger.warning("Tentativa de acesso sem token válido")
        return jsonify({'error': 'Token de autorização inválido'}), 403

    # Obter callback URL (opcional)
    callback_url = request.headers.get('X-Callback-URL')

    csv_content = None

    # Opção 1: Arquivo CSV enviado
    if 'file' in request.files:
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'Nenhum arquivo selecionado'}), 400

        if not file.filename.endswith('.csv'):
            return jsonify({'error': 'Arquivo deve ser CSV'}), 400

        csv_content = file.read().decode('utf-8')
        logger.info(f"Arquivo CSV recebido: {file.filename}")

    # Opção 2: JSON com csv_content
    elif request.is_json:
        data = request.get_json()
        csv_content = data.get('csv_content')
        if callback_url is None:
            callback_url = data.get('callback_url')
        logger.info("CSV recebido via JSON")

    else:
        return jsonify({'error': 'Envie um arquivo CSV ou JSON com csv_content'}), 400

    if not csv_content:
        return jsonify({'error': 'Conteúdo CSV vazio'}), 400

    # Contar participantes
    lines = csv_content.strip().split('\n')
    num_participants = len(lines) - 1  # Subtrair cabeçalho

    logger.info(f"Processando {num_participants} participante(s)")

    # Acionar GitHub Action
    success, message = trigger_github_action(csv_content, callback_url)

    if success:
        logger.info("GitHub Action acionada com sucesso")
        return jsonify({
            'status': 'success',
            'message': message,
            'participants': num_participants,
            'estimated_time_seconds': num_participants * 8,
            'actions_url': f'https://github.com/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/actions'
        }), 202  # 202 Accepted
    else:
        logger.error(f"Erro ao acionar GitHub Action: {message}")
        return jsonify({
            'status': 'error',
            'message': message
        }), 500

@app.route('/webhook/sprinta/callback', methods=['POST'])
def webhook_callback():
    """
    Endpoint para receber os resultados da GitHub Action.

    Este endpoint é chamado pela GitHub Action quando o processamento
    termina, com as URLs de checkout geradas.
    """
    if not request.is_json:
        return jsonify({'error': 'Content-Type deve ser application/json'}), 400

    results = request.get_json()

    logger.info(f"Resultados recebidos: {len(results)} participante(s)")

    # Aqui você pode processar os resultados:
    # - Salvar no banco de dados
    # - Enviar e-mails para os participantes
    # - Notificar sistema externo
    # - etc.

    for result in results:
        email = result.get('email')
        checkout_url = result.get('checkout_url')
        logger.info(f"  {email}: {checkout_url}")

        # Exemplo: enviar e-mail
        # send_email(email, checkout_url)

    return jsonify({
        'status': 'success',
        'message': f'Processados {len(results)} resultados'
    }), 200

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handler para arquivo muito grande."""
    return jsonify({'error': 'Arquivo muito grande (máximo 16MB)'}), 413

@app.errorhandler(500)
def internal_error(error):
    """Handler para erros internos."""
    logger.error(f"Erro interno: {error}")
    return jsonify({'error': 'Erro interno do servidor'}), 500

if __name__ == '__main__':
    # Verificar configurações obrigatórias
    if not GITHUB_TOKEN:
        logger.error("ERRO: GITHUB_TOKEN não configurado!")
        logger.error("Configure no arquivo .env:")
        logger.error("  GITHUB_TOKEN=ghp_seu_token_aqui")
        exit(1)

    # Porta configurável (5001 por padrão para evitar conflito com AirPlay no macOS)
    PORT = int(os.environ.get('WEBHOOK_PORT', 5001))

    logger.info("="*70)
    logger.info("🚀 WEBHOOK SERVER - SPRINTA SCRAPER")
    logger.info("="*70)
    logger.info(f"Repositório: {GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}")
    logger.info(f"Endpoint: http://localhost:{PORT}/webhook/sprinta")
    logger.info(f"Health Check: http://localhost:{PORT}/health")
    logger.info(f"Secret configurado: {bool(WEBHOOK_SECRET)}")
    logger.info("="*70)
    logger.info("💡 Para usar porta diferente: WEBHOOK_PORT=8080 python webhook_server.py")
    logger.info("="*70)

    # Rodar servidor
    app.run(host='0.0.0.0', port=PORT, debug=True)
