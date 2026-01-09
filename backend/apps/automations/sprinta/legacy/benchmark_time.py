"""
Script de benchmark para medir o tempo de execução da automação.
"""

import time
from sprinta_automation import process_csv

def benchmark_automation(debug_mode: bool, description: str):
    """Executa a automação e mede o tempo."""
    print("\n" + "="*70)
    print(f"⏱️  BENCHMARK: {description}")
    print("="*70)

    start_time = time.time()

    try:
        process_csv(
            "participants.csv",
            f"checkout_urls_benchmark_{int(start_time)}.csv",
            debug_mode=debug_mode,
            use_persistent_session=True
        )
    except Exception as e:
        print(f"❌ Erro: {e}")

    end_time = time.time()
    elapsed = end_time - start_time

    print("\n" + "="*70)
    print(f"⏱️  TEMPO TOTAL: {elapsed:.2f} segundos ({elapsed/60:.2f} minutos)")
    print("="*70 + "\n")

    return elapsed


if __name__ == "__main__":
    print("\n" + "🏁"*35)
    print("INICIANDO BENCHMARK DA AUTOMAÇÃO SPRINTA")
    print("🏁"*35 + "\n")

    # Teste 1: Modo debug
    time_debug = benchmark_automation(
        debug_mode=True,
        description="Modo DEBUG (com pausas)"
    )

    print("\n⏸️  Aguardando 5 segundos antes do próximo teste...\n")
    time.sleep(5)

    # Teste 2: Modo rápido
    time_fast = benchmark_automation(
        debug_mode=False,
        description="Modo RÁPIDO (sem pausas)"
    )

    # Resultado final
    print("\n" + "📊"*35)
    print("RESULTADO FINAL DO BENCHMARK")
    print("📊"*35 + "\n")

    print(f"⏱️  Modo DEBUG:  {time_debug:.2f}s ({time_debug/60:.2f} min)")
    print(f"⚡ Modo RÁPIDO: {time_fast:.2f}s ({time_fast/60:.2f} min)")
    print(f"")
    print(f"💰 ECONOMIA: {time_debug - time_fast:.2f}s ({(1 - time_fast/time_debug)*100:.1f}% mais rápido)")
    print("\n" + "="*70 + "\n")
