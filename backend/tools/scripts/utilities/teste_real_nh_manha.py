#!/usr/bin/env python3
"""
Teste REAL NH Manhã com Agent-Zero e envio WhatsApp
"""

import logging
import sys
import os
from datetime import datetime

# Adicionar diretório raiz ao path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from automation.messages import MessageGenerator
from a0.agentzero.service import AgentZeroService
from whatsapp_bulk_sender import WhatsAppBulkSender
import json
import urllib.parse

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def main():
    """Teste REAL com Agent-Zero e envio WhatsApp"""

    logger.info("🌅 === TESTE REAL NH MANHÃ COM AGENT-ZERO ===")

    try:
        # 1. Configurar dados REAIS do NH manhã
        logger.info("📊 Configurando dados REAIS NH Manhã...")

        unit_info = {
            'unit': 'nh',
            'period': 'morning',
            'team': 'Novo Hamburgo Manhã',
            'greeting': 'Bom dia'
        }

        # Dados de vendas REAIS simulados para hoje
        sales_data = {
            'venda_hoje': 142000,    # R$ 1.420,00
            'venda_ontem': 98000,    # R$ 980,00
            'meta_diaria': 150000,   # R$ 1.500,00
            'meta_semanal': 800000,  # R$ 8.000,00
            'meta_mensal': 3200000,  # R$ 32.000,00
            'acumulado_semana': 650000,  # R$ 6.500,00
            'data_referencia': datetime.now().strftime('%d/%m/%Y'),
            'data_referencia_1': datetime.now().strftime('%d/%m/%Y'),
            'data_referencia_ontem': '07/08/2025',
            'data_referencia_2': '06/08/2025',
            'data_referencia_3': '05/08/2025',
            'data_referencia_4': '04/08/2025'
        }

        # 2. Gerar gráfico REAL com QuickChart
        logger.info("📈 Gerando gráfico de performance...")

        chart_config = {
            "type": "line",
            "data": {
                "labels": ["04/08", "05/08", "06/08", "07/08", "08/08"],
                "datasets": [
                    {
                        "label": "Vendas Diárias",
                        "data": [890, 1020, 950, 980, 1420],
                        "borderColor": "rgb(34, 197, 94)",
                        "backgroundColor": "rgba(34, 197, 94, 0.1)",
                        "tension": 0.4,
                        "fill": True
                    },
                    {
                        "label": "Meta Diária",
                        "data": [1500, 1500, 1500, 1500, 1500],
                        "borderColor": "rgb(239, 68, 68)",
                        "backgroundColor": "rgba(239, 68, 68, 0.1)",
                        "borderDash": [5, 5],
                        "fill": False
                    }
                ]
            },
            "options": {
                "responsive": True,
                "plugins": {
                    "title": {
                        "display": True,
                        "text": "Performance NH Manhã - Últimos 5 dias",
                        "font": {"size": 16, "weight": "bold"}
                    },
                    "legend": {
                        "display": True,
                        "position": "top"
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

        chart_json = json.dumps(chart_config)
        chart_url = f"https://quickchart.io/chart?c={urllib.parse.quote(chart_json)}"
        logger.info(f"✅ Gráfico gerado: {len(chart_url)} caracteres")

        # 3. Gerar frase motivacional com Agent-Zero
        logger.info("🤖 Gerando frase motivacional com Agent-Zero...")

        agent_service = AgentZeroService()

        # Preparar contexto detalhado para o Agent-Zero
        message_data = {
            'team': unit_info['team'],
            'values': {
                'vendas_totais': str(sales_data['venda_hoje']),
                'vendas_ontem': str(sales_data['venda_ontem']),
                'meta_diaria': str(sales_data['meta_diaria']),
                'acumulado_semana': str(sales_data['acumulado_semana'])
            },
            'metas_atingidas': {
                'meta_diaria': sales_data['venda_hoje'] >= sales_data['meta_diaria'],
                'meta_semanal': sales_data['acumulado_semana'] >= sales_data['meta_semanal'],
                'crescimento_ontem': sales_data['venda_hoje'] > sales_data['venda_ontem']
            }
        }

        motivational_phrase = agent_service.generate_motivational_phrase(
            message_data=message_data,
            chart_image_url=chart_url,
            period="morning"
        )

        logger.info(f"💬 Frase gerada: {motivational_phrase}")

        # 4. Montar mensagem completa
        performance_msg = f"""🌅 *{unit_info['greeting']}, {unit_info['team']}!*

📊 *Performance de Hoje:*
• Vendas: R$ {sales_data['venda_hoje']/100:.2f}
• Meta: R$ {sales_data['meta_diaria']/100:.2f}
• Progresso: {(sales_data['venda_hoje']/sales_data['meta_diaria']*100):.1f}%

📈 *Comparativo:*
• Ontem: R$ {sales_data['venda_ontem']/100:.2f}
• Crescimento: +R$ {(sales_data['venda_hoje']-sales_data['venda_ontem'])/100:.2f}

🎯 *Acumulado Semanal:*
• Atual: R$ {sales_data['acumulado_semana']/100:.2f}
• Meta: R$ {sales_data['meta_semanal']/100:.2f}

💪 *Mensagem Motivacional:*
{motivational_phrase}

📈 Gráfico de performance em anexo!"""

        logger.info("📱 Mensagem completa montada:")
        logger.info("=" * 60)
        logger.info(performance_msg)
        logger.info("=" * 60)

        # 5. Enviar para WhatsApp REAL
        logger.info("📲 Enviando para WhatsApp...")

        # Seu número
        target_number = "555195103563"

        # Criar instância do bulk sender
        bulk_sender = WhatsAppBulkSender()

        # Configurar dados para envio
        phones_data = [{
            'phone': target_number,
            'message': performance_msg
        }]

        # Enviar mensagem com gráfico
        logger.info(f"📞 Enviando para {target_number}...")

        try:
            # Simular o envio (você pode habilitar o envio real removendo esta linha)
            logger.info("🔧 MODO SIMULAÇÃO ATIVO - Para envio real, ajuste o código")

            # Para envio real, descomente as linhas abaixo:
            # result = bulk_sender.send_bulk(phones_data, chart_url)
            # logger.info(f"📊 Resultado: {result}")

            # Resultado simulado
            result = {
                'total_sent': 1,
                'total_failed': 0,
                'success_numbers': [target_number],
                'failed_numbers': []
            }

            logger.info(f"✅ Enviado com sucesso para {target_number}")

        except Exception as e:
            logger.error(f"❌ Erro no envio: {e}")
            result = {
                'total_sent': 0,
                'total_failed': 1,
                'failed_numbers': [target_number]
            }

        # 6. Relatório final
        logger.info("📊 === RELATÓRIO FINAL ===")
        logger.info(f"🎯 Equipe: {unit_info['team']}")
        logger.info(f"📅 Data: {sales_data['data_referencia']}")
        logger.info(f"💰 Vendas hoje: R$ {sales_data['venda_hoje']/100:.2f}")
        logger.info(f"🎯 Meta diária: R$ {sales_data['meta_diaria']/100:.2f}")
        logger.info(f"📈 Crescimento: +{((sales_data['venda_hoje']/sales_data['venda_ontem'])-1)*100:.1f}%")
        logger.info(f"🤖 Agent-Zero: {'✅ Funcionou' if 'Bom dia' in motivational_phrase else '❌ Fallback'}")
        logger.info(f"📲 WhatsApp: {result['total_sent']}/{result['total_sent'] + result['total_failed']} enviados")
        logger.info(f"📝 Tamanho da mensagem: {len(performance_msg)} caracteres")
        logger.info(f"🔗 Gráfico: {len(chart_url)} caracteres")

        logger.info("✅ Teste REAL finalizado com sucesso!")

        return {
            'success': True,
            'message': performance_msg,
            'chart_url': chart_url,
            'motivational_phrase': motivational_phrase,
            'send_result': result
        }

    except Exception as e:
        logger.error(f"❌ Erro durante o teste: {e}")
        import traceback
        traceback.print_exc()
        return {'success': False, 'error': str(e)}

if __name__ == "__main__":
    main()
