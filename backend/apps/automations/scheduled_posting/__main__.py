#!/usr/bin/env python3
"""
Scheduled Posting Automation - Main Interface

Unified entry point with three modes:
1) run: Execute real posting automation
2) test: Simulation mode (no real posting)
3) diagnose: Diagnostic checks
"""

import sys
import argparse
from libs.scheduler_config import ConfigManager
from .diagnostics.runner import DiagnosticsRunner

def main():
    parser = argparse.ArgumentParser(description="Scheduled Posting Automation")
    parser.add_argument('--mode', choices=['run', 'test', 'diagnose'], default='diagnose',
                        help='Operation mode: run (real posting), test (simulate), diagnose (system test)')
    args = parser.parse_args()

    # Carrega configurações centralizadas
    config = ConfigManager()

    # Diagnóstico centralizado
    diagnostics = DiagnosticsRunner(config)
    results = diagnostics.run_all()

    if args.mode == 'diagnose':
        print("\n=== DIAGNÓSTICO DO SISTEMA ===")
        for service, res in results.items():
            if service != 'all_ok':
                print(f"{service.capitalize()}: {'OK' if res['ok'] else 'FALHA'} - {res['msg']}")
        print(f"\nStatus geral: {'OK' if results['all_ok'] else 'FALHA'}")
        return 0 if results['all_ok'] else 1

    if args.mode in ['run', 'test']:
        from .automation.manager import AutomationManager
        if not results['all_ok']:
            print("\n⚠️ Atenção: Nem todos os serviços estão OK. Corrija antes de executar a automação real.")
            if args.mode == 'run':
                return 1
        automation = AutomationManager(config, real_mode=(args.mode == 'run'))
        return automation.start()

    print("Modo desconhecido.")
    return 1

if __name__ == "__main__":
    sys.exit(main())
