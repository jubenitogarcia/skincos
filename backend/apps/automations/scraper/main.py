#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Automação Espaço Facial - VERSÃO REFATORADA
Sistema completo de coleta de dados via navegador e atualização do Google Sheets

Funcionalidades:
- Login automatizado no sistema Espaço Facial
- Coleta de dados de vendas por unidade (BSS, NH, RJ)
- Atualização automática do Google Sheets
- Interface interativa com menu guiado
- Sistema de debug e diagnóstico
- Validação de seletores e configurações
- Análise de páginas web para troubleshooting
- Suporte a múltiplos modos de execução
- Sistema de logging robusto

Versão: 3.0 - Refatorada e Consolidada
Data: 09/06/2025
"""

import argparse
import json
import logging
import os
import re
import socket
import sys
import time
import urllib.request
from datetime import datetime
from logging.handlers import RotatingFileHandler
from typing import Any, Dict, List, Optional

from google.oauth2 import service_account  # type: ignore
from googleapiclient.discovery import build  # type: ignore
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.wait import WebDriverWait
from selenium.webdriver.support.select import Select
from selenium.common.exceptions import TimeoutException, ElementClickInterceptedException

# ===== CONFIGURAÇÕES GLOBAIS =====

# Arquivo de configurações (preferir local e permitir override por env)
DEFAULT_SETTINGS_FILES = ('config.local.json', 'config.json')
LOG_FILE = 'run.log'

# Configurações globais - serão carregadas dinamicamente
settings: Dict[str, Any] = {}
spreadsheet_id: str = ""
sheet_name: str = ""
scopes: List[str] = []
data_mapping: Dict[str, str] = {}

# Configurações do Sistema Espaço Facial
ESPACO_FACIAL_CONFIG: Dict[str, Any] = {
    "login_url": "",
    "username": "",
    "password": "",
    "timeout": 30,
    "wait_time": 10
}

# Logger global
logger = logging.getLogger(__name__)

# ===== CONFIGURAÇÃO DE LOGGING =====

def setup_logging(debug: bool = False, silent: bool = False) -> None:
    """Configura sistema de logging com RotatingFileHandler."""
    global logger

    # Limpa handlers existentes
    for handler in logger.handlers[:]:
        logger.removeHandler(handler)  # type: ignore

    # Define nível baseado nos parâmetros
    if silent:
        log_level = logging.WARNING
    elif debug:
        log_level = logging.DEBUG
    else:
        log_level = logging.INFO

    logger.setLevel(log_level)

    # Formato das mensagens
    formatter = logging.Formatter(
        "%(message)s"
    )

    # Handler para arquivo com rotação
    try:
        file_handler = RotatingFileHandler(
            LOG_FILE,
            maxBytes=5*1024*1024,  # 5MB
            backupCount=3,
            encoding='utf-8'
        )
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    except Exception as e:
        print(f"⚠️ Erro ao configurar log em arquivo: {e}")

    # Handler para console (apenas se não for silent)
    if not silent:
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(log_level)
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)

    logger.info(f"📝 Logging configurado: {logging.getLevelName(log_level)}")
    if not silent:
        logger.info(f"📁 Log: {os.path.abspath(LOG_FILE)}")

# ===== FUNÇÕES DE CONFIGURAÇÃO =====

def _resolve_settings_path() -> Optional[str]:
    override = os.environ.get("SCRAPER_CONFIG")
    if override and os.path.exists(override):
        return override

    for candidate in DEFAULT_SETTINGS_FILES:
        if os.path.exists(candidate):
            return candidate
    return None


def load_unified_settings() -> Dict[str, Any]:
    """Carrega configurações do arquivo de settings (preferindo config.local.json)."""
    settings_path = _resolve_settings_path()
    if not settings_path:
        return {}

    try:
        with open(settings_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Erro ao carregar {settings_path}: {e}")
        return {}

def initialize_global_settings() -> None:
    """Inicializa as configurações globais a partir do config.json."""
    global settings, spreadsheet_id, sheet_name, scopes, data_mapping, ESPACO_FACIAL_CONFIG

    settings = load_unified_settings()

    if settings:
        # Configurações do Google Sheets
        app_config = settings.get('app_config', {})
        spreadsheet_id = app_config.get('spreadsheet_id', '')
        sheet_name = app_config.get('sheet_name', '')
        scopes = app_config.get('scopes', [])
        data_mapping = app_config.get('data_mapping', {})

        # Configurações do Espaço Facial
        espaco_config = settings.get('espaco_facial', {})
        ESPACO_FACIAL_CONFIG.update({
            'login_url': espaco_config.get('login_url', ''),
            'username': espaco_config.get('username', ''),
            'password': espaco_config.get('password', ''),  # Senha em texto simples
            'timeout': espaco_config.get('timeout', 30),
            'wait_time': espaco_config.get('wait_time', 10)
        })

def load_config() -> Dict[str, Any]:
    """Carrega configurações do Espaço Facial (para compatibilidade)."""
    initialize_global_settings()
    return ESPACO_FACIAL_CONFIG.copy()

def save_config(config: Dict[str, Any]) -> None:
    """Salva configurações no arquivo unificado."""
    current_settings = load_unified_settings()

    # Atualiza apenas a seção espaco_facial
    if 'espaco_facial' not in current_settings:
        current_settings['espaco_facial'] = {}

    # Salva a senha diretamente sem codificação
    current_settings['espaco_facial'].update(config)  # type: ignore

    # Salva o arquivo
    try:
        settings_path = _resolve_settings_path() or DEFAULT_SETTINGS_FILES[0]
        with open(settings_path, 'w', encoding='utf-8') as f:
            json.dump(current_settings, f, indent=2, ensure_ascii=False)
        logger.info("✅ Configurações salvas com sucesso")
    except Exception as e:
        logger.error(f"❌ Erro ao salvar configurações: {e}")

def validate_config(config: Dict[str, Any]) -> List[str]:
    """Valida a configuração e retorna lista de problemas."""
    problems: List[str] = []

    # Verifica configurações do Espaço Facial
    ef_config = config.get("espaco_facial", {})

    if not ef_config.get("login_url"):
        problems.append("URL do sistema não configurada")
    elif not ef_config["login_url"].startswith("http"):
        problems.append("URL deve começar com http:// ou https://")

    if not ef_config.get("username"):
        problems.append("Usuário não configurado")

    return problems

# ===== ARGPARSE PARA MÚLTIPLOS MODOS =====

def parse_arguments() -> argparse.Namespace:
    """Configura argumentos da linha de comando."""
    parser = argparse.ArgumentParser(
        description="Automação Espaço Facial - Sistema de coleta de dados",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos de uso:
  python main.py                    # Modo interativo
  python main.py --mode run         # Execução direta
  python main.py --mode diagnose    # Diagnóstico do sistema
  python main.py --configure        # Configurar credenciais
  python main.py --silent           # Execução silenciosa
  python main.py --debug            # Modo debug detalhado
        """
    )

    parser.add_argument(
        '--mode',
        choices=['run', 'diagnose'],
        help='Modo de execução: run (coleta dados) ou diagnose (testa sistema)'
    )

    parser.add_argument(
        '--unit',
        choices=['bss', 'nh', 'rj'],
        help='Unidade específica: bss (Barra Shopping Sul), nh (Novo Hamburgo), rj (Rio de Janeiro)'
    )

    parser.add_argument(
        '--configure',
        action='store_true',
        help='Configurar credenciais e configurações do sistema'
    )

    parser.add_argument(
        '--headless',
        action='store_true',
        help='Executa navegador em modo invisível (sem interface gráfica)'
    )

    parser.add_argument(
        '--silent',
        action='store_true',
        help='Execução silenciosa (apenas erros no console)'
    )

    parser.add_argument(
        '--debug',
        action='store_true',
        help='Modo debug com logs detalhados'
    )

    return parser.parse_args()

# ===== FUNÇÕES DO NAVEGADOR =====

def get_chrome_driver(headless: bool = False) -> webdriver.Chrome:
    """Configura e retorna o driver do Chrome com configurações anti-detecção."""
    # Suprime avisos de MallocStackLogging no macOS
    if sys.platform == "darwin":
        os.environ['MallocStackLogging'] = '0'
        os.environ['NSUnbufferedIO'] = 'YES'
        # Remove variáveis que podem causar os avisos
        for key in ['DYLD_INSERT_LIBRARIES', 'MallocStackLoggingNoCompact']:
            if key in os.environ:
                del os.environ[key]

    chrome_options: Options = Options()  # type: ignore

    # === CONFIGURAÇÃO DO BINÁRIO DO CHROME NO MACOS ===
    if sys.platform == "darwin":
        chrome_binary_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        if os.path.exists(chrome_binary_path):
            chrome_options.binary_location = chrome_binary_path
            logger.info(f"🔧 Chrome: {chrome_binary_path}")

    if headless:
        chrome_options.add_argument("--headless")  # type: ignore

    # === CONFIGURAÇÕES ANTI-DETECÇÃO (Para parecer navegação humana) ===
    chrome_options.add_argument("--no-sandbox")  # type: ignore
    chrome_options.add_argument("--disable-dev-shm-usage")  # type: ignore
    chrome_options.add_argument("--disable-blink-features=AutomationControlled")  # type: ignore
    chrome_options.add_argument("--disable-features=VizDisplayCompositor")  # type: ignore

    # === CONFIGURAÇÕES ESPECÍFICAS PARA MACOS ===
    if sys.platform == "darwin":
        chrome_options.add_argument("--disable-background-timer-throttling")  # type: ignore
        chrome_options.add_argument("--disable-backgrounding-occluded-windows")  # type: ignore
        chrome_options.add_argument("--disable-renderer-backgrounding")  # type: ignore
        chrome_options.add_argument("--disable-features=TranslateUI")  # type: ignore
        chrome_options.add_argument("--disable-ipc-flooding-protection")  # type: ignore
        chrome_options.add_argument("--disable-gpu")  # type: ignore
        chrome_options.add_argument("--disable-logging")  # type: ignore
        chrome_options.add_argument("--log-level=3")  # type: ignore
        chrome_options.add_argument("--silent")  # type: ignore
        chrome_options.add_argument("--disable-web-security")  # type: ignore
        chrome_options.add_argument("--allow-running-insecure-content")  # type: ignore
        chrome_options.add_argument("--disable-features=VizDisplayCompositor")  # type: ignore
        chrome_options.add_argument("--remote-debugging-port=0")  # Permite debugging  # type: ignore

    # Remove indicadores de automação
    chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])  # type: ignore
    chrome_options.add_experimental_option('useAutomationExtension', False)  # type: ignore

    # === CONFIGURAÇÕES DE REDE E PERFORMANCE ===
    # Configurações de conexão direta (sem proxy)
    chrome_options.add_argument("--no-proxy-server")  # type: ignore
    chrome_options.add_argument("--proxy-server='direct://'")  # type: ignore
    chrome_options.add_argument("--proxy-bypass-list=*")  # type: ignore

    # === CONFIGURAÇÕES DE COMPATIBILIDADE ===
    chrome_options.add_argument("--disable-extensions")  # type: ignore
    chrome_options.add_argument("--disable-plugins")  # type: ignore

    # === CONFIGURAÇÕES DE JANELA ===
    chrome_options.add_argument("--window-size=1366,768")  # Tamanho mais comum  # type: ignore
    if not headless:
        chrome_options.add_argument("--start-maximized")  # type: ignore

    # === ESTRATÉGIA DE CARREGAMENTO NORMAL ===
    chrome_options.add_argument("--page-load-strategy=normal")  # type: ignore
    chrome_options.add_argument("--disable-hang-monitor")  # type: ignore
    chrome_options.add_argument("--disable-prompt-on-repost")  # type: ignore

    # === PREFERÊNCIAS PARA PARECER NAVEGAÇÃO HUMANA ===
    prefs: Dict[str, Any] = {
        "profile.default_content_setting_values": {
            "geolocation": 1,  # Permite geolocalização (mais humano)
            "notifications": 1,  # Permite notificações (mais humano)
            "popups": 2,  # Bloqueia apenas popups
            "media_stream": 1,  # Permite media stream
        },
        "profile.managed_default_content_settings": {
            "images": 1  # Carrega imagens (mais humano, mesmo que seja mais lento)
        },
        "profile.content_settings.exceptions.automatic_downloads": {
            "*,*": {"setting": 1}
        }
    }
    chrome_options.add_experimental_option("prefs", prefs)  # type: ignore

    # === USER AGENT ATUALIZADO E REALISTA ===
    user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    chrome_options.add_argument(f"--user-agent={user_agent}")  # type: ignore

    try:
        # OTIMIZAÇÃO 1: Pula ChromeDriverManager e vai direto para Chrome do sistema
        # Isso economiza ~30 segundos
        logger.info("🚀 Iniciando Chrome do sistema...")

        # Tenta paths conhecidos diretamente
        possible_drivers = [
            "/opt/homebrew/bin/chromedriver",  # Homebrew ARM64
            "/usr/local/bin/chromedriver",     # Homebrew Intel
            "/usr/bin/chromedriver",           # Sistema
            "./chromedriver"                   # Local
        ]

        driver = None
        driver_found = False
        for driver_path in possible_drivers:
            if os.path.exists(driver_path) and os.access(driver_path, os.X_OK):
                try:
                    logger.info(f"🔍 Usando: {driver_path}")
                    service = Service(driver_path)
                    driver = webdriver.Chrome(service=service, options=chrome_options)
                    driver_found = True
                    break
                except Exception as e:
                    logger.debug(f"❌ {driver_path}: {e}")
                    continue

        if not driver_found:
            # Fallback para Chrome do sistema no PATH
            logger.info("🔍 Usando Chrome no PATH...")
            service = Service()
            driver = webdriver.Chrome(service=service, options=chrome_options)

        if driver is None:
            raise RuntimeError("Não foi possível inicializar o ChromeDriver.")

        # === CONFIGURAÇÕES DE TIMEOUT OTIMIZADAS ===
        driver.set_page_load_timeout(30)  # Reduzido de 45
        driver.implicitly_wait(3)  # Reduzido de 10

        # === CONFIGURAÇÕES DE JANELA ===
        if not headless:
            # Especificando tipos explicitamente para evitar avisos do Pylance
            width: int = 1366
            height: int = 768
            x_pos: int = 100
            y_pos: int = 50

            driver.set_window_size(width, height)  # type: ignore[arg-type]
            driver.set_window_position(x_pos, y_pos)  # type: ignore[arg-type]

        logger.info("✅ Chrome iniciado!")

    except Exception as e:
        logger.error(f"❌ Erro ao iniciar Chrome: {e}")
        raise

    # === SCRIPT ANTI-DETECÇÃO (Remove sinais de automação) ===
    try:
        # Remove propriedades que indicam automação
        stealth_script = """
        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
        Object.defineProperty(navigator, 'languages', {get: () => ['pt-BR', 'pt', 'en']});
        window.chrome = {runtime: {}};
        Object.defineProperty(navigator, 'permissions', {get: () => ({query: () => Promise.resolve({state: 'granted'})})});
        """
        driver.execute_script(stealth_script)  # type: ignore

        # Define User Agent via CDP (mais efetivo)
        driver.execute_cdp_cmd('Network.setUserAgentOverride', {  # type: ignore
            "userAgent": user_agent,
            "acceptLanguage": "pt-BR,pt;q=0.9,en;q=0.8",
            "platform": "MacIntel"
        })

        logger.info("✅ Anti-detecção aplicada")

    except Exception as e:
        logger.warning(f"⚠️ Anti-detecção: {e}")

    return driver

def find_element_by_multiple_selectors(driver: webdriver.Chrome, selectors: List[str], element_name: str, timeout: int = 10) -> WebElement:
    """Tenta localizar elemento usando múltiplas estratégias com timeout otimizado."""
    # OTIMIZAÇÃO 2: Timeouts reduzidos e estratégia mais eficiente
    total_timeout = timeout
    single_selector_timeout = min(2, total_timeout // len(selectors)) if selectors else 1

    for i, selector in enumerate(selectors):
        try:
            logger.debug(f"🔎 Tentando seletor {i+1}/{len(selectors)} para {element_name}: {selector[:50]}...")

            # Usa timeout reduzido para cada seletor individual
            wait = WebDriverWait(driver, single_selector_timeout)

            if selector.startswith("//"):
                element = wait.until(
                    EC.presence_of_element_located((By.XPATH, selector))
                )
            elif selector.startswith("#"):
                element = wait.until(
                    EC.presence_of_element_located((By.ID, selector[1:]))
                )
            elif selector.startswith("."):
                element = wait.until(
                    EC.presence_of_element_located((By.CLASS_NAME, selector[1:]))
                )
            elif ":contains(" in selector:
                # Converte seletor CSS :contains() para XPath
                tag, contains_part = selector.split(":contains(", 1)
                text_content = contains_part.rstrip(")").strip("'\"")
                xpath = f"//{tag}[contains(text(), '{text_content}')]"
                element = wait.until(
                    EC.presence_of_element_located((By.XPATH, xpath))
                )
            else:
                element = wait.until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, selector))
                )

            logger.info(f"✅ {element_name} encontrado com: {selector[:50]}...")
            return element

        except TimeoutException:
            logger.debug(f"    ⏳ Timeout para seletor {i+1}")
            continue
        except Exception as e:
            logger.debug(f"    ❌ Erro: {type(e).__name__}")
            continue

    # OTIMIZAÇÃO 3: Busca genérica simplificada e mais rápida
    logger.warning(f"⚠️ {element_name} não encontrado - tentando estratégias genéricas...")

    try:
        # Estratégias genéricas super rápidas (timeout de 1s cada)
        quick_wait = WebDriverWait(driver, 1)

        if "usuário" in element_name.lower() or "username" in element_name.lower() or "email" in element_name.lower():
            # Primeira tentativa: campo de email/usuário mais comum
            try:
                element = quick_wait.until(EC.presence_of_element_located((By.XPATH, "//input[@type='email' or @type='text'][1]")))
                if element.is_displayed() and element.is_enabled():
                    logger.info(f"✅ {element_name} encontrado (genérico)")
                    return element
            except:
                pass

        elif "senha" in element_name.lower() or "password" in element_name.lower():
            # Campo de senha - muito específico
            try:
                element = quick_wait.until(EC.presence_of_element_located((By.XPATH, "//input[@type='password'][1]")))
                if element.is_displayed() and element.is_enabled():
                    logger.info(f"✅ {element_name} encontrado (genérico)")
                    return element
            except:
                pass

        elif "botão" in element_name.lower() or "button" in element_name.lower() or "login" in element_name.lower():
            # Botão de submit/login mais comum
            try:
                element = quick_wait.until(EC.presence_of_element_located((By.XPATH, "//button[@type='submit'] | //input[@type='submit'] | //button[contains(@class, 'bubble-element')]")))
                if element.is_displayed() and element.is_enabled():
                    logger.info(f"✅ {element_name} encontrado (genérico)")
                    return element
            except:
                pass

    except Exception:
        pass

    raise Exception(f"❌ {element_name} não encontrado após {len(selectors)} seletores")

def wait_for_page_load(driver: webdriver.Chrome, timeout: int = 15) -> None:
    """Aguarda o carregamento da página de forma otimizada."""
    try:
        logger.info(f"⏳ Carregando...")

        # OTIMIZAÇÃO 7: Carregamento mais rápido
        # Aguarda apenas o essencial - document ready
        WebDriverWait(driver, min(timeout, 10)).until(
            lambda d: d.execute_script("return document.readyState") == "complete"  # type: ignore
        )

        # Delay mínimo para JavaScript básico carregar
        time.sleep(1)  # Reduzido de 2

        logger.info("✅ Página carregada")

    except TimeoutException:
        logger.warning("⚠️ Timeout - continuando")
        try:
            driver.execute_script("window.stop();")  # type: ignore
        except:
            pass
    except Exception as e:
        logger.warning(f"⚠️ Carregamento: {e}")

def take_screenshot(driver: webdriver.Chrome, filename: str = "") -> str:
    """Captura screenshot para debug."""
    try:
        if not filename:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"debug_screenshot_{timestamp}.png"

        screenshot_path = os.path.join(os.getcwd(), filename)
        # Especificando tipo explicitamente
        screenshot_filename: str = screenshot_path
        driver.save_screenshot(screenshot_filename)  # type: ignore[arg-type]
        logger.info(f"📸 Screenshot: {screenshot_path}")
        return screenshot_path
    except Exception as e:
        logger.error(f"❌ Screenshot: {e}")
        return ""

def log_page_info(driver: webdriver.Chrome) -> None:
    """Registra informações da página atual para debug."""
    try:
        current_url = driver.current_url
        page_title = driver.title

        logger.info(f"🌐 URL: {current_url}")
        logger.info(f"📄 Título: {page_title}")

        # Lista elementos principais da página
        main_elements = driver.find_elements(By.XPATH, "//h1 | //h2 | //h3 | //button | //a[contains(@href, '#') or contains(@href, '/')]")

        if main_elements:
            logger.info("🔍 Elementos principais:")
            for i, elem in enumerate(main_elements[:10]):
                try:
                    tag = elem.tag_name
                    text = elem.text.strip()[:50]
                    if text:
                        logger.info(f"   {i+1}. {tag}: '{text}'")
                except:
                    continue
    except Exception as e:
        logger.error(f"❌ Info da página: {e}")

def extract_number_from_text(text: str) -> str:
    """Extrai números de um texto, priorizando valores monetários em formato brasileiro."""
    if not text:
        return "0,00"

    # Primeiro tenta encontrar valores com R$
    import re

    # Procura por padrões monetários brasileiros
    money_patterns = [
        r'R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)',  # R$ 1.234,56
        r'(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*reais?',  # 1.234,56 reais
        r'(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)',  # 1.234,56
    ]

    for pattern in money_patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        if matches:
            # Pega o primeiro valor encontrado
            value = matches[0]
            # Valida e formata para o padrão brasileiro
            try:
                # Se já está no formato brasileiro, valida se é número válido
                test_value = value.replace('.', '').replace(',', '.')
                float(test_value)
                return format_value_for_sheets(value)
            except ValueError:
                continue

    # Se não encontrou padrão monetário, procura por números simples
    # Mas apenas números que fazem sentido como valor de vendas (evita datas, etc.)
    simple_numbers = re.findall(r'\b(\d{1,8}(?:[.,]\d{1,2})?)\b', text)

    for number in simple_numbers:
        # Converte para float para validar
        try:
            normalized = number.replace(',', '.')
            value = float(normalized)
            # Aceita valores entre 0.01 e 999999.99 (valores de vendas razoáveis)
            if 0.01 <= value <= 999999.99:
                return format_value_for_sheets(number)
        except ValueError:
            continue

    return "0,00"

def format_value_for_sheets(value: str) -> str:
    """Formata valor para o padrão brasileiro (xxxx,xx) para inserção no Google Sheets."""
    if not value or value == "0":
        return "0,00"

    import re

    try:
        # Remove símbolos e espaços desnecessários
        clean_value = re.sub(r'[R$\s]', '', value)

        # Se já está no formato brasileiro (xxxx,xx), mantém
        if re.match(r'^\d{1,8},\d{2}$', clean_value):
            return clean_value

        # Se está no formato americano (xxxx.xx), converte
        if re.match(r'^\d{1,8}\.\d{2}$', clean_value):
            return clean_value.replace('.', ',')

        # Se é número inteiro, adiciona ,00
        if re.match(r'^\d{1,8}$', clean_value):
            return clean_value + ",00"

        # Se está no formato brasileiro com milhares (x.xxx,xx) - MANTÉM COMO ESTÁ
        if re.match(r'^\d{1,3}(?:\.\d{3})*,\d{2}$', clean_value):
            return clean_value

        # Se está no formato americano com milhares (x,xxx.xx), converte
        if re.match(r'^\d{1,3}(?:,\d{3})*\.\d{2}$', clean_value):
            # Remove vírgulas dos milhares e troca ponto por vírgula
            parts = clean_value.split('.')
            if len(parts) == 2:
                integer_part = parts[0].replace(',', '')
                decimal_part = parts[1]
                return f"{integer_part},{decimal_part}"

        # Para valores com pontos mas sem centavos claros, trata como brasileiro
        if '.' in clean_value and ',' not in clean_value:
            # Se tem apenas um ponto e 2 dígitos após, trata como decimal
            if re.match(r'^\d+\.\d{2}$', clean_value):
                return clean_value.replace('.', ',')
            # Se tem mais de um ponto, trata como separador de milhares brasileiro
            elif clean_value.count('.') > 1 or len(clean_value.split('.')[-1]) != 2:
                # Remove todos os pontos e adiciona ,00
                integer_part = clean_value.replace('.', '')
                return f"{integer_part},00"

        # Converte para float e formata
        float_value = float(clean_value.replace(',', '.').replace('.', '', clean_value.count('.') - 1 if clean_value.count('.') > 1 else 0))
        return f"{float_value:.2f}".replace('.', ',')

    except (ValueError, AttributeError):
        return "0,00"

    print("\n🧪 Testando formatação de valores...")
    passed = 0
    total = len(test_cases)

    for input_val, expected in test_cases:
        result = format_value_for_sheets(input_val)
        status = "✅" if result == expected else "❌"
        if result == expected:
            passed += 1
        print(f"{status} '{input_val}' → '{result}' (esperado: '{expected}')")

    print(f"\n📊 Resultado: {passed}/{total} testes passaram ({passed/total*100:.1f}%)")

    if passed == total:
        print("🎉 Todos os testes de formatação passaram!")
    else:
        print(f"⚠️ {total-passed} teste(s) falharam")

    return passed == total

# ===== FUNÇÕES GOOGLE SHEETS =====

def fix_private_key(private_key: str) -> str:
    """Corrige formatação da chave privada para base64 válido."""
    if not private_key:
        return private_key

    # Primeiro, converte escaped newlines para newlines reais
    key_with_newlines = private_key.replace('\\n', '\n')

    # Remove quebras de linha e espaços desnecessários
    key_lines = key_with_newlines.strip().split('\n')

    # Reconstrói a chave mantendo apenas o header, footer e conteúdo base64
    clean_lines: List[str] = []
    for line in key_lines:
        line = line.strip()
        if line.startswith('-----'):
            clean_lines.append(line)
        elif line and not line.startswith('-'):
            # Remove qualquer espaço em branco no meio do base64
            clean_lines.append(line.replace(' ', ''))

    return '\n'.join(clean_lines) + '\n'

def get_google_service_account() -> Any:  # type: ignore
    """Cria conexão com o Google Sheets usando service account do settings.json."""
    try:
        # Carrega configurações
        initialize_global_settings()

        # Usa as configurações do Google Sheets do settings.json
        google_config = settings.get('google_sheets', {})

        # Fallback para google_service_account se google_sheets não existir
        if not google_config:
            google_config = settings.get('google_service_account', {})

        if not google_config:
            raise ValueError("Configurações do Google Sheets não encontradas no settings.json")

        # Cria uma cópia das configurações para usar diretamente
        config_copy = google_config.copy()

        # Verifica se tem campos obrigatórios
        required_fields = ['client_email', 'token_uri', 'private_key']
        missing_fields = [field for field in required_fields if field not in config_copy]

        if missing_fields:
            raise ValueError(f"Campos obrigatórios ausentes nas credenciais: {missing_fields}")

        # Verifica e corrige a chave privada se necessário
        # (preferir helper compartilhado quando disponível, mas manter fallback local)
        private_key = config_copy.get('private_key', '')
        if private_key:
            try:
                from libs.google import credentials_from_service_account_info  # type: ignore
            except Exception:
                try:
                    config_copy['private_key'] = fix_private_key(private_key)
                    logger.debug("🔧 Chave formatada (fallback local)")
                except Exception as key_error:
                    logger.warning(f"⚠️ Chave privada: {key_error}")
            else:
                # Normalização acontece no helper (inclui \\n -> \n)
                pass

        # Cria credenciais usando as configurações do Google Sheets
        try:
            from libs.google import build_service, credentials_from_service_account_info  # type: ignore

            credentials = credentials_from_service_account_info(config_copy, scopes=scopes)
            service = build_service("sheets", "v4", credentials, cache_discovery=False)  # type: ignore
        except Exception:
            credentials = service_account.Credentials.from_service_account_info(  # type: ignore
                config_copy,
                scopes=scopes
            )
            service = build('sheets', 'v4', credentials=credentials)  # type: ignore

        logger.info("✅ Google Sheets conectado")
        return service  # type: ignore

    except Exception as e:
        error_msg = str(e)
        if "Incorrect padding" in error_msg:
            logger.error("❌ Chave privada mal formatada")
            raise ValueError("Chave privada do Google Sheets mal formatada. Verifique o arquivo settings.json")
        elif "missing fields" in error_msg.lower():
            logger.error("❌ Credenciais incompletas")
            raise ValueError(f"Credenciais incompletas: {error_msg}")
        else:
            logger.error(f"❌ Google Sheets: {e}")
            raise

def update_sheet_value(service: Any, cell: str, value: str) -> bool:
    """Atualiza valor em uma célula específica com formatação brasileira."""
    try:
        initialize_global_settings()  # Garante que as configurações estão carregadas

        # Formata o valor para o padrão brasileiro se for monetário
        formatted_value = format_value_for_sheets(value)

        body: Dict[str, Any] = {
            'values': [[formatted_value]]
        }

        # Usa o nome da aba "Comercial" diretamente
        range_str = f"{sheet_name}!{cell}"

        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range_str,
            valueInputOption='USER_ENTERED',
            body=body
        ).execute()

        logger.info(f"✅ Célula {cell} atualizada com: {formatted_value}")
        return True
    except Exception as e:
        logger.error(f"❌ Erro ao atualizar célula {cell}: {e}")
        return False

def batch_update_sheet(service: Any, updates: Dict[str, Any]) -> bool:
    """Atualiza múltiplas células de uma vez com formatação brasileira."""
    try:
        initialize_global_settings()  # Garante que as configurações estão carregadas

        data: List[Dict[str, Any]] = []
        for key, value in updates.items():
            if key in data_mapping:
                cell_ref = data_mapping[key]
            else:
                cell_ref = key

            # Formata valores monetários para o padrão brasileiro
            formatted_value = format_value_for_sheets(str(value)) if key.startswith('vendas_') else str(value)

            # Usa o nome da aba "Comercial" diretamente
            data.append({
                'range': f"{sheet_name}!{cell_ref}",
                'values': [[formatted_value]]
            })

        body: Dict[str, Any] = {
            'valueInputOption': 'USER_ENTERED',
            'data': data
        }

        service.spreadsheets().values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body=body
        ).execute()

        logger.info(f"📝 {len(updates)} células atualizadas")
        return True
    except Exception as e:
        logger.error(f"❌ Atualização lote: {e}")
        return False

def update_sheet_by_date(service: Any, data: Dict[str, Any], unit_code: str) -> bool:
    """Atualiza planilha encontrando a data de hoje na coluna A e atualizando a coluna correspondente."""
    try:
        initialize_global_settings()  # Garante que as configurações estão carregadas

        today = datetime.now().strftime("%d/%m/%Y")
        logger.info(f"🗓️ Buscando {today}...")

        # Busca dados da coluna A para encontrar a linha com a data de hoje
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"{sheet_name}!A:A"
        ).execute()

        values = result.get('values', [])
        target_row = None

        # Debug: mostra informações para diagnóstico (apenas em modo debug)
        logger.info(f"📊 Linhas: {len(values)}")
        if logger.level <= logging.DEBUG:
            logger.debug("🔍 Primeiras 5 linhas:")
            for i, row in enumerate(values[:5]):
                if row and len(row) > 0:
                    cell_value = str(row[0]).strip()
                    logger.debug(f"   Linha {i+1}: '{cell_value}'")
                else:
                    logger.debug(f"   Linha {i+1}: [VAZIA]")

        # Procura a linha com a data de hoje (busca mais específica)
        for i, row in enumerate(values):
            if row and len(row) > 0:
                cell_value = str(row[0]).strip()

                # Busca EXATA primeiro (preferência)
                if cell_value == today:
                    target_row = i + 1  # +1 porque as linhas são 1-indexed
                    logger.info(f"✅ Data encontrada na linha {target_row}")
                    break

                # Busca alternativa: verifica se é uma data válida que contém hoje
                elif today in cell_value and len(cell_value) <= 15:  # Limita tamanho para evitar timestamps longos
                    # Verifica se é realmente uma data (dd/mm/yyyy)
                    date_pattern = r'\b\d{2}/\d{2}/\d{4}\b'
                    if re.search(date_pattern, cell_value):
                        target_row = i + 1
                        logger.info(f"✅ Data encontrada na linha {target_row} ('{cell_value}')")
                        break

        if target_row is None:
            logger.warning(f"⚠️ Data não encontrada. Usando linha 2.")
            target_row = 2

        # Mapeia a unidade para a coluna correspondente
        unit_column_mapping = {
            "bss": "B",  # BSS - Coluna B
            "nh": "C",   # NH - Coluna C
            "rj": "D"    # RJ - Coluna D
        }

        column = unit_column_mapping.get(unit_code, "B")
        cell_ref = f"{column}{target_row}"

        # Atualiza apenas o valor de vendas na célula correspondente
        vendas_value = data.get(f"vendas_{unit_code}", "0")

        # Formata o valor para o padrão brasileiro
        formatted_vendas_value = format_value_for_sheets(vendas_value)

        logger.info(f"📝 Atualizando {cell_ref}: {formatted_vendas_value}")

        # Atualiza a célula específica
        update_data: List[Dict[str, Any]] = [{
            'range': f"{sheet_name}!{cell_ref}",
            'values': [[formatted_vendas_value]]
        }]

        # Também atualiza o timestamp se fornecido
        if "data_atualizacao" in data:
            timestamp_cell = f"A1"  # Mantém o timestamp no A1
            update_data.append({
                'range': f"{sheet_name}!{timestamp_cell}",
                'values': [[str(data["data_atualizacao"])]]
            })

        body: Dict[str, Any] = {
            'valueInputOption': 'USER_ENTERED',
            'data': update_data
        }

        service.spreadsheets().values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body=body
        ).execute()

        logger.info(f"✅ Célula {cell_ref} atualizada!")
        return True

    except Exception as e:
        logger.error(f"❌ Atualização por data: {e}")
        return False

def update_sheet_value_direct(service: Any, sheet_name: str, cell: str, value: str) -> bool:
    """Atualiza valor em uma célula específica usando nome direto da aba com formatação brasileira."""
    initialize_global_settings()

    try:
        # Formata o valor para o padrão brasileiro se for monetário
        formatted_value = format_value_for_sheets(value)

        body = {
            'values': [[formatted_value]]
        }

        # Usa o nome da planilha diretamente
        range_str = f"{sheet_name}!{cell}"

        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range_str,
            valueInputOption='USER_ENTERED',
            body=body
        ).execute()

        logger.info(f"✅ Célula {cell} atualizada com: {formatted_value}")
        return True
    except Exception as e:
        logger.error(f"❌ Erro ao atualizar célula {cell}: {e}")
        return False

# ===== FUNÇÕES DE AUTOMAÇÃO PRINCIPAL =====

def login_espaco_facial(driver: webdriver.Chrome) -> bool:
    """Realiza login no sistema Espaço Facial."""
    try:
        initialize_global_settings()

        logger.info("🔐 Fazendo login...")

        # Navega para a página de login
        ef_config = settings.get("espaco_facial", {})
        login_url = ef_config.get("login_url", "")
        if not login_url:
            logger.error("❌ URL não configurada")
            return False

        # Garantir que a URL tenha protocolo
        if not login_url.startswith(("http://", "https://")):
            login_url = f"https://{login_url}"
            logger.info(f"🔗 HTTPS adicionado")

        logger.info(f"🌐 Acessando: {login_url}")

        driver.get(login_url)
        wait_for_page_load(driver, timeout=20)

        # Debug: verificar se chegou na página de login
        logger.info(f"📄 Título: {driver.title}")
        logger.info(f"📍 URL: {driver.current_url}")

        # OTIMIZAÇÃO 4: Seletores otimizados baseados nos logs de sucesso
        logger.info("🔍 Localizando usuário...")
        username_selectors = [
            # Seletores mais específicos primeiro (baseados nos logs de sucesso)
            "input[type='email']",
            "input[type='text']:first-of-type",
            "input[name='email']",
            "input[name='username']",
            "input[placeholder*='email' i]",
            ".bubble-element.Input input[type='text']",
            "//input[@type='text'][1]",
            "//input[@type='email']"
        ]

        username_field = find_element_by_multiple_selectors(
            driver, username_selectors, "campo de usuário", timeout=3  # Reduzido de 5
        )

        # OTIMIZAÇÃO 5: Campo de senha - seletor único e direto
        logger.info("🔍 Localizando senha...")
        password_selectors = [
            "input[type='password']",
            ".bubble-element.Input input[type='password']",
            "//input[@type='password']"
        ]

        password_field = find_element_by_multiple_selectors(
            driver, password_selectors, "campo de senha", timeout=2  # Reduzido de 3
        )

        # Preenche credenciais
        username = ef_config.get("username", "")
        password = ef_config.get("password", "")  # Senha diretamente, sem decodificação

        if not username or not password:
            logger.error("❌ Credenciais não configuradas")
            return False

        logger.info(f"✏️ Usuário: {username}")
        username_field.clear()
        username_field.send_keys(username)  # type: ignore
        time.sleep(0.5)  # Reduzido de 1

        logger.info("🔑 Preenchendo senha...")
        password_field.clear()
        password_field.send_keys(password)  # Usa a senha diretamente  # type: ignore
        time.sleep(0.5)  # Reduzido de 1

        # OTIMIZAÇÃO 6: Seletores de botão simplificados
        logger.info("🔍 Localizando login...")
        login_button_selectors = [
            # Seletores mais diretos primeiro
            "button[type='submit']",
            "input[type='submit']",
            "button.bubble-element.Button.clickable-element",
            "//button[contains(text(), 'Entrar')]",
            "//button[contains(text(), 'Login')]",
            "//input[@value='Entrar']",
            "form button:last-of-type"
        ]

        login_button = find_element_by_multiple_selectors(
            driver, login_button_selectors, "botão de login", timeout=3  # Reduzido de 5
        )

        logger.info("🚀 Fazendo login...")
        login_button.click()

        # Aguarda carregamento após login
        time.sleep(2)  # Reduzido de 3
        wait_for_page_load(driver, timeout=15)  # Reduzido de 20

        # Verifica se login foi bem-sucedido
        current_url = driver.current_url

        # Verifica mudança de URL como indicador principal
        if current_url != login_url and "login" not in current_url.lower():
            logger.info("✅ Login realizado com sucesso!")
            log_page_info(driver)
            return True
        else:
            # Verifica outros indicadores
            success_indicators = [
                "dashboard" in current_url.lower(),
                "home" in current_url.lower(),
                "painel" in current_url.lower(),
                "menu" in current_url.lower(),
                "main" in current_url.lower()
            ]

            if any(success_indicators):
                logger.info("✅ Login realizado com sucesso!")
                log_page_info(driver)
                return True
            else:
                logger.error("❌ Erro no login - permaneceu na página de login")
                return False

    except Exception as e:
        logger.error(f"❌ Erro durante o login: {e}")
        take_screenshot(driver, "login_error.png")
        return False

def click_proceed_button(driver: webdriver.Chrome, timeout: int = 10) -> bool:
    """Procura e clica no botão 'Prosseguir' após seleção de unidade."""
    try:
        logger.info("🔍 Procurando 'Prosseguir'...")

        # OTIMIZAÇÃO 12: Seletores priorizados para "Prosseguir"
        proceed_selectors = [
            # Seletores mais diretos primeiro
            "//button[contains(text(), 'Prosseguir')]",
            "//button[@data-outline='true' and normalize-space(text())='Prosseguir']",
            "button.bubble-element.Button.clickable-element[data-outline='true']",
            ".bubble-element.Button.clickable-element"
        ]

        for i, selector in enumerate(proceed_selectors):
            try:
                logger.debug(f"  🔎 Tentando seletor [{i+1}/{len(proceed_selectors)}]")

                # OTIMIZAÇÃO 13: Timeout reduzido drasticamente
                wait_time = 1 if i < 2 else 0.5  # Primeiro 2 seletores: 1s, outros: 0.5s

                if selector.startswith("//"):
                    button = WebDriverWait(driver, wait_time).until(
                        EC.element_to_be_clickable((By.XPATH, selector))
                    )
                else:
                    button = WebDriverWait(driver, wait_time).until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, selector))
                    )

                # Verificação de texto apenas para seletores genéricos
                if selector == ".bubble-element.Button.clickable-element":
                    try:
                        button_text = button.text.lower()
                        if "prosseguir" not in button_text:
                            logger.debug(f"    ⚠️ Botão genérico '{button.text}' não é 'Prosseguir'")
                            continue
                    except:
                        continue

                logger.info(f"🖱️ Clicando 'Prosseguir'")
                try:
                    button.click()
                except ElementClickInterceptedException:
                    logger.warning("⚠️ Usando JavaScript...")
                    driver.execute_script("arguments[0].click();", button)  # type: ignore

                logger.info("✅ 'Prosseguir' clicado!")
                time.sleep(2)  # Reduzido de 3
                wait_for_page_load(driver, timeout=15)  # Reduzido de 20
                return True

            except TimeoutException:
                logger.debug(f"    ⏳ Timeout para seletor {i+1}")
                continue
            except Exception as e:
                logger.debug(f"    ❌ Erro: {type(e).__name__}")
                continue

        # OTIMIZAÇÃO 14: Busca rápida final
        logger.info("🔍 Busca rápida final por 'Prosseguir'...")
        try:
            buttons = driver.find_elements(By.XPATH, "//button[contains(text(), 'prosseguir') or contains(text(), 'Prosseguir')]")
            for btn in buttons[:2]:  # Máximo 2 botões
                try:
                    if btn.is_displayed() and btn.is_enabled():
                        btn.click()
                        logger.info("✅ 'Prosseguir' encontrado via busca rápida!")
                        time.sleep(2)
                        wait_for_page_load(driver, timeout=15)
                        return True
                except:
                    continue
        except:
            pass

        logger.warning("⚠️ 'Prosseguir' não encontrado")
        return False

    except Exception as e:
        logger.error(f"❌ Erro crítico ao procurar 'Prosseguir': {e}")
        return False

def select_unit(driver: webdriver.Chrome, unit_code: str) -> bool:
    """Seleciona unidade específica no sistema."""
    try:
        unit_names = {
            "bss": ["Barra Shopping Sul", "BSS", "Barra Sul", "Porto Alegre"],
            "nh": ["Novo Hamburgo", "NH", "Hamburgo"],
            "rj": ["Rio de Janeiro", "RJ", "Rio"]
        }

        if unit_code not in unit_names:
            logger.error(f"❌ Código de unidade inválido: {unit_code}")
            return False

        logger.info(f"🏢 Selecionando unidade: {unit_code.upper()}")

        # Primeiro, procura por botão "Selecione a Unidade" para abrir dropdown
        dropdown_trigger_selectors = [
            "//button[contains(text(), 'Selecione a Unidade')]",
            "//button[contains(text(), 'Selecione')]",
            "//div[contains(text(), 'Selecione a Unidade')]",
            ".bubble-element.Button:contains('Selecione')",
            "button.bubble-element.Button.clickable-element",
            "[class*='dropdown']",
            "[class*='select']"
        ]

        # Tenta clicar no botão para abrir dropdown
        dropdown_opened = False
        for selector in dropdown_trigger_selectors:
            try:
                if selector.startswith("//"):
                    trigger_element = driver.find_element(By.XPATH, selector)
                elif ":contains(" in selector:
                    tag, contains_part = selector.split(":contains(", 1)
                    text_content = contains_part.rstrip(")").strip("'\"")
                    xpath = f"//{tag}[contains(text(), '{text_content}')]"
                    trigger_element = driver.find_element(By.XPATH, xpath)
                else:
                    trigger_element = driver.find_element(By.CSS_SELECTOR, selector)

                trigger_element.click()
                logger.info(f"✅ Dropdown aberto com: {selector}")
                time.sleep(2)
                dropdown_opened = True
                break
            except:
                continue

        # Se o dropdown foi aberto, procura pelas opções de unidade
        if dropdown_opened:
            logger.info("🔍 Procurando opções de unidade no dropdown aberto...")

            # Aguarda um pouco mais para as opções aparecerem
            time.sleep(1)

            # Seletores para opções de dropdown customizado (Bubble.io)
            unit_option_selectors: List[str] = []
            for unit_name in unit_names[unit_code]:
                unit_option_selectors.extend([  # type: ignore
                    # Opções de dropdown customizado
                    f"//div[@role='option' and contains(text(), '{unit_name}')]",
                    f"//li[@role='option' and contains(text(), '{unit_name}')]",
                    f"//div[contains(@class, 'dropdown-option') and contains(text(), '{unit_name}')]",
                    f"//div[contains(@class, 'option') and contains(text(), '{unit_name}')]",
                    f"//div[contains(@class, 'bubble-element') and contains(text(), '{unit_name}')]",
                    f"//span[contains(text(), '{unit_name}')]",
                    f"//div[contains(text(), '{unit_name}')]",
                    f"//a[contains(text(), '{unit_name}')]",
                    f"//button[contains(text(), '{unit_name}')]",
                    # Seletores mais genéricos
                    f"//*[contains(text(), '{unit_name}') and (contains(@class, 'option') or contains(@class, 'item') or contains(@class, 'choice'))]",
                ])

            # Tenta clicar na opção da unidade
            for selector in unit_option_selectors:
                try:
                    element: WebElement = WebDriverWait(driver, 1).until(
                        EC.element_to_be_clickable((By.XPATH, selector))  # type: ignore
                    )

                    # Verifica se o elemento está visível
                    if element.is_displayed():
                        element.click()
                        logger.info(f"✅ Unidade {unit_code} selecionada via: {selector}")
                        time.sleep(2)

                        # Após selecionar a unidade, procura e clica no botão "Prosseguir"
                        if click_proceed_button(driver):
                            return True
                        else:
                            logger.warning("⚠️ Botão 'Prosseguir' não encontrado - continuando...")
                            return True
                except:
                    continue

            # Se não encontrou opções, tenta clicar diretamente no texto
            logger.info("🔍 Tentando localizar opções por texto direto...")
            try:
                # Pega todos os elementos visíveis na página
                all_elements = driver.find_elements(By.XPATH, "//*[contains(@class, 'bubble-element')]")

                for element in all_elements:
                    try:
                        element_text = element.text.strip()
                        if element_text and any(unit_name.lower() in element_text.lower() for unit_name in unit_names[unit_code]):
                            if element.is_displayed() and element.is_enabled():
                                logger.info(f"🎯 Encontrado elemento com texto: '{element_text}'")
                                element.click()
                                logger.info(f"✅ Unidade selecionada clicando em: '{element_text}'")
                                time.sleep(2)

                                # Tenta clicar em "Prosseguir"
                                if click_proceed_button(driver):
                                    return True
                                else:
                                    logger.warning("⚠️ Botão 'Prosseguir' não encontrado - continuando...")
                                    return True
                    except:
                        continue

            except Exception as e:
                logger.debug(f"Erro ao buscar elementos: {e}")

        # Se não conseguiu com dropdown, tenta encontrar elementos de seleção tradicionais
        logger.info("🔍 Tentando encontrar seletores de unidade tradicionais...")

        # Procura por seletores de unidade (após dropdown abrir)
        unit_selectors = [
            "select[name='unidade']",
            "select[name='unit']",
            "select[name='loja']",
            "select[id='unidade']",
            "#select-unidade",
            ".unit-selector select",
            ".bubble-element select",
            "//select[contains(@name, 'unidade') or contains(@name, 'unit')]"
        ]

        try:
            unit_select = find_element_by_multiple_selectors(
                driver, unit_selectors, "seletor de unidade", timeout=5
            )

            # Usa Select para opções dropdown
            select_obj = Select(unit_select)

            # Tenta encontrar a opção correta
            unit_options = unit_names[unit_code]
            option_selected = False

            for option_text in unit_options:
                try:
                    select_obj.select_by_visible_text(option_text)
                    logger.info(f"✅ Unidade selecionada: {option_text}")
                    option_selected = True
                    break
                except:
                    try:
                        # Tenta por valor
                        select_obj.select_by_value(option_text.lower())
                        logger.info(f"✅ Unidade selecionada por valor: {option_text}")
                        option_selected = True
                        break
                    except:
                        continue

            if not option_selected:
                # Tenta seleção por índice se necessário
                options = select_obj.options
                for i, option in enumerate(options):
                    option_text = option.text.strip()
                    if any(unit_name.lower() in option_text.lower() for unit_name in unit_options):
                        select_obj.select_by_index(i)
                        logger.info(f"✅ Unidade selecionada por índice {i}: {option_text}")
                        option_selected = True
                        break

            if not option_selected:
                logger.warning(f"⚠️ Unidade {unit_code} não encontrada - usando padrão")

            time.sleep(2)

            # Após selecionar no dropdown, procura e clica no botão "Prosseguir"
            if click_proceed_button(driver):
                return True
            else:
                logger.warning("⚠️ Botão 'Prosseguir' não encontrado - continuando...")
                return True

        except Exception:
            # Se não encontrou dropdown tradicional, procura por links/botões específicos da unidade
            logger.info("🔍 Dropdown tradicional não encontrado, procurando opções alternativas de unidade...")

            unit_link_selectors: List[str] = []
            for unit_name in unit_names[unit_code]:
                unit_link_selectors.extend([
                    f"//a[contains(text(), '{unit_name}')]",
                    f"//button[contains(text(), '{unit_name}')]",
                    f"//div[contains(text(), '{unit_name}') and contains(@class, 'bubble')]",
                    f"//li[contains(text(), '{unit_name}')]",
                    f"//span[contains(text(), '{unit_name}')]",
                    f"[data-value='{unit_name.lower()}']",
                    f"[data-unit='{unit_name.lower()}']",
                    f".option:contains('{unit_name}')",
                    f".bubble-element:contains('{unit_name}')"
                ])

            for selector in unit_link_selectors:
                try:
                    if selector.startswith("//"):
                        element = driver.find_element(By.XPATH, selector)
                    elif ":contains(" in selector:
                        tag, contains_part = selector.split(":contains(", 1)
                        text_content = contains_part.rstrip(")").strip("'\"")
                        xpath = f"//{tag}[contains(text(), '{text_content}')]"
                        element = driver.find_element(By.XPATH, xpath)
                    else:
                        element = driver.find_element(By.CSS_SELECTOR, selector)

                    element.click()
                    logger.info(f"✅ Unidade {unit_code} selecionada via: {selector}")
                    time.sleep(2)

                    # Após selecionar a unidade, procura e clica no botão "Prosseguir"
                    if click_proceed_button(driver):
                        return True
                    else:
                        logger.warning("⚠️ Botão 'Prosseguir' não encontrado - continuando...")
                        return True
                except:
                    continue

            logger.warning(f"⚠️ Seletor de unidade não encontrado - assumindo unidade padrão")

            # Mesmo se não encontrou seletor de unidade, tenta clicar em "Prosseguir"
            if click_proceed_button(driver):
                return True
            else:
                logger.warning("⚠️ Botão 'Prosseguir' não encontrado - continuando...")
                return True

    except Exception as e:
        logger.error(f"❌ Erro ao selecionar unidade {unit_code}: {e}")
        return False

def collect_sales_data(driver: webdriver.Chrome, unit_code: str) -> Dict[str, Any]:
    """Coleta dados de vendas da unidade especificada seguindo o fluxo do arquivo Selenium IDE."""
    try:
        logger.info(f"📊 Coletando dados de vendas para {unit_code.upper()}...")

        # Dicionário para armazenar os dados coletados
        sales_data = {
            f"vendas_{unit_code}": "0",
            "data_atualizacao": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
            "status": "coletado"
        }

        # Passo 1: Navegar para seção "Caixa" (baseado no arquivo Selenium IDE)
        logger.info("🏪 Navegando para seção Caixa...")
        if not navigate_to_cash_section(driver):
            logger.error("❌ Falha ao navegar para seção Caixa")
            sales_data["status"] = "erro_navegacao_caixa"
            return sales_data

        # Passo 2: Navegar para "Vendas do Dia" (baseado no arquivo Selenium IDE)
        logger.info("📊 Navegando para Vendas do Dia...")
        if not navigate_to_sales_summary(driver):
            logger.error("❌ Falha ao navegar para Vendas do Dia")
            sales_data["status"] = "erro_navegacao_vendas"
            return sales_data

        # Passo 3: Aguardar carregamento da página de vendas (OTIMIZADO)
        logger.info("⏳ Aguardando carregamento da página de vendas...")
        wait_for_page_load(driver, timeout=10)  # Reduzido de 15
        time.sleep(2)  # Reduzido de 3

        # OTIMIZAÇÃO 10: Seletores específicos para valores de vendas
        logger.info("💰 Coletando valores de vendas...")

        # Seletores otimizados baseados em padrões reais de sucesso
        sales_selectors = [
            # Primeiro: valores monetários específicos
            "//span[contains(text(), 'R$')]",
            "//div[contains(text(), 'R$')]",
            "//td[contains(text(), 'R$')]",
            # Segundo: elementos com números monetários
            "//span[translate(text(), '0123456789,.R$', '') = '']",
            "//div[translate(text(), '0123456789,.R$', '') = '']",
            # Terceiro: estruturas de tabela
            "//tr[contains(., 'Vendas')]//td[contains(text(), 'R$')]",
            "//div[contains(@class, 'bubble-element')]//*[contains(text(), 'R$')]"
        ]

        # OTIMIZAÇÃO 11: Busca rápida por valores
        sales_value = None

        # Primeira tentativa: busca direta por R$
        try:
            monetary_elements = driver.find_elements(By.XPATH, "//span[contains(text(), 'R$')] | //div[contains(text(), 'R$')]")

            for element in monetary_elements[:5]:  # Limita a 5 elementos para velocidade
                try:
                    text = element.text.strip()
                    if text and "R$" in text:
                        extracted_number = extract_number_from_text(text)
                        if extracted_number and extracted_number != "0":
                            sales_value = extracted_number
                            logger.info(f"✅ Valor encontrado: {text} -> {sales_value}")
                            break
                except:
                    continue

            if sales_value:
                sales_data[f"vendas_{unit_code}"] = sales_value
                logger.info(f"📈 Vendas {unit_code.upper()}: {sales_value}")
                return sales_data

        except Exception as e:
            logger.debug(f"Erro na busca rápida: {e}")

        # Segunda tentativa: seletores específicos se a primeira falhou
        for i, selector in enumerate(sales_selectors[:3]):  # Limita a 3 seletores
            try:
                logger.debug(f"  🔎 Tentando seletor vendas [{i+1}/3]")
                elements = driver.find_elements(By.XPATH, selector)

                for element in elements[:3]:  # Máximo 3 elementos por seletor
                    try:
                        text = element.text.strip()
                        if text and ("R$" in text or any(c.isdigit() for c in text)):
                            extracted_number = extract_number_from_text(text)
                            if extracted_number and extracted_number != "0":
                                sales_value = extracted_number
                                logger.info(f"✅ Valor encontrado: {text} -> {sales_value}")
                                break
                    except:
                        continue

                if sales_value:
                    break

            except Exception as e:
                logger.debug(f"Erro com seletor: {e}")
                continue

        # Atualiza o valor final nos dados
        if sales_value:
            sales_data[f"vendas_{unit_code}"] = sales_value
            logger.info(f"📈 Vendas {unit_code.upper()}: {sales_value}")
        else:
            logger.warning(f"⚠️ Valor não encontrado para {unit_code.upper()}")
            sales_data[f"vendas_{unit_code}"] = "0"

        return sales_data


    except Exception as e:
        logger.error(f"❌ Coleta de dados {unit_code}: {e}")
        return {
            f"vendas_{unit_code}": "0",
            "data_atualizacao": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
            "status": "erro"
        }

def run_automation(unit_code: str, headless: bool = False) -> bool:
    """Executa automação completa para uma unidade."""
    driver = None
    try:
        logger.info(f"🚀 Automação {unit_code.upper()}")

        # Inicializa driver
        driver = get_chrome_driver(headless)

        # Realiza login
        if not login_espaco_facial(driver):
            logger.error("❌ Login falhou")
            return False

        # Seleciona unidade
        if not select_unit(driver, unit_code):
            logger.warning("⚠️ Seleção unidade falhou - continuando...")

        # Aguarda carregamento (OTIMIZADO)
        time.sleep(2)  # Reduzido de 3
        wait_for_page_load(driver)

        # Coleta dados
        sales_data = collect_sales_data(driver, unit_code)

        # Conecta com Google Sheets
        try:
            sheets_service = get_google_service_account()

            # Atualiza planilha
            if update_sheet_by_date(sheets_service, sales_data, unit_code):
                logger.info(f"✅ Automação concluída {unit_code.upper()}")
                return True
            else:
                logger.error(f"❌ Planilha {unit_code.upper()}")
                return False

        except Exception as e:
            logger.error(f"❌ Google Sheets: {e}")
            return False
    finally:
        if driver:
            try:
                driver.quit()
                logger.info("🔒 Navegador fechado")
            except:
                pass

# ===== SISTEMA INTERATIVO E INTERFACE =====

def print_welcome() -> None:
    """Exibe mensagem de boas-vindas."""
    print("\n" + "="*60)
    print("🚀 AUTOMAÇÃO ESPAÇO FACIAL - SISTEMA DE COLETA DE DADOS")
    print("="*60)
    print("📊 Coleta automática de dados de vendas")
    print("📈 Atualização do Google Sheets")
    print("🔧 Sistema de diagnóstico integrado")
    print("="*60 + "\n")

def get_user_input(prompt: str, options: List[str] = []) -> str:
    """Solicita entrada do usuário com validação."""
    while True:
        try:
            if options and len(options) > 0:
                print(f"\n{prompt}")
                for i, option in enumerate(options, 1):
                    print(f"{i}. {option}")
                print("0. Sair")

                choice = input("\nEscolha uma opção: ").strip()

                if choice == "0":
                    return "sair"

                try:
                    choice_idx = int(choice) - 1
                    if 0 <= choice_idx < len(options):
                        return options[choice_idx].lower()
                    else:
                        print("❌ Opção inválida!")
                        continue
                except ValueError:
                    print("❌ Digite um número válido!")
                    continue
            else:
                response = input(f"{prompt}: ").strip()
                if response:
                    return response
                print("❌ Resposta não pode estar vazia!")

        except KeyboardInterrupt:
            print("\n\n👋 Programa interrompido pelo usuário")
            return "sair"

def get_yes_no(prompt: str) -> bool:
    """Solicita confirmação sim/não do usuário."""
    while True:
        try:
            response = input(f"{prompt} (s/n): ").strip().lower()
            if response in ['s', 'sim', 'y', 'yes']:
                return True
            elif response in ['n', 'não', 'nao', 'no']:
                return False
            else:
                print("❌ Digite 's' para sim ou 'n' para não")
        except KeyboardInterrupt:
            print("\n\n👋 Programa interrompido pelo usuário")
            return False

def configure_system() -> bool:
    """Interface para configurar o sistema."""
    try:
        print("\n🔧 CONFIGURAÇÃO DO SISTEMA")
        print("-" * 40)

        initialize_global_settings()

        config_updated = False

        # Verifica configurações atuais
        ef_config = settings.get("espaco_facial", {})
        current_url = ef_config.get("login_url", "")
        current_user = ef_config.get("username", "")

        if current_url:
            print(f"✅ URL atual: {current_url}")
        else:
            print("❌ URL não configurada")

        if current_user:
            print(f"✅ Usuário atual: {current_user}")
        else:
            print("❌ Usuário não configurado")

        # Permite atualizar configurações
        if get_yes_no("\n🔄 Deseja atualizar as configurações"):

            # Cria novo dict para as configurações do Espaço Facial
            new_config = ef_config.copy()

            # URL do sistema
            new_url = input(f"🌐 URL do sistema [{current_url}]: ").strip()
            if new_url:
                new_config["login_url"] = new_url
                config_updated = True

            # Usuário
            new_user = input(f"👤 Nome de usuário [{current_user}]: ").strip()
            if new_user:
                new_config["username"] = new_user
                config_updated = True

            # Senha (opcional)
            if get_yes_no("🔑 Deseja atualizar a senha"):
                import getpass
                new_password = getpass.getpass("🔑 Nova senha: ")
                if new_password:
                    # Salva a senha diretamente, sem codificação
                    new_config["password"] = new_password
                    config_updated = True
                    print("✅ Senha atualizada")

            # Salva configurações
            if config_updated:
                save_config(new_config)
                print("✅ Configurações salvas com sucesso!")
            else:
                print("ℹ️ Nenhuma alteração realizada")

        return True

    except Exception as e:
        logger.error(f"❌ Erro na configuração: {e}")
        print(f"❌ Erro na configuração: {e}")
        return False

def show_main_menu() -> str:
    """Exibe menu principal e retorna escolha do usuário."""
    options = [
        "🚀 Executar automação",
        "🔧 Configurar sistema",
        "🩺 Diagnóstico completo"
    ]

    choice = get_user_input("📋 MENU PRINCIPAL - Selecione uma opção:", options)
    return choice

# ===== FUNÇÕES DE DIAGNÓSTICO =====

def test_sheets_connection() -> bool:
    """Testa conexão com Google Sheets."""
    try:
        print("\n🔗 Testando conexão com Google Sheets...")

        # Check if Google Sheets config exists
        initialize_global_settings()
        google_config = settings.get('google_service_account', {})

        # Fallback para google_service_account se google_service_account não existir
        if not google_config:
            google_config = settings.get('google_service_account', {})

        if not google_config:
            print("❌ Configuração do Google Sheets não encontrada")
            return False

        # Try to create service with better error handling
        try:
            sheets_service = get_google_service_account()
        except Exception as settings_error:
            if "base64" in str(settings_error).lower():
                print("❌ Erro de credenciais (base64) - Configuração do Google Sheets precisa ser atualizada")
                logger.error(f"Google Sheets settings error: {settings_error}")
                return False
            else:
                raise settings_error

        # Test reading from spreadsheet
        result = sheets_service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"{sheet_name}!A1"
        ).execute()

        print("✅ Conexão com Google Sheets estabelecida")
        print(f"✅ Planilha acessível: {spreadsheet_id}")
        print(f"✅ Aba acessível: {sheet_name}")

        values = result.get('values', [])
        if values:
            print(f"✅ Valor em A1: {values[0][0] if values[0] else '[vazio]'}")

        return True

    except Exception as e:
        print(f"❌ Erro na conexão: {e}")
        logger.error(f"Erro no teste de conexão: {e}")
        return False

def show_status() -> None:
    """Mostra status geral do sistema."""
    try:
        print("\n📊 STATUS DO SISTEMA")
        print("-" * 50)

        initialize_global_settings()

        # Configurações básicas
        config_status = "✅" if settings.get("login_url") and settings.get("username") else "❌"
        print(f"{config_status} Configurações básicas")

        # Google Sheets
        sheets_status = "✅" if settings.get("google_service_account") else "❌"
        print(f"{sheets_status} Configuração Google Sheets")

        # Conectividade
        try:
            socket.create_connection(("8.8.8.8", 53), timeout=3)
            network_status = "✅"
        except:
            network_status = "❌"
        print(f"{network_status} Conectividade de rede")

        # Chrome disponível
        try:
            driver = get_chrome_driver(headless=True)
            driver.quit()
            chrome_status = "✅"
        except:
            chrome_status = "❌"
        print(f"{chrome_status} Google Chrome/ChromeDriver")

        # Arquivos de log
        log_status = "✅" if os.path.exists("automation.log") else "❌"
        print(f"{log_status} Sistema de logs")

        print("-" * 50)

        # Detalhes das configurações
        if settings.get("login_url"):
            print(f"🌐 URL: {settings['login_url']}")
        if settings.get("username"):
            print(f"👤 Usuário: {settings['username']}")

        print(f"📁 Diretório de trabalho: {os.getcwd()}")
        print(f"🐍 Python: {sys.version.split()[0]}")

    except Exception as e:
        print(f"❌ Erro ao verificar status: {e}")
        logger.error(f"Erro no status: {e}")

def run_complete_diagnosis() -> bool:
    """Executa diagnóstico completo que inclui todas as verificações do sistema."""
    try:
        print("\n🩺 DIAGNÓSTICO COMPLETO DO SISTEMA")
        print("=" * 60)

        all_tests_passed = True

        # 1. Teste de configurações
        print("\n1️⃣ Testando configurações...")
        initialize_global_settings()
        # Usa settings que é o dicionário completo carregado do JSON
        config_problems = validate_config(settings)
        if config_problems:
            print("❌ Problemas encontrados:")
            for problem in config_problems:
                print(f"   • {problem}")
            all_tests_passed = False
        else:
            print("✅ Configurações válidas")

        # 2. Teste de conectividade
        print("\n2️⃣ Testando conectividade...")
        if test_network_connectivity():
            print("✅ Conectividade OK")
        else:
            print("❌ Problemas de conectividade")
            all_tests_passed = False

        # 3. Teste Google Sheets
        print("\n3️⃣ Testando Google Sheets...")
        try:
            # Use a shorter timeout for the Google Sheets test
            if test_sheets_connection():
                print("✅ Google Sheets OK")
            else:
                print("❌ Problemas com Google Sheets")
                all_tests_passed = False
        except Exception as e:
            print(f"❌ Problemas com Google Sheets: {e}")
            all_tests_passed = False

        # 4. Teste Chrome/Driver
        print("\n4️⃣ Testando Chrome/ChromeDriver...")
        try:
            driver = get_chrome_driver(headless=True)
            driver.get("https://www.google.com")
            driver.quit()
            print("✅ Chrome/ChromeDriver OK")
        except Exception as e:
            print(f"❌ Problemas com Chrome: {e}")
            all_tests_passed = False

        # 5. Teste de acesso ao sistema
        print("\n5️⃣ Testando acesso ao sistema...")
        try:
            driver = get_chrome_driver(headless=True)
            ef_config = settings.get("espaco_facial", {})
            login_url = ef_config.get("login_url", "")
            if login_url:
                driver.get(login_url)
                if "erro" not in driver.current_url.lower():
                    print("✅ Sistema acessível")
                else:
                    print("❌ Erro ao acessar sistema")
                    all_tests_passed = False
            else:
                print("❌ URL não configurada")
                all_tests_passed = False
            driver.quit()
        except Exception as e:
            print(f"❌ Erro no acesso: {e}")
            all_tests_passed = False

        # 6. Status geral do sistema
        print("\n6️⃣ Status geral do sistema...")
        print("-" * 30)

        # Configurações básicas
        ef_config = settings.get("espaco_facial", {})
        config_status = "✅" if ef_config.get("login_url") and ef_config.get("username") else "❌"
        print(f"{config_status} Configurações básicas")

        # Google Sheets
        sheets_status = "✅" if settings.get("google_service_account") else "❌"
        print(f"{sheets_status} Configuração Google Sheets")

        # Chrome disponível
        try:
            driver = get_chrome_driver(headless=True)
            driver.quit()
            chrome_status = "✅"
        except:
            chrome_status = "❌"
        print(f"{chrome_status} Chrome/ChromeDriver")

        # Resultado final
        print("\n" + "=" * 60)
        if all_tests_passed:
            print("✅ TODOS OS TESTES PASSARAM - Sistema pronto para uso!")
        else:
            print("❌ ALGUNS TESTES FALHARAM - Verifique os problemas acima")
        print("=" * 60)

        return all_tests_passed

    except Exception as e:
        print(f"❌ Erro durante diagnóstico: {e}")
        logger.error(f"Erro no diagnóstico: {e}")
        return False

def run_comprehensive_diagnosis() -> bool:
    """Executa diagnóstico completo do sistema - mantido para compatibilidade."""
    return run_complete_diagnosis()

def test_network_connectivity() -> bool:
    """Testa conectividade de rede."""
    try:
        # Testa DNS
        socket.create_connection(("8.8.8.8", 53), timeout=5)

        # Testa HTTPS
        urllib.request.urlopen("https://www.google.com", timeout=10)

        return True
    except Exception:
        return False

def diagnose_login_settings() -> Dict[str, bool]:
    """Diagnóstica as credenciais de login."""
    try:
        initialize_global_settings()

        results: Dict[str, bool] = {}

        # Verifica se o username está configurado
        username = settings.get("espaco_facial", {}).get("username", "")
        results["username_configured"] = bool(username)

        # Verifica se a senha está configurada (sem decodificação)
        password = settings.get("espaco_facial", {}).get("password", "")
        results["password_configured"] = bool(password)

        # Verifica se a URL está configurada
        login_url = settings.get("espaco_facial", {}).get("login_url", "")
        results["url_configured"] = bool(login_url)

        return results
    except Exception:
        return {
            "username_configured": False,
            "password_configured": False,
            "url_configured": False
        }

def interactive_mode() -> None:
    """Executa o modo interativo do sistema."""
    try:
        print_welcome()

        while True:
            choice = show_main_menu()

            if choice == "sair":
                print("\n👋 Saindo do programa...")
                break

            elif "executar automação" in choice:
                # Pergunta qual unidade deseja executar
                unit_options = ["Todas as unidades", "Barra Shopping Sul (BSS)", "Novo Hamburgo (NH)"]
                unit_choice = get_user_input("🏢 Selecione a unidade:", unit_options)

                if unit_choice == "sair":
                    continue

                headless = get_yes_no("🖥️ Executar em modo invisível (headless)")

                if "todas as unidades" in unit_choice.lower():
                    print("\n🚀 Executando automação para todas as unidades...")

                    units = ["bss", "nh", "rj"]
                    success_count = 0

                    for unit in units:
                        print(f"\n📍 Processando {unit.upper()}...")
                        if run_automation(unit, headless):
                            success_count += 1
                            print(f"✅ {unit.upper()} - Concluído")
                        else:
                            print(f"❌ {unit.upper()} - Falhou")

                    print(f"\n📊 Resultado: {success_count}/{len(units)} unidades processadas com sucesso")

                else:
                    # Mapeia escolha para código da unidade
                    unit_map = {
                        "barra shopping sul (bss)": "bss",
                        "novo hamburgo (nh)": "nh"
                    }

                    unit_code = unit_map.get(unit_choice.lower(), "bss")
                    print(f"\n🚀 Executando automação para {unit_code.upper()}...")

                    if run_automation(unit_code, headless):
                        print(f"✅ Automação concluída para {unit_code.upper()}")
                    else:
                        print(f"❌ Falha na automação para {unit_code.upper()}")

            elif "configurar sistema" in choice:
                configure_system()

            elif "diagnóstico completo" in choice:
                run_complete_diagnosis()

            input("\n⏸️ Pressione Enter para continuar...")

    except KeyboardInterrupt:
        print("\n\n👋 Programa interrompido pelo usuário")
    except Exception as e:
        logger.error(f"Erro no modo interativo: {e}")
        print(f"❌ Erro no modo interativo: {e}")

# ===== FUNÇÕES DE NAVEGAÇÃO BASEADAS NO SELENIUM IDE =====

def navigate_to_cash_section(driver: webdriver.Chrome, timeout: int = 15) -> bool:
    """Navega para a seção 'Caixa' baseado no arquivo Selenium IDE."""
    try:
        logger.info("🏪 Navegando para seção Caixa...")

        # Aguarda a página carregar completamente após login/seleção de unidade
        wait_for_page_load(driver, timeout=10)
        time.sleep(3)  # Aguarda menu carregar

        # OTIMIZAÇÃO 8: Seletores otimizados para seção Caixa
        cash_selectors = [
            # Seletores mais diretos baseados nos logs de sucesso
            "//div[contains(@class, 'bubble-element') and normalize-space(text())='Caixa']",
            "//div[contains(text(), 'Caixa')]",
            "//span[contains(text(), 'Caixa')]",
            "//*[normalize-space(text())='Caixa']",
            ".bubble-element:contains('Caixa')"
        ]

        # Tenta encontrar e clicar no elemento "Caixa"
        for i, selector in enumerate(cash_selectors):
            try:
                logger.debug(f"  🔎 Tentando seletor Caixa [{i+1}/{len(cash_selectors)}]")

                if selector.startswith("//"):
                    element = WebDriverWait(driver, 2).until(  # Reduzido de 3
                        EC.element_to_be_clickable((By.XPATH, selector))
                    )
                elif ":contains(" in selector:
                    # Converte CSS :contains() para XPath
                    tag, contains_part = selector.split(":contains(", 1)
                    text_content = contains_part.rstrip(")").strip("'\"")
                    xpath = f"//{tag}[contains(text(), '{text_content}')]"
                    element = WebDriverWait(driver, 2).until(
                        EC.element_to_be_clickable((By.XPATH, xpath))
                    )
                else:
                    element = WebDriverWait(driver, 2).until(
                        EC.element_to_be_clickable((By.CSS_SELECTOR, selector))
                    )

                # Verifica se o elemento está visível e habilitado
                if element.is_displayed() and element.is_enabled():
                    logger.info(f"🖱️ Clicando em 'Caixa'")

                    try:
                        element.click()
                    except ElementClickInterceptedException:
                        logger.warning("⚠️ Usando JavaScript...")
                        driver.execute_script("arguments[0].click();", element)  # type: ignore

                    logger.info("✅ 'Caixa' clicado!")
                    time.sleep(1)  # Reduzido de 2
                    wait_for_page_load(driver, timeout=8)  # Reduzido de 10
                    return True

            except TimeoutException:
                logger.debug(f"    ⏳ Timeout para seletor: {selector}")
                continue
            except Exception as e:
                logger.debug(f"    ❌ Erro com seletor '{selector}': {e}")
                continue

        # Se não encontrou com seletores específicos, faz busca mais ampla
        logger.info("🔍 Seletores específicos falharam. Fazendo busca ampla por 'Caixa'...")
        try:
            # Busca ampla por elementos que contenham "Caixa"
            all_elements = driver.find_elements(By.XPATH, "//*[contains(translate(text(), 'CAIXA', 'caixa'), 'caixa')]")

            for element in all_elements:
                try:
                    if element.is_displayed() and element.is_enabled():
                        element_text = element.text.strip()
                        if "caixa" in element_text.lower() and len(element_text) <= 20: # Evita textos muito longos
                            logger.info(f"🎯 Elemento 'Caixa' encontrado: '{element_text}'")
                            element.click()
                            logger.info("✅ Clique em 'Caixa' realizado via busca ampla!")
                            time.sleep(2)
                            wait_for_page_load(driver, timeout=10)
                            return True
                except Exception as e:
                    logger.debug(f"Erro ao clicar em elemento da busca ampla: {e}")
                    continue

        except Exception as e:
            logger.debug(f"Erro na busca ampla: {e}")

        logger.error("❌ Não foi possível encontrar/clicar em 'Caixa'")
        take_screenshot(driver, "cash_section_not_found.png")
        return False

    except Exception as e:
        logger.error(f"❌ Erro ao navegar para seção Caixa: {e}")
        take_screenshot(driver, "cash_navigation_error.png")
        return False

def navigate_to_sales_summary(driver: webdriver.Chrome, timeout: int = 15) -> bool:
    """Navega para 'Vendas do Dia' baseado no arquivo Selenium IDE."""
    try:
        logger.info("📊 Navegando para 'Vendas do Dia'...")

        # Aguarda a seção Caixa carregar
        wait_for_page_load(driver, timeout=8)
        time.sleep(2)

        # OTIMIZAÇÃO 9: Seletores otimizados para "Vendas do Dia"
        sales_selectors = [
            # Seletores mais diretos
            "//div[contains(text(), 'Vendas do Dia')]",
            "//div[normalize-space(text())='Vendas do Dia']",
            "//span[contains(text(), 'Vendas do Dia')]",
            "//*[contains(text(), 'Vendas') and contains(text(), 'Dia')]",
            "//div[contains(text(), 'Vendas')]"
        ]

        # Tenta encontrar e clicar em "Vendas do Dia"
        for i, selector in enumerate(sales_selectors):
            try:
                logger.debug(f"  🔎 Tentando seletor Vendas [{i+1}/{len(sales_selectors)}]")

                element = WebDriverWait(driver, 2).until(  # Reduzido de 3
                    EC.element_to_be_clickable((By.XPATH, selector))
                )

                # Verifica se é realmente "Vendas do Dia"
                element_text = element.text.strip().lower()
                if "vendas" in element_text and ("dia" in element_text or len(element_text) <= 15):
                    logger.info(f"🖱️ Clicando em 'Vendas do Dia'")

                    try:
                        element.click()
                    except ElementClickInterceptedException:
                        logger.warning("⚠️ Usando JavaScript...")
                        driver.execute_script("arguments[0].click();", element)  # type: ignore

                    logger.info("✅ 'Vendas do Dia' clicado!")
                    time.sleep(2)  # Reduzido de 3
                    wait_for_page_load(driver, timeout=10)  # Reduzido de 15
                    return True
                else:
                    logger.debug(f"    ⚠️ Texto não corresponde: '{element.text}'")
                    continue

            except TimeoutException:
                logger.debug(f"    ⏳ Timeout para seletor: {selector}")
                continue
            except Exception as e:
                logger.debug(f"    ❌ Erro com seletor '{selector}': {e}")
                continue

        # Busca ampla se seletores específicos falharam
        logger.info("🔍 Busca ampla por 'Vendas'...")
        try:
            # Busca todos os elementos que contenham "vendas"
            all_elements = driver.find_elements(By.XPATH, "//*[contains(translate(text(), 'VENDAS', 'vendas'), 'vendas')]")

            for element in all_elements:
                try:
                    if element.is_displayed() and element.is_enabled():
                        element_text = element.text.strip().lower()
                        # Prioriza "vendas do dia" mas aceita outros que contenham "vendas"
                        if ("vendas" in element_text and "dia" in element_text) or \
                           ("vendas" in element_text and len(element_text) <= 20):
                            logger.info(f"🎯 Elemento 'Vendas' encontrado: '{element.text.strip()}'")
                            element.click()
                            logger.info("✅ Clique em 'Vendas' realizado via busca ampla!")
                            time.sleep(3)
                            wait_for_page_load(driver, timeout=15)
                            return True
                except Exception as e:
                    logger.debug(f"Erro ao clicar em elemento da busca ampla: {e}")
                    continue

        except Exception as e:
            logger.debug(f"Erro na busca ampla: {e}")

        logger.error("❌ Não foi possível encontrar/clicar em 'Vendas do Dia'")
        take_screenshot(driver, "sales_summary_not_found.png")
        return False

    except Exception as e:
        logger.error(f"❌ Erro ao navegar para 'Vendas do Dia': {e}")
        take_screenshot(driver, "sales_navigation_error.png")
        return False

def main() -> None:
    """Função principal do programa."""
    args: Optional[argparse.Namespace] = None
    try:
        # Configura logging

        setup_logging()

        # Parse dos argumentos
        args = parse_arguments()

        # Configura nível de log baseado nos argumentos
        if args.debug:
            logger.setLevel(logging.DEBUG)
            logger.info("🐛 Debug ativado")
        elif args.silent:
            logger.setLevel(logging.ERROR)
            # Remove handlers do console em modo silencioso
            for handler in logger.handlers[:]:
                if isinstance(handler, logging.StreamHandler) and not isinstance(handler, RotatingFileHandler):
                    logger.removeHandler(handler)  # type: ignore

        logger.info("🚀 Automação v3.0 iniciada")
        logger.info(f"📋 Argumentos: {vars(args)}")

        # Modo de configuração
        if args.configure:
            logger.info("🔧 Configuração do sistema")
            if not args.silent:
                print("\n🔧 CONFIGURAÇÃO DO SISTEMA")
                print("-" * 40)

            success = configure_system()
            sys.exit(0 if success else 1)

        # Modo de diagnóstico
        if args.mode == "diagnose":
            logger.info("🩺 Diagnóstico do sistema")
            if not args.silent:
                print("\n🩺 MODO DIAGNÓSTICO")

                print("-" *  40)

            success = run_comprehensive_diagnosis()
            sys.exit(0 if success else 1)

        # Modo de execução direta
        elif args.mode == "run":
            logger.info("🚀 Modo automático")

            if args.unit:
                # Unidade específica
                logger.info(f"📍 Unidade: {args.unit}")
                if not args.silent:
                    print(f"\n🚀 Executando automação para {args.unit.upper()}")

                success = run_automation(args.unit, args.headless)

                if not args.silent:
                    if success:
                        print(f"✅ Automação concluída para {args.unit.upper()}")
                    else:
                        print(f"❌ Falha na automação para {args.unit.upper()}")

                sys.exit(0 if success else 1)

            else:
                # Todas as unidades
                logger.info("📍 Todas as unidades")
                if not args.silent:
                    print("\n🚀 Executando automação para todas as unidades")

                units = ["bss", "nh", "rj"]
                success_count = 0

                for unit in units:
                    logger.info(f"📍 Processando {unit.upper()}")
                    if not args.silent:
                        print(f"\n📍 Processando {unit.upper()}...")

                    if run_automation(unit, args.headless):
                        success_count += 1
                        logger.info(f"✅ {unit.upper()} concluído")
                        if not args.silent:
                            print(f"✅ {unit.upper()} - Concluído")
                    else:
                        logger.error(f"❌ {unit.upper()} falhou")
                        if not args.silent:
                            print(f"❌ {unit.upper()} - Falhou")

                logger.info(f"📊 Resultado: {success_count}/{len(units)} unidades")
                if not args.silent:
                    print(f"\n📊 Resultado: {success_count}/{len(units)} unidades processadas com sucesso")

                sys.exit(0 if success_count == len(units) else 1)

        # Modo interativo (padrão)
        else:
            logger.info("🎮 Modo interativo")
            interactive_mode()

    except KeyboardInterrupt:
        logger.info("👋 Programa interrompido pelo usuário")
        try:
            if args is not None and not args.silent:
                print("\n\n👋 Programa interrompido pelo usuário")
        except:
            print("\n\n👋 Programa interrompido pelo usuário")
        sys.exit(0)
    except Exception as e:
        logger.error(f"❌ Erro fatal: {e}")
        try:
            if args is not None and not args.silent:
                print(f"❌ Erro fatal: {e}")
        except:
            print(f"❌ Erro fatal: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
