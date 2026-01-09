#!/usr/bin/env python3
"""
Teste completo do envio das metas de Novo Hamburgo da manhã
com Agent-Zero e gráfico integrados
"""

import logging
from datetime import datetime, date
import sys
import os

# Adicionar diretório raiz ao path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from automation.messages import MessageGenerator
from automation.executor import AutomationExecutor
from a0.agentzero.service import AgentZeroService
from utils.cloudinary_upload import upload_image_to_cloudinary

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def main():
    """Teste completo do NH manhã com Agent-Zero e gráfico"""

    logger.info("🌅 === TESTE NH MANHÃ COMPLETO COM AGENT-ZERO ===")

    try:
        # 1. Primeiro testar Agent-Zero
        logger.info("🤖 Testando conectividade com Agent-Zero...")
        agent_service = AgentZeroService()

        if agent_service.test_connection():
            logger.info("✅ Agent-Zero está funcionando!")
        else:
            logger.warning("⚠️ Agent-Zero não está respondendo, usando fallback")

        # 2. Configurar dados de teste do NH manhã
        logger.info("📊 Configurando dados de teste...")

        unit_info = {
            'unit': 'nh',
            'period': 'morning',
            'team': 'Novo Hamburgo Manhã',
            'greeting': 'Bom dia'
        }

        # Dados de vendas simulados
        sales_data = {
            'venda_hoje': 125000,  # R$ 1.250,00
            'venda_ontem': 98000,   # R$ 980,00
            'meta_diaria': 150000,  # R$ 1.500,00
            'meta_semanal': 800000, # R$ 8.000,00
            'meta_mensal': 3200000, # R$ 32.000,00
            'data_referencia': datetime.now().strftime('%d/%m/%Y'),
            'data_referencia_ontem': '07/08/2025',
            'data_referencia_2': '06/08/2025',
            'data_referencia_3': '05/08/2025',
            'data_referencia_4': '04/08/2025'  # Adicionando variável que estava faltando
        }

        # 3. Gerar gráfico usando QuickChart
        logger.info("� Gerando gráfico de vendas...")

        # Dados para o gráfico
        chart_config = {
            "type": "line",
            "data": {
                "labels": ["04/08", "05/08", "06/08", "07/08", "08/08"],
                "datasets": [
                    {
                        "label": "Vendas",
                        "data": [890, 1020, 950, 980, 1250],
                        "borderColor": "rgb(75, 192, 192)",
                        "backgroundColor": "rgba(75, 192, 192, 0.2)",
                        "tension": 0.1
                    },
                    {
                        "label": "Meta Diária",
                        "data": [1500, 1500, 1500, 1500, 1500],
                        "borderColor": "rgb(255, 99, 132)",
                        "backgroundColor": "rgba(255, 99, 132, 0.2)",
                        "borderDash": [5, 5]
                    }
                ]
            },
            "options": {
                "responsive": True,
                "plugins": {
                    "title": {
                        "display": True,
                        "text": "Performance NH Manhã - Últimos 5 dias"
                    }
                },
                "scales": {
                    "y": {
                        "beginAtZero": True,
                        "title": {
                            "display": True,
                            "text": "Vendas (R$)"
                        }
                    }
                }
            }
        }

        import json
        import urllib.parse

        chart_json = json.dumps(chart_config)
        chart_url = f"https://quickchart.io/chart?c={urllib.parse.quote(chart_json)}"
        logger.info(f"✅ Gráfico gerado: {chart_url[:80]}...")

        # 4. Gerar mensagem usando MessageGenerator
        logger.info("📝 Gerando mensagem com MessageGenerator...")

        message_generator = MessageGenerator()

        # Preparar dados no formato esperado pelo MessageGenerator
        values = {
            'vendas_totais': str(sales_data['venda_hoje']),
            'vendas_ontem': str(sales_data['venda_ontem']),
            'meta_diaria': str(sales_data['meta_diaria']),
            'data_referencia': sales_data['data_referencia'],
            'data_referencia_1': sales_data['data_referencia'],  # Mesmo valor
            'data_referencia_ontem': sales_data['data_referencia_ontem'],
            'data_referencia_2': sales_data['data_referencia_2'],
            'data_referencia_3': sales_data['data_referencia_3'],
            'data_referencia_4': sales_data['data_referencia_4']
        }

        metas_atingidas = {
            'meta_diaria': sales_data['venda_hoje'] >= sales_data['meta_diaria'],
            'meta_semanal': False,  # Simulado
            'meta_mensal': False    # Simulado
        }

        try:
            message_text = message_generator.generate(
                values=values,
                cell_set='nh',
                period='morning',
                metas_atingidas=metas_atingidas,
                chart_image_url=chart_url
            )

            logger.info(f"✅ Mensagem gerada: {len(message_text)} caracteres")
            logger.info(f"📄 Prévia: {message_text[:100]}...")
        except Exception as e:
            logger.error(f"❌ Erro ao gerar mensagem: {e}")
            message_text = f"Bom dia equipe {unit_info['team']}! Vendas hoje: R$ {sales_data['venda_hoje']/100:.2f}"        # 4. Testar Agent-Zero com dados reais
        logger.info("🤖 Testando Agent-Zero com dados reais...")

        message_data = {
            'team': unit_info['team'],
            'values': {
                'vendas_totais': str(sales_data['venda_hoje']),
                'vendas_ontem': str(sales_data['venda_ontem'])
            },
            'metas_atingidas': {
                'meta_diaria': sales_data['venda_hoje'] >= sales_data['meta_diaria'],
                'meta_semanal': False,  # Simulado
                'meta_mensal': False    # Simulado
            }
        }

        motivational_phrase = agent_service.generate_motivational_phrase(
            message_data=message_data,
            chart_image_url=chart_url,
            period="morning"
        )

        logger.info(f"💬 Frase motivacional: {motivational_phrase}")

        # 5. Combinar mensagem + frase motivacional
        final_message = f"{message_text}\n\n{motivational_phrase}"

        logger.info("📱 Mensagem final completa:")
        logger.info("=" * 50)
        logger.info(final_message)
        logger.info("=" * 50)



        # 5. Simular envio do WhatsApp
        logger.info("📲 Simulando envio via WhatsApp...")

        test_numbers = [
            "+5551999887766",
            "+5551988776655",
            "+5551977665544"
        ]

        success_count = 0
        for i, number in enumerate(test_numbers, 1):
            logger.info(f"📞 Enviando para {number} ({i}/{len(test_numbers)})...")

            # Simular envio (sem envio real)
            import time
            time.sleep(1)  # Simular latência

            # Simular sucesso (80% de chance)
            import random
            if random.random() > 0.2:
                logger.info(f"✅ Enviado com sucesso para {number}")
                success_count += 1
            else:
                logger.warning(f"❌ Falha ao enviar para {number}")

        # 7. Relatório final
        logger.info("📊 === RELATÓRIO FINAL ===")
        logger.info(f"🎯 Unidade: {unit_info['team']}")
        logger.info(f"📅 Data: {sales_data['data_referencia']}")
        logger.info(f"💰 Vendas hoje: R$ {sales_data['venda_hoje']/100:.2f}")
        logger.info(f"💰 Vendas ontem: R$ {sales_data['venda_ontem']/100:.2f}")
        logger.info(f"📈 Gráfico: {'✅ Gerado' if chart_url else '❌ Falhou'}")
        logger.info(f"🤖 Agent-Zero: {'✅ Funcionou' if 'Vamos' not in motivational_phrase else '❌ Fallback'}")
        logger.info(f"📲 WhatsApp: {success_count}/{len(test_numbers)} enviados")
        logger.info(f"📝 Tamanho da mensagem: {len(final_message)} caracteres")

        if chart_url:
            logger.info(f"🔗 URL do gráfico: {chart_url}")

        logger.info("✅ Teste completo finalizado com sucesso!")

    except Exception as e:
        logger.error(f"❌ Erro durante o teste: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
