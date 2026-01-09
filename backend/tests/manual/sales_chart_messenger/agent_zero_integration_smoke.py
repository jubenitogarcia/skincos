#!/usr/bin/env python3
"""
Teste da integração Agent-Zero com mensagem da noite para Novo Hamburgo
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from automation.executor import AutomationExecutor
from utils.logging import Logger

def test_agent_zero_integration():
    """Testa a integração com Agent-Zero usando mensagem da noite para NH"""
    logger = Logger()
    logger.info("🧪 Iniciando teste da integração Agent-Zero...")

    # Inicializar executor
    executor = AutomationExecutor()

    # Testar mensagem da noite para Novo Hamburgo (modo de teste)
    logger.info("📤 Executando mensagem da noite para NH (modo teste)...")
    result = executor.execute_evening("NH", test_mode=True)

    logger.info(f"📊 Resultado da execução: {result}")

    if result and result.get("success"):
        logger.info("✅ Teste da integração Agent-Zero concluído com sucesso!")
    else:
        logger.error("❌ Teste da integração Agent-Zero falhou")

    return result

if __name__ == "__main__":
    test_agent_zero_integration()
