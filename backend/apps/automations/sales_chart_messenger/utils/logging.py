"""
Configuração de sistema de logging.
"""

import logging
import sys
import os
from datetime import datetime
from pathlib import Path

def setup_logging(log_level=logging.INFO, log_to_file=True) -> logging.Logger:
    """
    Configura logging simplificado apenas com emoji + mensagem
    """
    logger = logging.getLogger("sales_automation")
    logger.setLevel(log_level)

    # Limpar handlers existentes para evitar duplicação
    for handler in logger.handlers[:]:
        logger.removeHandler(handler)

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)

    # Formatter simples - apenas mensagem com emoji
    console_formatter = logging.Formatter('%(message)s')
    console_handler.setFormatter(console_formatter)
    logger.addHandler(console_handler)

    # File handler se solicitado
    if log_to_file:
        try:
            # Criar diretório de logs se não existir
            backend_dir = Path(__file__).resolve().parents[4]
            var_dir = Path(os.environ.get("VAR_DIR", str(backend_dir / "var")))
            logs_dir = var_dir / "logs" / "whatsapp" / "sales_chart_messenger"
            logs_dir.mkdir(parents=True, exist_ok=True)

            # Nome do arquivo com timestamp
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            log_file = str(logs_dir / f"sales_chart_messenger_{timestamp}.log")

            file_handler = logging.FileHandler(log_file, encoding='utf-8')
            file_handler.setLevel(logging.DEBUG)  # Log completo no arquivo

            # Formatter completo para arquivo
            file_formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            file_handler.setFormatter(file_formatter)
            logger.addHandler(file_handler)

            logger.debug(f"Log file: {log_file}")

        except Exception as e:
            logger.warning(f"⚠️ Não foi possível criar log file: {e}")

    # Configurar global exception handler
    def handle_exception(exc_type, exc_value, exc_traceback):
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc_value, exc_traceback)
            return

        logger.error("❌ Exceção não capturada", exc_info=(exc_type, exc_value, exc_traceback))

    sys.excepthook = handle_exception

    logger.info("🔧 Sistema de logging inicializado")
    return logger

def get_logger(name: str = "sales_automation") -> logging.Logger:
    """Retorna logger configurado"""
    return logging.getLogger(name)

def log_execution_time(func):
    """Decorator para logar tempo de execução de funções"""
    import time
    import functools
    
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        logger = get_logger()
        start_time = time.time()
        
        try:
            result = func(*args, **kwargs)
            execution_time = time.time() - start_time
            logger.debug(f"⏱️ {func.__name__}: {execution_time:.2f}s")
            return result
        except Exception as e:
            execution_time = time.time() - start_time
            logger.error(f"❌ {func.__name__} falhou em {execution_time:.2f}s: {e}")
            raise
    
    return wrapper
