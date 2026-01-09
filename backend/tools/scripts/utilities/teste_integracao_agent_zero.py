#!/usr/bin/env python3
"""
Teste da integração Agent-Zero no template NH Morning
"""

import logging
import sys
import os

# Adicionar diretório raiz ao path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from automation.messages import MessageGenerator
from a0.agentzero.service import AgentZeroService

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def test_agent_zero_integration():
    """Testa a integração Agent-Zero no template"""

    logger.info("🤖 === TESTE INTEGRAÇÃO AGENT-ZERO NO TEMPLATE ===")

    try:
        # 1. Dados simulados do NH manhã
        valores_simulados = {
            'unit_name': 'NH',
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
            'status_semana_super': 'R$ 15.000'
        }

        metas_atingidas = {
            '1a': False,
            '2a': False,
            '3a': False,
            'super': False
        }

        # URL simulada do gráfico
        chart_url = "https://quickchart.io/chart?c=%7B%22type%22%3A%22line%22%7D"

        # 2. Gerar mensagem com Agent-Zero
        logger.info("🎯 Gerando mensagem com Agent-Zero integrado...")

        message_generator = MessageGenerator()

        mensagem_completa = message_generator.generate(
            values=valores_simulados,
            cell_set='nh',
            period='morning',
            metas_atingidas=metas_atingidas,
            chart_image_url=chart_url
        )

        # 3. Exibir resultado
        logger.info("📄 === MENSAGEM GERADA COM AGENT-ZERO ===")
        logger.info("=" * 60)
        logger.info(mensagem_completa)
        logger.info("=" * 60)

        # 4. Análise
        logger.info("🔍 === ANÁLISE DA INTEGRAÇÃO ===")
        logger.info(f"📝 Tamanho da mensagem: {len(mensagem_completa)} caracteres")

        if "Mensagem Motivacional:" in mensagem_completa:
            logger.info("✅ Seção 'Mensagem Motivacional' encontrada no template")
        else:
            logger.info("❌ Seção 'Mensagem Motivacional' NÃO encontrada")

        if "Agent-Zero" in mensagem_completa or "Bom dia" in mensagem_completa:
            logger.info("✅ Frase do Agent-Zero detectada na mensagem")
        else:
            logger.info("❌ Frase do Agent-Zero NÃO detectada")

        # Verificar se há frase motivacional
        lines = mensagem_completa.split('\n')
        motivational_section = False
        for line in lines:
            if "Mensagem Motivacional:" in line:
                motivational_section = True
                break

        if motivational_section:
            logger.info("✅ Template integrado corretamente com Agent-Zero")
        else:
            logger.info("⚠️ Verificar integração do template")

        logger.info("🎉 Teste de integração concluído!")

        return mensagem_completa

    except Exception as e:
        logger.error(f"❌ Erro durante teste: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    test_agent_zero_integration()
