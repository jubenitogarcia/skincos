#!/usr/bin/env python3
"""
ENVIO REAL para 555195103563 - NH Manhã com Agent-Zero
"""

import logging
import sys
import os
from datetime import datetime

# Adicionar diretório raiz ao path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

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

def enviar_real():
    """ENVIO REAL para o Juberto"""

    logger.info("📲 === ENVIO REAL NH MANHÃ PARA JUBERTO ===")

    try:
        # 1. Dados do NH manhã
        unit_info = {
            'unit': 'nh',
            'period': 'morning',
            'team': 'Novo Hamburgo Manhã',
            'greeting': 'Bom dia'
        }

        # Dados de vendas de hoje
        sales_data = {
            'venda_hoje': 142000,    # R$ 1.420,00
            'venda_ontem': 98000,    # R$ 980,00
            'meta_diaria': 150000,   # R$ 1.500,00
            'meta_semanal': 800000,  # R$ 8.000,00
            'meta_mensal': 3200000,  # R$ 32.000,00
            'acumulado_semana': 650000,  # R$ 6.500,00
            'data_referencia': datetime.now().strftime('%d/%m/%Y')
        }

        # 2. Gerar gráfico QuickChart
        logger.info("📈 Gerando gráfico...")

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
        logger.info(f"✅ Gráfico criado: {chart_url[:100]}...")

        # 3. Gerar frase com Agent-Zero
        logger.info("🤖 Chamando Agent-Zero...")

        agent_service = AgentZeroService()

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

        logger.info(f"💬 Agent-Zero respondeu: {motivational_phrase[:100]}...")

        # 4. Montar mensagem final
        performance_msg = f"""🌅 *{unit_info['greeting']}, {unit_info['team']}!*

📊 *Performance de Hoje ({sales_data['data_referencia']}):*
• Vendas: R$ {sales_data['venda_hoje']/100:.2f}
• Meta: R$ {sales_data['meta_diaria']/100:.2f}
• Progresso: {(sales_data['venda_hoje']/sales_data['meta_diaria']*100):.1f}%

📈 *Comparativo:*
• Ontem: R$ {sales_data['venda_ontem']/100:.2f}
• Crescimento: +R$ {(sales_data['venda_hoje']-sales_data['venda_ontem'])/100:.2f} (+{((sales_data['venda_hoje']/sales_data['venda_ontem'])-1)*100:.1f}%)

🎯 *Acumulado Semanal:*
• Atual: R$ {sales_data['acumulado_semana']/100:.2f}
• Meta: R$ {sales_data['meta_semanal']/100:.2f}
• Progresso: {(sales_data['acumulado_semana']/sales_data['meta_semanal']*100):.1f}%

💪 *Mensagem do Agent-Zero:*
{motivational_phrase}

📈 Veja o gráfico em anexo!

_Powered by SKINCOS + Agent-Zero_"""

        # 5. ENVIO REAL PARA WHATSAPP
        logger.info("📱 === ENVIANDO PARA SEU WHATSAPP ===")

        target_number = "555195103563"

        # Criar bulk sender
        bulk_sender = WhatsAppBulkSender()

        # Lista de telefones (formato correto)
        phones_list = [target_number]

        logger.info(f"📞 Enviando mensagem para {target_number}...")
        logger.info(f"📝 Tamanho: {len(performance_msg)} caracteres")
        logger.info(f"🔗 Gráfico: {len(chart_url)} caracteres")

        # ENVIO REAL
        bulk_sender.send_bulk(phones_list, performance_msg, chart_url)

        logger.info("📊 === RESULTADO DO ENVIO ===")
        logger.info(f"✅ Total enviado: {len(bulk_sender.successful_sends)}")
        logger.info(f"❌ Total falhado: {len(bulk_sender.failed_sends)}")

        if bulk_sender.successful_sends:
            logger.info(f"📱 Sucesso: {bulk_sender.successful_sends}")

        if bulk_sender.failed_sends:
            logger.info(f"⚠️ Falharam: {bulk_sender.failed_sends}")

        # Criar resultado compatível
        result = {
            'total_sent': len(bulk_sender.successful_sends),
            'total_failed': len(bulk_sender.failed_sends),
            'success_numbers': bulk_sender.successful_sends,
            'failed_numbers': bulk_sender.failed_sends
        }        # Log da mensagem enviada
        logger.info("📄 === MENSAGEM ENVIADA ===")
        logger.info(performance_msg)
        logger.info("=" * 50)

        logger.info("🎉 ENVIO REAL CONCLUÍDO!")

        return {
            'success': True,
            'target': target_number,
            'message': performance_msg,
            'chart_url': chart_url,
            'motivational_phrase': motivational_phrase,
            'send_result': result
        }

    except Exception as e:
        logger.error(f"❌ Erro durante envio real: {e}")
        import traceback
        traceback.print_exc()
        return {'success': False, 'error': str(e)}

if __name__ == "__main__":
    enviar_real()
