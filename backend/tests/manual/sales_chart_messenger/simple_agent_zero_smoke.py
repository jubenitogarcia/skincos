#!/usr/bin/env python3
"""
Teste simplificado do Agent-Zero
"""

import requests
import json

def test_agent_zero_simple():
    """Teste direto da API Agent-Zero"""
    print("🧪 Testando Agent-Zero API...")

    try:
        # Testar endpoint de health
        print("📡 Testando conectividade...")
        health_response = requests.get("https://a0.skincos.com.br/health", timeout=10)
        print(f"Health Status: {health_response.status_code}")

        if health_response.status_code == 200:
            print("✅ Agent-Zero está online!")
        else:
            print(f"⚠️ Agent-Zero respondeu com status: {health_response.status_code}")

        # Testar geração de frase
        print("🎯 Testando geração de frase motivacional...")

        payload = {
            "context": "Equipe NH teve vendas de R$ 120.000 hoje, batendo a meta diária (100%). Performance excelente!",
            "team": "Novo Hamburgo",
            "period": "noite",
            "performance_data": {
                "sales": [120000, 95000, 80000],
                "goals_achieved": ["Meta Diária: ✅ R$ 120.000 (100%)"]
            }
        }

        response = requests.post(
            "https://a0.skincos.com.br/generate-phrase",
            json=payload,
            timeout=30
        )

        print(f"Geração Status: {response.status_code}")

        if response.status_code == 200:
            result = response.json()
            phrase = result.get("phrase", "Frase não encontrada")
            print(f"💬 Frase gerada: {phrase}")
            print("✅ Teste concluído com sucesso!")
        else:
            print(f"❌ Erro na geração: {response.status_code} - {response.text}")

    except requests.exceptions.RequestException as e:
        print(f"❌ Erro de conexão: {str(e)}")
    except Exception as e:
        print(f"❌ Erro inesperado: {str(e)}")

if __name__ == "__main__":
    test_agent_zero_simple()
