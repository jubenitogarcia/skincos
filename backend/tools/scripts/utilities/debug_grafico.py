#!/usr/bin/env python3
"""
Debug do processo de anexo de gráfico no WhatsApp
"""

import logging
import sys
import os

# Adicionar diretório raiz ao path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from automation.executor import AutomationExecutor
from automation.downloads import ChartDownloader
from config import ConfigManager

# Configurar logging detalhado
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def debug_chart_process():
    """Debug completo do processo de gráfico"""

    logger.info("🔍 === DEBUG PROCESSO GRÁFICO ===")

    try:
        # 1. Verificar configuração
        logger.info("📊 1. Verificando configuração...")
        config = ConfigManager.get_config()

        nh_config = config.get('units', {}).get('nh', {})
        chart_id_morning = nh_config.get('chart_id_morning')

        logger.info(f"🎯 NH Config: {nh_config}")
        logger.info(f"📈 Chart ID Morning: {chart_id_morning}")

        if not chart_id_morning:
            logger.error("❌ Chart ID morning não encontrado na configuração!")
            return

        # 2. Testar ChartDownloader
        logger.info("📥 2. Testando ChartDownloader...")
        chart_downloader = ChartDownloader()

        logger.info(f"📊 Obtendo URL pública para chart_id: {chart_id_morning}")
        media_url = chart_downloader.get_chart_public_url(chart_id_morning)

        if media_url:
            logger.info(f"✅ URL obtida com sucesso: {media_url}")
        else:
            logger.error("❌ Falha ao obter URL pública do gráfico")
            return

        # 3. Testar AutomationExecutor
        logger.info("🤖 3. Testando AutomationExecutor...")
        executor = AutomationExecutor()

        # Executar com debug detalhado
        logger.info("🚀 Executando automação com debug...")
        result = executor.execute('nh', None, True, 'morning')

        logger.info(f"📊 Resultado: {result}")

        logger.info("✅ Debug concluído!")

    except Exception as e:
        logger.error(f"❌ Erro durante debug: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    debug_chart_process()
