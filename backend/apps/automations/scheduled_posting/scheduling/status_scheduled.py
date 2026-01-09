#!/usr/bin/env python3
"""
Status Scheduled - Script para verificar status dos posts agendados
"""
import os
import json
from datetime import datetime, timedelta
from pathlib import Path
import logging
import sys
from libs.scheduler_config import ConfigManager, scheduled_dir, scheduled_posting_var_dir
from .scheduled_media_handler import ScheduledMediaHandler

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

class ScheduledPostsStatus:
    def __init__(self):
        self.logger = logging.getLogger(__name__)

        # Carregar configurações
        self.config = self.load_config()

        # Inicializar handler para mídia agendada
        scheduled_config = self.config.get("scheduled_posting", {})
        self.scheduled_folder = scheduled_config.get("base_folder") or str(scheduled_dir())
        self.media_handler = ScheduledMediaHandler(base_path=scheduled_config.get("base_folder"))

        # Verificar se temos registros de posts
        self.posts_log = self.get_post_logs()

        # Cores para terminal
        self.colors = {
            "GREEN": "\033[92m",
            "YELLOW": "\033[93m",
            "RED": "\033[91m",
            "BLUE": "\033[94m",
            "ENDC": "\033[0m",
            "BOLD": "\033[1m"
        }

    def load_config(self):
        """Carrega configurações do sistema"""
        try:
            return ConfigManager().data
        except Exception as e:
            self.logger.error(f"❌ Erro ao carregar configurações: {e}")
            return {}

    def get_post_logs(self):
        """Recupera logs de posts salvos"""
        post_logs = []
        posts_dir = scheduled_posting_var_dir() / "posts"
        post_files = [f for f in posts_dir.glob("post_*.txt")] if posts_dir.exists() else []

        for post_file in post_files:
            try:
                with open(post_file, "r", encoding="utf-8") as f:
                    content = f.read()
                    # Processar conteúdo para extrair informações
                    date_line = next((line for line in content.split("\n") if line.startswith("Data:")), None)
                    files_line = next((line for line in content.split("\n") if line.startswith("Arquivos:")), None)

                    if date_line and files_line:
                        try:
                            # Extrair data
                            date_str = date_line.replace("Data:", "").strip()
                            date_obj = datetime.fromisoformat(date_str)

                            # Extrair arquivos
                            import ast
                            files = ast.literal_eval(files_line.replace("Arquivos:", "").strip())

                            post_logs.append({
                                "date": date_obj,
                                "files": files,
                                "log_file": post_file.name
                            })
                        except (ValueError, SyntaxError) as e:
                            self.logger.warning(f"⚠️ Erro ao processar log {post_file}: {e}")
            except Exception as e:
                self.logger.warning(f"⚠️ Erro ao ler arquivo de log {post_file}: {e}")

        return sorted(post_logs, key=lambda x: x["date"], reverse=True)

    def check_today_status(self):
        """Verifica status da postagem do dia atual"""
        print(f"{self.colors['BOLD']}{'='*80}{self.colors['ENDC']}")
        print(f"{self.colors['BOLD']}🔍 STATUS DE POSTAGENS AGENDADAS{self.colors['ENDC']}")
        print(f"{self.colors['BOLD']}{'='*80}{self.colors['ENDC']}")

        today = datetime.now()
        print(f"\n📅 {self.colors['BOLD']}Data atual: {today.strftime('%d/%m/%Y')}{self.colors['ENDC']}")

        # 1. Verificar arquivos para hoje
        today_files = self.media_handler.get_today_files()
        file_status = f"{self.colors['GREEN']}✅ Encontrado(s){self.colors['ENDC']}" if today_files else f"{self.colors['RED']}❌ Não encontrado{self.colors['ENDC']}"

        print(f"\n{self.colors['BOLD']}1. ARQUIVOS DE MÍDIA{self.colors['ENDC']}")
        print(f"   Status: {file_status}")

        if today_files:
            print(f"   Arquivos: {', '.join([f.name for f in today_files])}")

            # Organizar por tipo
            organized = self.media_handler.organize_media_by_type(today_files)
            if organized['images']:
                print(f"   📸 Imagens: {len(organized['images'])}")
            if organized['videos']:
                print(f"   🎬 Vídeos: {len(organized['videos'])}")

        # 2. Verificar se post já foi processado hoje
        today_start = datetime(today.year, today.month, today.day, 0, 0, 0)
        today_posts = [log for log in self.posts_log if log["date"] >= today_start]

        post_status = f"{self.colors['GREEN']}✅ Realizado{self.colors['ENDC']}" if today_posts else f"{self.colors['YELLOW']}⚠️ Pendente{self.colors['ENDC']}"

        print(f"\n{self.colors['BOLD']}2. PROCESSAMENTO{self.colors['ENDC']}")
        print(f"   Status: {post_status}")

        if today_posts:
            for post in today_posts:
                print(f"   📄 Arquivo de log: {post['log_file']}")
                print(f"   🕒 Horário: {post['date'].strftime('%H:%M:%S')}")
                print(f"   📎 Arquivos processados: {', '.join(post['files'])}")

        # 3. Verificar configurações do sistema
        print(f"\n{self.colors['BOLD']}3. CONFIGURAÇÕES DO SISTEMA{self.colors['ENDC']}")

        scheduled_config = self.config.get("scheduled_posting", {})
        enabled = scheduled_config.get("enabled", False)
        auto_post = scheduled_config.get("auto_post", False)

        enabled_str = f"{self.colors['GREEN']}✅ Ativado{self.colors['ENDC']}" if enabled else f"{self.colors['RED']}❌ Desativado{self.colors['ENDC']}"
        auto_post_str = f"{self.colors['GREEN']}✅ Ativado{self.colors['ENDC']}" if auto_post else f"{self.colors['YELLOW']}⚠️ Desativado{self.colors['ENDC']}"
        print(f"   Sistema agendamento: {enabled_str}")
        print(f"   Postagem automática: {auto_post_str}")
        print(f"   Pasta base: {scheduled_config.get('base_folder', 'Scheduled')}")
        print(f"   Verificação diária: {scheduled_config.get('daily_check_time', 'Não configurado')}")

        # 4. Verificar histórico recente
        print(f"\n{self.colors['BOLD']}4. HISTÓRICO RECENTE{self.colors['ENDC']}")

        # Últimos 5 dias
        recent_days = 5
        recent_dates = [today - timedelta(days=i) for i in range(1, recent_days + 1)]

        for date in recent_dates:
            date_str = date.strftime('%d/%m/%Y')
            date_posts = [log for log in self.posts_log
                          if log["date"].date() == date.date()]

            if date_posts:
                status = f"{self.colors['GREEN']}✅ Postado{self.colors['ENDC']}"
                details = f"{len(date_posts)} post(s)"
            else:
                status = f"{self.colors['RED']}❌ Sem post{self.colors['ENDC']}"
                details = "Nenhum registro"

            print(f"   {date_str}: {status} ({details})")

        # 5. Próximas ações
        print(f"\n{self.colors['BOLD']}5. PRÓXIMAS AÇÕES{self.colors['ENDC']}")

        if not today_files:
            print(f"   {self.colors['YELLOW']}⚠️ PENDENTE:{self.colors['ENDC']} Adicionar mídia em {self.scheduled_folder}/{today.strftime('%Y/%m')}")
            print(f"   ↳ O nome do arquivo deve conter '{today.strftime('%d')}'")
        elif not today_posts:
            print(f"   {self.colors['YELLOW']}⚠️ PENDENTE:{self.colors['ENDC']} Executar processamento:")
            print("   ↳ python -m apps.automations.scheduled_posting.ops.automated_poster")
        else:
            print(f"   {self.colors['GREEN']}✅ CONCLUÍDO:{self.colors['ENDC']} Todas as tarefas para hoje foram realizadas!")
            tomorrow = today + timedelta(days=1)
            print(f"   ↳ Próxima verificação: {tomorrow.strftime('%d/%m/%Y')}")

        print(f"\n{self.colors['BOLD']}{'='*80}{self.colors['ENDC']}")

if __name__ == "__main__":
    status = ScheduledPostsStatus()
    status.check_today_status()
