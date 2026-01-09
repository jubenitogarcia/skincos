#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import argparse
import logging
from typing import Optional

# Imports dos módulos modularizados
from .utils import setup_logging
from config import ConfigManager, EnvironmentDetector

def create_cli_parser() -> argparse.ArgumentParser:
    """Cria parser da linha de comando"""
    parser = argparse.ArgumentParser(
        description='Sales Chart Messenger (WhatsApp)',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    # Argumentos principais
    parser.add_argument(
        '--mode',
        choices=['run', 'test', 'diagnose'],
        default='diagnose',
        help='Modo de operação (default: diagnose)'
    )

    parser.add_argument(
        '--period',
        choices=['morning', 'evening'],
        default='morning',
        help='Período da mensagem (default: morning)'
    )

    parser.add_argument(
        '--chart',
        type=str,
        help='ID do gráfico para anexar à mensagem'
    )

    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Modo verboso (mais logs)'
    )

    parser.add_argument(
        '--force',
        action='store_true',
        help='Força reenvio (ignora idempotência local para evitar duplicidade)'
    )

    # Argumento posicional para cell_set
    parser.add_argument(
        'cell_set',
        nargs='?',
        choices=['bss', 'nh'],
        help='Conjunto de células (obrigatório para run/test)'
    )

    return parser

def validate_arguments(args) -> None:
    """Valida argumentos da linha de comando"""
    # Para modos run e test, cell_set é obrigatório
    if args.mode in ['run', 'test'] and not args.cell_set:
        raise ValueError("Cell set (bss/nh) é obrigatório para modos 'run' e 'test'")

def run_diagnostics(logger: logging.Logger) -> int:
    """Executa diagnóstico completo do sistema"""
    logger.info("🔍 MODO DIAGNÓSTICO")
    logger.info("=" * 50)

    try:
        from .diagnostics import DiagnosticsRunner

        diagnostics = DiagnosticsRunner()
        results = diagnostics.run_full_diagnostics()

        # Exibir resumo
        logger.info("\n" + diagnostics.get_summary())

        # Determinar código de saída baseado nos resultados
        total_tests = len(results)
        passed_tests = sum(1 for result in results.values() if result.get('success', False))
        success_rate = (passed_tests / total_tests) * 100

        if success_rate >= 80:
            logger.info("✅ Sistema pronto para uso")
            return 0
        elif success_rate >= 60:
            logger.warning("⚠️ Sistema com problemas - uso com cautela")
            return 1
        else:
            logger.error("❌ Sistema com falhas críticas")
            return 2

    except Exception as e:
        logger.error(f"❌ Falha no diagnóstico: {e}")
        return 3

def run_automation(args, logger: logging.Logger) -> int:
    """Executa automação principal"""
    mode_emoji = "🧪" if args.mode == 'test' else "🚀"
    period_emoji = "☀" if args.period == 'morning' else "🌙"

    logger.info(f"{mode_emoji} MODO: {args.mode.upper()}")
    logger.info(f"{period_emoji} PERÍODO: {args.period.upper()}")
    logger.info(f"📊 CONJUNTO: {args.cell_set.upper()}")

    if args.chart:
        logger.info(f"📈 GRÁFICO: {args.chart}")

    logger.info("=" * 50)

    try:
        # Inicializar executor
        from .automation import AutomationExecutor

        executor = AutomationExecutor()

        # Executar automação
        result = executor.execute(
            cell_set=args.cell_set,
            chart_id=args.chart,
            test_mode=(args.mode == 'test'),
            period=args.period,
            force=args.force,
        )

        if result:
            logger.info("✅ Automação concluída com sucesso!")
            return 0
        else:
            logger.error("❌ Automação falhou")
            return 1

    except Exception as e:
        logger.error(f"❌ Erro na automação: {e}")
        return 2

def select_execution_mode(logger: logging.Logger) -> Optional[str]:
    """Seleciona modo de execução (real/teste)"""
    while True:
        logger.info("\n🚀 MODO DE EXECUÇÃO:")
        logger.info("1. 🎯 Real (produção)")
        logger.info("2. 🧪 Teste (simulação)")
        logger.info("0. ⬅️ Voltar")

        choice = input("\n👉 Escolha o modo: ").strip()

        if choice == '0':
            return None
        elif choice == '1':
            return 'run'
        elif choice == '2':
            return 'test'
        else:
            logger.warning("⚠️ Opção inválida. Tente novamente.")

def select_unit(logger: logging.Logger) -> Optional[str]:
    """Seleciona unidade (BSS/NH)"""
    while True:
        logger.info("\n🏢 UNIDADE:")
        logger.info("1. 🛍️ BarraShoppingSul")
        logger.info("2. 🏘️ Novo Hamburgo")
        logger.info("0. ⬅️ Voltar")

        choice = input("\n👉 Escolha a unidade: ").strip()

        if choice == '0':
            return None
        elif choice == '1':
            return 'bss'
        elif choice == '2':
            return 'nh'
        else:
            logger.warning("⚠️ Opção inválida. Tente novamente.")

def select_period(logger: logging.Logger) -> Optional[str]:
    """Seleciona período da mensagem (manhã/noite)"""
    while True:
        logger.info("\n⏰ PERÍODO DA MENSAGEM:")
        logger.info("1. ☀ Manhã")
        logger.info("2. 🌙 Noite")
        logger.info("0. ⬅️ Voltar")

        choice = input("\n👉 Escolha o período: ").strip()

        if choice == '0':
            return None
        elif choice == '1':
            return 'morning'
        elif choice == '2':
            return 'evening'
        else:
            logger.warning("⚠️ Opção inválida. Tente novamente.")

def run_execution_flow(logger: logging.Logger) -> int:
    """Executa fluxo completo de execução com navegação hierárquica"""
    while True:
        # Selecionar modo de execução
        mode = select_execution_mode(logger)
        if mode is None:
            return 0  # Voltar ao menu principal

        while True:
            # Selecionar unidade
            unit = select_unit(logger)
            if unit is None:
                break  # Voltar para seleção de modo

            while True:
                # Selecionar período
                period = select_period(logger)
                if period is None:
                    break  # Voltar para seleção de unidade

                # Executar automação com parâmetros selecionados
                logger.info(f"\n🎯 CONFIGURAÇÃO SELECIONADA:")
                mode_text = "REAL" if mode == 'run' else "TESTE"
                unit_text = "BarraShoppingSul" if unit == 'bss' else "Novo Hamburgo"
                period_text = "Manhã" if period == 'morning' else "Noite"

                logger.info(f"   Modo: {mode_text}")
                logger.info(f"   Unidade: {unit_text}")
                logger.info(f"   Período: {period_text}")

                # Criar args simulados
                class Args:
                    def __init__(self, mode, cell_set, period):
                        self.mode = mode
                        self.cell_set = cell_set
                        self.period = period
                        self.chart = None

                result = run_automation(Args(mode, unit, period), logger)

                return result

def run_interactive_menu(logger: logging.Logger) -> int:
    """Executa menu interativo quando nenhum argumento é fornecido"""
    logger.info("🎯 SALES CHART MESSENGER")
    logger.info("=" * 50)

    # Informações do ambiente
    env_mode = EnvironmentDetector.get_execution_mode()
    logger.info(f"🌍 Ambiente: {env_mode}")

    try:
        config = ConfigManager.get_config()
        logger.info("✅ Configuração carregada")
    except Exception as e:
        logger.error(f"❌ Erro configuração: {e}")
        logger.info("💡 Execute o diagnóstico para mais detalhes")

    while True:
        logger.info("\n📋 MENU PRINCIPAL:")
        logger.info("1. 🚀 Execução")
        logger.info("2. 🔍 Diagnóstico")
        logger.info("3. 🚪 Sair")

        try:
            choice = input("\n👉 Escolha uma opção: ").strip()

            if choice == '3':
                logger.info("👋 Até logo!")
                return 0
            elif choice == '1':
                result = run_execution_flow(logger)
                if result != 0:
                    return result  # Se houve erro, sair do menu
            elif choice == '2':
                result = run_diagnostics(logger)
                input("\n📋 Pressione Enter para voltar ao menu...")
                if result > 1:  # Se erro crítico, sair
                    return result
            else:
                logger.warning("⚠️ Opção inválida. Tente novamente.")

        except KeyboardInterrupt:
            logger.info("\n👋 Interrompido pelo usuário")
            return 0
        except EOFError:
            logger.info("\n👋 Até logo!")
            return 0

def main() -> int:
    """Função principal"""
    # Configurar logging
    logger = setup_logging(log_to_file=True)

    try:
        # Se não há argumentos, mostrar menu interativo
        if len(sys.argv) == 1:
            return run_interactive_menu(logger)

        # Parse de argumentos
        parser = create_cli_parser()
        args = parser.parse_args()

        # Configurar nível de log se verbose
        if args.verbose:
            logging.getLogger().setLevel(logging.DEBUG)
            logger.debug("🔧 Modo verboso ativado")

        # Validar argumentos
        validate_arguments(args)

        # Executar modo apropriado
        if args.mode == 'diagnose':
            return run_diagnostics(logger)
        else:
            return run_automation(args, logger)

    except ValueError as e:
        logger.error(f"❌ Argumento inválido: {e}")
        return 1
    except KeyboardInterrupt:
        logger.info("\n👋 Interrompido pelo usuário")
        return 0
    except Exception as e:
        logger.error(f"❌ Erro inesperado: {e}")
        return 3

if __name__ == "__main__":
    sys.exit(main())
