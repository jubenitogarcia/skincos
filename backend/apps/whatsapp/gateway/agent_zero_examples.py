#!/usr/bin/env python3
"""
Exemplos práticos de como o Agent-Zero deve usar a integração WhatsApp

Este arquivo contém cenários reais de uso que o Agent-Zero pode implementar.
"""

import sys
import os
import psutil
import time
from datetime import datetime, timedelta

# Adicionar o módulo ao path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from agent_zero_whatsapp import whatsapp, notify, alert, report, system_status

def agent_startup_notification():
    """Notifica que o Agent-Zero foi iniciado"""
    print("📱 Enviando notificação de startup...")

    startup_msg = f"""🚀 *Agent-Zero Iniciado*

🕐 Horário: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}
🖥️ Sistema: {os.uname().sysname} {os.uname().release}
🐍 Python: {sys.version.split()[0]}
💾 Memória disponível: {psutil.virtual_memory().available // (1024**3)} GB

✅ Todos os sistemas operacionais
🔄 Aguardando comandos..."""

    return notify(startup_msg)

def monitor_system_resources():
    """Monitora recursos do sistema e alerta se necessário"""
    print("🔍 Monitorando recursos do sistema...")

    # Obter métricas
    cpu_percent = psutil.cpu_percent(interval=1)
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage('/')

    memory_percent = memory.percent
    disk_percent = (disk.used / disk.total) * 100

    # Verificar se algum recurso está alto
    alerts_sent = []

    if cpu_percent > 80:
        alert("Alto Uso de CPU",
              f"CPU está em {cpu_percent:.1f}% - Verificar processos",
              "high")
        alerts_sent.append(f"CPU: {cpu_percent:.1f}%")

    if memory_percent > 80:
        alert("Alta Utilização de Memória",
              f"Memória em {memory_percent:.1f}% ({memory.used//1024**3}GB/{memory.total//1024**3}GB)",
              "high")
        alerts_sent.append(f"Memória: {memory_percent:.1f}%")

    if disk_percent > 85:
        alert("Disco Quase Cheio",
              f"Disco em {disk_percent:.1f}% ({disk.used//1024**3}GB/{disk.total//1024**3}GB)",
              "critical")
        alerts_sent.append(f"Disco: {disk_percent:.1f}%")

    # Enviar relatório de recursos
    resource_report = {
        "CPU": f"{cpu_percent:.1f}%",
        "Memória": f"{memory_percent:.1f}%",
        "Disco": f"{disk_percent:.1f}%",
        "Alertas": len(alerts_sent)
    }

    if alerts_sent:
        print(f"⚠️ Alertas enviados: {', '.join(alerts_sent)}")
    else:
        print("✅ Todos os recursos dentro dos limites")

    return resource_report

def send_daily_report():
    """Envia relatório diário do Agent-Zero"""
    print("📊 Gerando relatório diário...")

    # Simular métricas (substitua por dados reais do Agent-Zero)
    uptime = time.time() - psutil.boot_time()
    uptime_str = str(timedelta(seconds=int(uptime)))

    daily_metrics = {
        "Uptime do Sistema": uptime_str,
        "Tarefas Executadas": "47",  # Substitua por contador real
        "Comandos Processados": "152",  # Substitua por contador real
        "Erros Encontrados": "3",  # Substitua por contador real
        "CPU Média": f"{psutil.cpu_percent()}%",
        "Memória Atual": f"{psutil.virtual_memory().percent:.1f}%",
        "Processos Ativos": len(psutil.pids()),
        "Última Reinicialização": datetime.fromtimestamp(psutil.boot_time()).strftime('%d/%m %H:%M')
    }

    return report("Relatório Diário Agent-Zero", daily_metrics)

def task_completion_notification(task_name, success=True, duration=None, details=None):
    """Notifica conclusão de tarefas importantes"""
    print(f"📋 Notificando conclusão da tarefa: {task_name}")

    emoji = "✅" if success else "❌"
    status = "CONCLUÍDA" if success else "FALHADA"
    priority = "normal" if success else "high"

    task_details = f"Tarefa '{task_name}' foi {status.lower()}"

    if duration:
        task_details += f"\n⏱️ Duração: {duration}"

    if details:
        task_details += f"\n📝 Detalhes: {details}"

    return alert(f"{emoji} Tarefa {status}", task_details, priority)

def error_notification(error_type, error_message, traceback_info=None):
    """Notifica erros críticos do Agent-Zero"""
    print(f"🚨 Notificando erro: {error_type}")

    error_details = f"Tipo: {error_type}\n"
    error_details += f"Mensagem: {error_message}\n"
    error_details += f"Timestamp: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}"

    if traceback_info:
        # Limitar traceback para não ser muito longo
        short_traceback = '\n'.join(traceback_info.split('\n')[-5:])
        error_details += f"\n\nTraceback (últimas 5 linhas):\n{short_traceback}"

    return alert("🚨 Erro Crítico", error_details, "critical")

def network_status_check():
    """Verifica conectividade de rede e serviços"""
    print("🌐 Verificando conectividade de rede...")

    import subprocess

    # Testar conectividade
    services_status = {}

    # Teste básico de conectividade
    try:
        result = subprocess.run(['ping', '-c', '1', 'google.com'],
                              capture_output=True, timeout=5)
        services_status["Internet"] = "✅ Online" if result.returncode == 0 else "❌ Offline"
    except:
        services_status["Internet"] = "❌ Erro no teste"

    # Teste da API WhatsApp
    if whatsapp.is_ready():
        services_status["WhatsApp API"] = "✅ Funcionando"
    else:
        services_status["WhatsApp API"] = "❌ Não disponível"

    # Se houver problemas, enviar alerta
    offline_services = [k for k, v in services_status.items() if "❌" in v]

    if offline_services:
        alert("Problemas de Conectividade",
              f"Serviços offline: {', '.join(offline_services)}",
              "high")

    return services_status

def agent_shutdown_notification(reason="Manual"):
    """Notifica que o Agent-Zero está sendo encerrado"""
    print("📱 Enviando notificação de shutdown...")

    uptime = time.time() - psutil.boot_time()
    uptime_str = str(timedelta(seconds=int(uptime)))

    shutdown_msg = f"""🛑 *Agent-Zero Encerrando*

📝 Motivo: {reason}
🕐 Horário: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}
⏱️ Tempo ativo: {uptime_str}

📊 Sessão finalizada
💾 Dados salvos
🔄 Pronto para reinicialização"""

    return notify(shutdown_msg)

def main():
    """Função principal para testar as integrações"""
    print("🤖 Agent-Zero WhatsApp Integration - Exemplos Práticos")
    print("=" * 60)

    # Verificar se WhatsApp está pronto
    if not whatsapp.is_ready():
        print("❌ WhatsApp não está pronto!")
        print("💡 Inicie o bot_com_api.js primeiro")
        return

    print("✅ WhatsApp está pronto! Executando exemplos...\n")

    # 1. Notificação de startup
    print("1️⃣ Teste: Notificação de startup")
    agent_startup_notification()
    time.sleep(2)

    # 2. Monitoramento de recursos
    print("\n2️⃣ Teste: Monitoramento de recursos")
    resources = monitor_system_resources()
    time.sleep(2)

    # 3. Relatório diário
    print("\n3️⃣ Teste: Relatório diário")
    send_daily_report()
    time.sleep(2)

    # 4. Notificação de tarefa
    print("\n4️⃣ Teste: Notificação de tarefa")
    task_completion_notification("Teste de Integração", True, "2.3s", "Todos os testes passaram")
    time.sleep(2)

    # 5. Verificação de rede
    print("\n5️⃣ Teste: Verificação de rede")
    network_status = network_status_check()
    time.sleep(2)

    # 6. Status do sistema
    print("\n6️⃣ Teste: Status do sistema")
    system_status("online",
                  uptime=str(timedelta(seconds=int(time.time() - psutil.boot_time()))),
                  metrics=resources)

    print("\n✅ Todos os testes concluídos!")
    print("📱 Verifique seu WhatsApp para ver as mensagens enviadas")

if __name__ == "__main__":
    main()
