#!/usr/bin/env python3
"""
Teste direto da geração de mensagem com Agent-Zero
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

def test_message_generation():
    print("🧪 Testando geração de mensagem com Agent-Zero...")

    try:
        # Importar módulos necessários
        from automation.messages import MessageGenerator

        # Dados de exemplo para NH noite (formato correto que o template espera)
        values = {
            "venda_hoje": "120000",        # Template espera venda_hoje
            "vendas_ontem": "95000",
            "vendas_semana": "500000",
            "meta_1a": "80000",
            "meta_2a": "100000",
            "meta_3a": "120000",
            "meta_super": "150000"
        }
        cell_set = "NH"
        period = "evening"
        metas_atingidas = {
            "1a": True,       # Meta 1a atingida
            "2a": True,       # Meta 2a atingida
            "3a": True,       # Meta 3a atingida
            "super": False    # Meta super não atingida
        }
        chart_image_url = "https://quickchart.io/chart/nh-evening-sales.png"

        print(f"📊 Dados: {values}")
        print(f"🎯 Equipe: {cell_set}")
        print(f"🌙 Período: {period}")
        print(f"✅ Metas: {metas_atingidas}")
        print(f"📈 Gráfico: {chart_image_url}")
        print()

        # Gerar mensagem
        print("🎯 Gerando mensagem com Agent-Zero...")
        generator = MessageGenerator()

        message = generator.generate(
            values=values,
            cell_set=cell_set,
            period=period,
            metas_atingidas=metas_atingidas,
            chart_image_url=chart_image_url
        )

        print("📝 Mensagem gerada:")
        print("-" * 50)
        print(message)
        print("-" * 50)
        print("✅ Teste de geração concluído!")

    except Exception as e:
        print(f"❌ Erro: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_message_generation()
