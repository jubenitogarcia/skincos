#!/usr/bin/env python3
"""
Teste direto do serviço Agent-Zero
"""

import sys
import os
import json
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from a0.agentzero.service import AgentZeroService

def test_agent_zero_direct():
    """Teste direto do serviço Agent-Zero"""
    print("🧪 Testando serviço Agent-Zero...")

    # Dados de exemplo para NH noite
    sample_data = {
        "values": [120000, 95000, 80000],  # Vendas de exemplo
        "cell_set": "NH",
        "period": "evening",
        "goals_achieved": ["Meta Diária: ✅ R$ 120.000 (100%)"],
        "chart_image_url": "https://example.com/chart.png"
    }

    try:
        service = AgentZeroService()
        print("📡 Conectando com Agent-Zero...")

        # Testar conexão
        if service.test_connection():
            print("✅ Conexão com Agent-Zero OK")
        else:
            print("⚠️ Conexão com Agent-Zero falhou, usando fallback")

        # Gerar frase motivacional
        print("🎯 Gerando frase motivacional...")
        phrase = service.generate_motivational_phrase(
            sample_data["values"],
            sample_data["cell_set"],
            sample_data["period"],
            sample_data["goals_achieved"],
            sample_data["chart_image_url"]
        )

        print(f"💬 Frase gerada: {phrase}")
        print("✅ Teste concluído com sucesso!")
        return True

    except Exception as e:
        print(f"❌ Erro no teste: {str(e)}")
        return False

if __name__ == "__main__":
    test_agent_zero_direct()
