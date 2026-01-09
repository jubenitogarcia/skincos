#!/usr/bin/env python3
"""
Teste completo de todos os cenários: NH/BSS + Morning/Evening
"""

import logging
import sys
import os

# Adicionar diretório raiz ao path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from automation.messages import MessageGenerator

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def test_all_scenarios():
    """Testa todos os cenários: NH/BSS + Morning/Evening"""

    logger.info("🧪 === TESTE COMPLETO TODOS OS CENÁRIOS ===")

    # Dados simulados padrão
    valores_base = {
        'unit_name': 'TEST',
        'data_referencia_4': '08/08/2025',
        'meta_1a': 'R$ 1.500',
        'meta_2a': 'R$ 2.000',
        'meta_3a': 'R$ 2.500',
        'meta_super': 'R$ 3.000',
        'data_referencia_1': '1ª',
        'data_referencia_2': '2ª',
        'data_referencia_3': 'agosto',
        'acumulado_semana': 'R$ 6.500',
        'status_semana_1a': 'R$ 8.000',
        'status_semana_2a': 'R$ 10.000',
        'status_semana_3a': 'R$ 12.000',
        'status_semana_super': 'R$ 15.000',
        'venda_hoje': 'R$ 1.200',
        # Status icons
        'status_1a': '❌',
        'status_2a': '❌',
        'status_3a': '❌',
        'status_super': '❌',
        'status_1a_text': ' - faltou R$ 300',
        'status_2a_text': ' - faltou R$ 800',
        'status_3a_text': ' - faltou R$ 1.300',
        'status_super_text': ' - faltou R$ 1.800'
    }

    metas_atingidas = {
        '1a': False,
        '2a': False,
        '3a': False,
        'super': False
    }

    # URL simulada do gráfico
    chart_url = "https://quickchart.io/chart?c=%7B%22type%22%3A%22line%22%7D"

    # Cenários para testar
    scenarios = [
        {'cell_set': 'nh', 'period': 'morning', 'name': 'NH Manhã'},
        {'cell_set': 'nh', 'period': 'evening', 'name': 'NH Noite'},
        {'cell_set': 'bss', 'period': 'morning', 'name': 'BSS Manhã'},
        {'cell_set': 'bss', 'period': 'evening', 'name': 'BSS Noite'}
    ]

    message_generator = MessageGenerator()

    results = {}

    for scenario in scenarios:
        try:
            logger.info(f"🎯 Testando {scenario['name']}...")

            # Ajustar dados para o cenário
            valores_scenario = valores_base.copy()
            valores_scenario['unit_name'] = scenario['cell_set'].upper()

            # Gerar mensagem
            mensagem = message_generator.generate(
                values=valores_scenario,
                cell_set=scenario['cell_set'],
                period=scenario['period'],
                metas_atingidas=metas_atingidas,
                chart_image_url=chart_url
            )

            # Análise
            has_agent_zero = "Mensagem Motivacional:" in mensagem or "Bom dia" in mensagem or "Boa noite" in mensagem
            has_chart_ref = chart_url in mensagem or "gráfico" in mensagem.lower()

            results[scenario['name']] = {
                'success': True,
                'has_agent_zero': has_agent_zero,
                'has_chart_ref': has_chart_ref,
                'message_length': len(mensagem),
                'sample': mensagem[:200] + "..." if len(mensagem) > 200 else mensagem
            }

            logger.info(f"✅ {scenario['name']}: {len(mensagem)} chars, Agent-Zero: {has_agent_zero}")

        except Exception as e:
            logger.error(f"❌ Erro em {scenario['name']}: {e}")
            results[scenario['name']] = {
                'success': False,
                'error': str(e)
            }

    # Relatório final
    logger.info("📊 === RELATÓRIO FINAL ===")

    for scenario_name, result in results.items():
        if result['success']:
            agent_status = "✅" if result['has_agent_zero'] else "❌"
            logger.info(f"{scenario_name}: {agent_status} Agent-Zero | {result['message_length']} chars")
        else:
            logger.info(f"{scenario_name}: ❌ ERRO - {result['error']}")

    # Verificar inconsistências
    logger.info("🔍 === ANÁLISE DE CONSISTÊNCIA ===")

    morning_scenarios = [k for k in results.keys() if 'Manhã' in k]
    evening_scenarios = [k for k in results.keys() if 'Noite' in k]

    # Verificar se manhã tem Agent-Zero
    morning_agent_zero = all(results[s].get('has_agent_zero', False) for s in morning_scenarios if results[s]['success'])

    # Verificar se noite tem Agent-Zero
    evening_agent_zero = all(results[s].get('has_agent_zero', False) for s in evening_scenarios if results[s]['success'])

    logger.info(f"Manhã (NH + BSS) com Agent-Zero: {morning_agent_zero}")
    logger.info(f"Noite (NH + BSS) com Agent-Zero: {evening_agent_zero}")

    if not evening_agent_zero:
        logger.info("⚠️ AÇÃO NECESSÁRIA: Template da noite precisa incluir frase motivacional")

    if morning_agent_zero and evening_agent_zero:
        logger.info("✅ Todos os cenários estão com Agent-Zero integrado!")

    return results

if __name__ == "__main__":
    test_all_scenarios()
