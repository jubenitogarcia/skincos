#!/usr/bin/env python3
"""
Daily Monitor - Script para monitorar e executar postagens agendadas diariamente
"""
import os
import json
import time
import logging
import sys
from datetime import datetime
import subprocess
from pathlib import Path
from libs.scheduler_config import ConfigManager, scheduled_dir, scheduled_posting_var_dir
from ..scheduling.scheduled_media_handler import ScheduledMediaHandler
from .automated_poster import AutomatedPoster

# Configuração de logging
logs_dir = scheduled_posting_var_dir() / "logs"
logs_dir.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(str(logs_dir / "daily_monitor.log")),
        logging.StreamHandler()
    ]
)

class DailyMonitor:
    def __init__(self):
        self.logger = logging.getLogger(__name__)

        self.logger.info("🔄 Iniciando Monitor Diário")

        # Carregar configurações
        self.config = self.load_config()

        # Inicializar handler para mídia agendada
        scheduled_config = self.config.get("scheduled_posting", {})
        self.scheduled_folder = scheduled_config.get("base_folder") or str(scheduled_dir())
        self.auto_post = scheduled_config.get("auto_post", False)
        self.enabled = scheduled_config.get("enabled", True)
        self.check_time = scheduled_config.get("daily_check_time", "08:30")

        # Inicializar objetos
        self.media_handler = ScheduledMediaHandler(base_path=scheduled_config.get("base_folder"))
        self.poster = AutomatedPoster()

    def load_config(self):
        """Carrega configurações do sistema"""
        try:
            return ConfigManager().data
        except Exception as e:
            self.logger.error(f"❌ Erro ao carregar configurações: {e}")
            return {}

    def check_today_files(self):
        """Verifica se existem arquivos para o dia atual"""
        self.logger.info("📂 Verificando arquivos do dia")
        today_files = self.media_handler.get_today_files()

        if today_files:
            self.logger.info(f"✅ Encontrado(s) {len(today_files)} arquivo(s) para hoje")
            return today_files
        else:
            self.logger.warning("⚠️ Nenhum arquivo encontrado para hoje")
            return []

    def should_run_now(self):
        """Verifica se deve executar agora com base na hora configurada"""
        if not self.check_time:
            return True

        now = datetime.now()
        try:
            hour, minute = map(int, self.check_time.split(':'))
            check_datetime = datetime(now.year, now.month, now.day, hour, minute, 0)

            # Se a hora atual é posterior à hora configurada e dentro de uma janela de 15 minutos
            time_diff = abs((now - check_datetime).total_seconds())
            return time_diff <= 15 * 60  # 15 minutos em segundos
        except ValueError:
            self.logger.error(f"❌ Formato de hora inválido: {self.check_time}")
            return True

    def is_post_already_created(self):
        """Verifica se já existe um post criado para hoje"""
        today = datetime.now().strftime('%Y%m%d')
        post_files = list(Path(".").glob(f"post_{today}_*.txt"))
        return len(post_files) > 0

    def run_daily_check(self):
        """Executa a verificação diária e o processamento se necessário"""
        self.logger.info("🔍 Iniciando verificação diária")

        # Verificar se o sistema está habilitado
        if not self.enabled:
            self.logger.info("⚠️ Sistema de posts agendados está desativado")
            return False

        # Verificar se deve executar agora
        if not self.should_run_now():
            self.logger.info(f"⏰ Fora do horário programado ({self.check_time})")
            return False

        # Verificar se já existe post para hoje
        if self.is_post_already_created():
            self.logger.info("✅ Post para hoje já foi criado anteriormente")
            return False

        # Verificar arquivos para hoje
        today_files = self.check_today_files()
        if not today_files:
            return False

        # Se chegou até aqui, deve criar o post
        self.logger.info("🚀 Processando post agendado")

        try:
            result = self.poster.run_daily_post()

            if result:
                self.logger.info("✅ Post agendado processado com sucesso!")

                # Se auto_post estiver habilitado, poderia chamar a API do Instagram aqui
                if self.auto_post:
                    self.logger.info("🌐 Iniciando postagem automática no Instagram")
                    # Integração com a API do Instagram iria aqui
                    self.logger.info("⚠️ Postagem automática ainda não implementada")

                return True
            else:
                self.logger.error("❌ Falha ao processar post agendado")
                return False

        except Exception as e:
            self.logger.error(f"❌ Erro durante o processamento: {e}")
            return False

    def run_with_notification(self):
        """Executa a verificação diária com notificações ao final"""
        start_time = time.time()
        result = self.run_daily_check()

        # Enviar notificações se configurado
        notification_config = self.config.get("scheduled_posting", {}).get("notification", {})

        if notification_config.get("enabled", False):
            if result:
                message = notification_config.get("success_message", "✅ Post preparado para o Instagram!")
                # Aqui poderia enviar notificação por SMS, e-mail, etc.
                self.logger.info(message)
            else:
                message = notification_config.get("error_message", "❌ Erro ao processar post agendado")
                self.logger.warning(message)

        elapsed_time = time.time() - start_time
        self.logger.info(f"⏱️ Verificação concluída em {elapsed_time:.2f} segundos")

        # Exibir status completo
        try:
            subprocess.run([sys.executable, "-m", "apps.automations.scheduled_posting.scheduling.status_scheduled"], check=False)
        except Exception as e:
            self.logger.error(f"❌ Erro ao executar status: {e}")

        return result

if __name__ == "__main__":
    monitor = DailyMonitor()
    monitor.run_with_notification()
