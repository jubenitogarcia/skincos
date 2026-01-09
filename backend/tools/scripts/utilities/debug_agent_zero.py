#!/usr/bin/env python3
"""
Teste direto do Agent-Zero para debugging
"""

import requests
import json

def test_agent_zero_endpoints():
    """Testa todos os endpoints possíveis do Agent-Zero"""

    base_url = "https://a0.skincos.com.br"
    api_key = "553449Jbg*"

    print("🤖 === TESTE ENDPOINTS AGENT-ZERO ===")

    # 1. Health check
    print("\n1. Health Check:")
    try:
        response = requests.get(f"{base_url}/health", timeout=10)
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.json()}")
    except Exception as e:
        print(f"   Erro: {e}")

    # 2. Message endpoint (POST)
    print("\n2. Message endpoint (POST):")
    try:
        response = requests.post(
            f"{base_url}/message",
            json={"text": "Gere uma frase motivacional", "context": "test"},
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.text[:200]}...")
    except Exception as e:
        print(f"   Erro: {e}")

    # 3. External API endpoint
    print("\n3. External API endpoint:")
    try:
        response = requests.post(
            f"{base_url}/external_api",
            json={
                "api_key": api_key,
                "message": "Gere uma frase motivacional",
                "context": "test"
            },
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.text[:200]}...")
    except Exception as e:
        print(f"   Erro: {e}")

    # 4. Message Async endpoint
    print("\n4. Message Async endpoint:")
    try:
        response = requests.post(
            f"{base_url}/message_async",
            json={"text": "Gere uma frase motivacional", "context": "test"},
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.text[:200]}...")
    except Exception as e:
        print(f"   Erro: {e}")

    # 5. Tentar com diferentes headers
    print("\n5. Message com headers alternativos:")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "X-Requested-With": "XMLHttpRequest",
        "Origin": "https://a0.skincos.com.br",
        "Referer": "https://a0.skincos.com.br/"
    }

    try:
        response = requests.post(
            f"{base_url}/message",
            json={"text": "Gere uma frase motivacional", "context": "test"},
            headers=headers,
            timeout=10
        )
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.text[:200]}...")
    except Exception as e:
        print(f"   Erro: {e}")

    # 6. Tentar com sessão (cookies)
    print("\n6. Message com sessão:")
    try:
        session = requests.Session()

        # Primeiro fazer GET para pegar cookies/tokens
        get_response = session.get(f"{base_url}/health")
        print(f"   GET Health Status: {get_response.status_code}")

        # Agora POST com a sessão
        post_response = session.post(
            f"{base_url}/message",
            json={"text": "Gere uma frase motivacional", "context": "test"},
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        print(f"   POST Status: {post_response.status_code}")
        print(f"   Response: {post_response.text[:200]}...")
    except Exception as e:
        print(f"   Erro: {e}")

if __name__ == "__main__":
    test_agent_zero_endpoints()
