"""
Automação de inscrição de atletas no Sprinta.

Este script utiliza Selenium WebDriver para automatizar o processo de inscrição
em um evento específico na plataforma Sprinta. A automação realiza login com
credenciais corporativas, navega até a página do evento, seleciona a opção
“Enroll a friend” duas vezes (como no fluxo manual) e preenche o formulário de
inscrição com os dados de cada atleta. Após preencher todas as etapas (dados
pessoais, escolha da categoria, kit, tamanho de camiseta e equipe), o script
captura e salva o link da página de pagamento (checkout) para cada atleta. Essa
URL pode ser encaminhada ao cliente para que finalize a compra manualmente.

Os dados de entrada são lidos de um arquivo CSV com colunas padrão
(`name,email,phone,cpf,bday,gender,shirt_size,team`). O resultado com
os e‑mails e respectivas URLs de checkout é salvo em ``checkout_urls.csv``.

Requisitos:
 - Python 3
 - Selenium WebDriver
 - ChromeDriver disponível no PATH

Exemplo de CSV de entrada (``participants.csv``):

```
name,email,phone,cpf,bday,gender,shirt_size,team
João da Silva,joao@example.com,51999990000,12345678909,01/01/1985,m,G,Equipe A
Maria Oliveira,maria@example.com,51999990001,98765432100,15/02/1990,f,M,Equipe B
```
"""

import csv
import time
import os
import json
import sys
import argparse
import requests
from typing import Dict, List, Optional, Any

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options


def send_wix_webhook(
    participant_data: Optional[Dict[str, Any]] = None,
    submission_id: Optional[str] = None,
    success: bool = True,
    redirect_url: Optional[str] = None,
    webhook_url: str = "",
    webhook_user: Optional[str] = None,
    webhook_password: Optional[str] = None
) -> bool:
    """Envia notificação para o webhook.

    Suporta dois formatos de chamada:
    1. Com dados completos: participant_data contém todos os dados
    2. Compatibilidade: submission_id direto (para casos sem dados completos)

    Suporta autenticação Basic Auth (opcional).

    Envia dados completos do participante quando disponível:
    - submissionId: ID da coluna B do CSV (ou nome do arquivo)
    - success: Se a inscrição foi bem sucedida
    - redirectUrl: URL final do checkout com cupom aplicado
    - nome: Primeiro nome do participante
    - sobrenome: Sobrenome do participante
    - email: Email do participante
    - telefone: Telefone do participante
    - cpf: CPF do participante
    - genero: Gênero do participante
    - corrida: Modalidade/Corrida escolhida
    - dataNascimento: Data de nascimento
    - tamanho: Tamanho da camiseta

    Args:
        participant_data: Dicionário com dados completos do participante (opcional)
        submission_id: ID da submissão (para compatibilidade, quando não há participant_data)
        success: Se a operação foi bem sucedida
        redirect_url: URL de checkout/pagamento gerada
        webhook_url: URL do webhook
        webhook_user: Usuário para Basic Auth (opcional)
        webhook_password: Senha para Basic Auth (opcional)

    Returns:
        True se o webhook foi enviado com sucesso, False caso contrário
    """
    # Se participant_data foi fornecido, usar dados completos
    if participant_data:
        # Separar nome e sobrenome
        nome_completo = participant_data.get("name", "")
        partes_nome = nome_completo.split(maxsplit=1) if nome_completo else ["", ""]
        nome = partes_nome[0] if len(partes_nome) > 0 else ""
        sobrenome = partes_nome[1] if len(partes_nome) > 1 else ""

        payload = {
            "submissionId": participant_data.get("submission_id", ""),
            "success": success,
            "redirectUrl": redirect_url or "",
            "nome": nome,
            "sobrenome": sobrenome,
            "email": participant_data.get("email", ""),
            "telefone": participant_data.get("phone", ""),
            "cpf": participant_data.get("cpf", ""),
            "genero": participant_data.get("gender", ""),
            "corrida": participant_data.get("team", ""),
            "dataNascimento": participant_data.get("bday", ""),
            "tamanho": participant_data.get("shirt_size", "")
        }
    else:
        # Formato simplificado (apenas 3 campos) para compatibilidade
        payload = {
            "submissionId": submission_id or "",
            "success": success,
            "redirectUrl": redirect_url or ""
        }

    try:
        print(f"\n📤 Enviando webhook...")
        print(f"🔗 URL: {webhook_url}")
        print(f"📦 Payload: {json.dumps(payload, indent=2, ensure_ascii=False)}")

        # Configurar autenticação Basic Auth se fornecida
        auth = None
        if webhook_user and webhook_password:
            from requests.auth import HTTPBasicAuth
            auth = HTTPBasicAuth(webhook_user, webhook_password)
            print(f"🔐 Autenticação: Basic Auth (usuário: {webhook_user})")

        response = requests.post(
            webhook_url,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Sprinta-Automation/2.0"
            },
            auth=auth,
            timeout=30
        )

        response.raise_for_status()
        print(f"✅ Webhook enviado com sucesso! Status: {response.status_code}")
        print(f"📄 Resposta: {response.text}")
        return True

    except requests.exceptions.RequestException as e:
        print(f"❌ Erro ao enviar webhook: {e}")
        return False


def extract_submission_id_from_filename(csv_file: str) -> Optional[str]:
    """Extrai o submission_id do nome do arquivo CSV.

    O Google Apps Script nomeia os arquivos como:
    inscricoes/inscricao_2025-10-05T12-59-49_idc9200e97_linha3.csv

    Esta função extrai: inscricao_2025-10-05T12-59-49_idc9200e97_linha3

    Args:
        csv_file: Caminho do arquivo CSV

    Returns:
        submission_id extraído do nome do arquivo, ou None se não for possível
    """
    try:
        # Remover caminho e extensão
        # Exemplo: inscricoes/inscricao_123.csv -> inscricao_123
        base_name = os.path.basename(csv_file)
        submission_id = os.path.splitext(base_name)[0]

        # Se começa com "inscricao_", retornar o ID completo
        if submission_id.startswith("inscricao_"):
            return submission_id

        return None
    except Exception as e:
        print(f"⚠️  Não foi possível extrair submission_id do arquivo: {e}")
        return None


def debug_sleep(debug_mode: bool, seconds: float) -> None:
    """Pausa apenas se estiver em modo debug.

    Args:
        debug_mode: Se True, faz a pausa. Se False, não faz nada.
        seconds: Tempo de pausa em segundos
    """
    if debug_mode:
        time.sleep(seconds)


def create_driver(debug_mode: bool = True, use_persistent_session: bool = True) -> webdriver.Chrome:
    """Cria e configura uma instância de Chrome WebDriver.

    Args:
        debug_mode: Se True, abre o Chrome visível com pausas para depuração.
                   Se False, roda em modo headless (mais rápido).
        use_persistent_session: Se True, usa um perfil persistente para manter a sessão logada.
    """
    chrome_options = Options()

    # Verificar se HEADLESS está definido via variável de ambiente
    headless_env = os.environ.get('HEADLESS', '').lower() == 'true'

    if not debug_mode or headless_env:
        chrome_options.add_argument("--headless=new")

    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--window-size=1920,1080")

    # Usar perfil persistente para manter sessão
    if use_persistent_session:
        # Criar diretório para o perfil do Chrome se não existir
        profile_dir = os.path.join(os.getcwd(), "chrome_profile_sprinta")
        if not os.path.exists(profile_dir):
            os.makedirs(profile_dir)
        chrome_options.add_argument(f"--user-data-dir={profile_dir}")
        if debug_mode:
            print(f"💾 Usando perfil persistente: {profile_dir}")

    # Mantém o navegador aberto após erros em modo debug
    if debug_mode:
        chrome_options.add_experimental_option("detach", False)

    return webdriver.Chrome(options=chrome_options)


def check_if_logged_in(driver: webdriver.Chrome, debug_mode: bool = True) -> bool:
    """Verifica se o usuário já está logado na plataforma Sprinta.

    Args:
        driver: Instância do WebDriver
        debug_mode: Se True, mostra logs detalhados

    Returns:
        True se já estiver logado, False caso contrário
    """
    try:
        event_url = "https://app.sprinta.com.br/event/30560768ac8e7500fef"
        driver.get(event_url)
        WebDriverWait(driver, 5).until(EC.presence_of_element_located((By.TAG_NAME, "body")))

        # Verificar se existe algum indicador de login (ex: botão de logout, menu de usuário, etc)
        # Tentar encontrar elementos que só aparecem quando logado
        logged_in_indicators = [
            # Verificar se NÃO existe botão de Login/Entrar (se não existir, está logado)
            (By.XPATH, "//*[contains(text(),'Login') or contains(text(),'Entrar') or contains(text(),'Sign in')]"),
        ]

        # Se NÃO encontrar botão de login, significa que está logado
        try:
            login_button = driver.find_element(*logged_in_indicators[0])
            # Encontrou botão de login = NÃO está logado
            if debug_mode:
                print("🔓 Usuário NÃO está logado (botão de login encontrado)")
            return False
        except Exception:
            # NÃO encontrou botão de login = está logado
            if debug_mode:
                print("✅ Usuário JÁ está logado (sessão persistente ativa)")
            return True

    except Exception as e:
        if debug_mode:
            print(f"⚠️  Erro ao verificar login: {e}")
        return False


def login(driver: webdriver.Chrome, username: str, password: str, debug_mode: bool = True) -> None:
    """Realiza login na plataforma Sprinta com as credenciais fornecidas.

    Args:
        driver: Instância do WebDriver
        username: Nome de usuário
        password: Senha
        debug_mode: Se True, adiciona pausas para visualização
    """
    login_page = "https://app.sprinta.com.br/login"
    event_url = "https://app.sprinta.com.br/event/30560768ac8e7500fef"
    try:
        driver.get(login_page)
        print("🌐 Navegou para a página de login.")
        if debug_mode:
            print("⏸️  [DEBUG] Página de login carregada. Aguardando 2s...")
            time.sleep(2)

        WebDriverWait(driver, 10).until(
            EC.visibility_of_element_located((By.NAME, "username"))
        ).send_keys(username)
        driver.find_element(By.NAME, "password").send_keys(password)

        if debug_mode:
            print("⏸️  [DEBUG] Credenciais preenchidas. Aguardando 1s antes de clicar em login...")
            time.sleep(1)

        # Procurar especificamente o botão "Login" usando múltiplas estratégias
        login_button = None
        strategies = [
            # Estratégia 1: Botão com texto "Login" exato
            (By.XPATH, "//button[@type='submit' and text()='Login']"),
            # Estratégia 2: Botão com classes específicas do Sprinta + texto Login
            (By.XPATH, "//button[@type='submit' and contains(@class, '_2j2ksaBy9aasTZ4lM1Dfpk') and text()='Login']"),
            # Estratégia 3: Botão que contenha "Login", "Entrar" ou "Acessar"
            (By.XPATH, "//button[@type='submit' and (contains(text(), 'Login') or contains(text(), 'Entrar') or contains(text(), 'Acessar'))]"),
            # Estratégia 4: Qualquer botão submit dentro de div com float="right" que contenha Login
            (By.XPATH, "//div[@float='right']//button[@type='submit' and contains(text(), 'Login')]"),
        ]

        for idx, (by, selector) in enumerate(strategies, 1):
            try:
                if debug_mode:
                    print(f"🔍 Tentando estratégia {idx}...")
                login_button = WebDriverWait(driver, 3).until(
                    EC.element_to_be_clickable((by, selector))
                )
                if debug_mode:
                    print(f"✅ Botão encontrado com estratégia {idx}: '{login_button.text}'")
                break
            except Exception:
                if debug_mode and idx < len(strategies):
                    print(f"⚠️  Estratégia {idx} falhou, tentando próxima...")
                continue

        if not login_button:
            raise Exception("Nenhuma estratégia conseguiu encontrar o botão de login")

        if debug_mode:
            print("⏸️  [DEBUG] Clicando no botão de login...")
            time.sleep(1)

        login_button.click()
        print("✅ Login via página /login realizado com sucesso.")
        WebDriverWait(driver, 20).until(EC.url_changes(login_page))
        time.sleep(3)
        return
    except Exception as e:
        print(f"⚠️  Tentativa de login via página /login falhou: {e}")
        print("🔄 Tentando login via cabeçalho no evento...")

        if debug_mode:
            print("⏸️  [DEBUG] Navegando para página do evento...")
            time.sleep(2)

        driver.get(event_url)
        WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.TAG_NAME, "body")))

        try:
            header_buttons = driver.find_elements(
                By.XPATH,
                "//*[contains(text(),'Login') or contains(text(),'Entrar') or contains(text(),'Acessar') or contains(text(),'Sign in')]",
            )
            if header_buttons:
                print(f"🔍 Encontrados {len(header_buttons)} botões de login no cabeçalho.")
                if debug_mode:
                    print("⏸️  [DEBUG] Clicando no botão de login do cabeçalho...")
                    time.sleep(1)

                header_buttons[0].click()

                if debug_mode:
                    print("⏸️  [DEBUG] Modal de login aberto. Aguardando campos de credenciais...")
                    time.sleep(2)

                WebDriverWait(driver, 20).until(
                    EC.visibility_of_element_located((By.NAME, "username"))
                ).send_keys(username)
                driver.find_element(By.NAME, "password").send_keys(password)

                if debug_mode:
                    print("⏸️  [DEBUG] Credenciais preenchidas no modal.")
                    print("🔍 Procurando botão específico de LOGIN (não Registrar)...")
                    time.sleep(2)

                # Procurar especificamente o botão de login (não o de registrar)
                login_submit_button = WebDriverWait(driver, 10).until(
                    EC.element_to_be_clickable((
                        By.XPATH,
                        "//button[@type='submit' and (contains(text(),'Login') or contains(text(),'Entrar') or contains(text(),'Acessar') or contains(text(),'Sign in') or .//span[contains(text(),'Login') or contains(text(),'Entrar') or contains(text(),'Acessar') or contains(text(),'Sign in')])]"
                    ))
                )

                if debug_mode:
                    print(f"✅ Botão de login encontrado: {login_submit_button.text}")
                    print("⏸️  [DEBUG] Clicando no botão de login em 2s...")
                    time.sleep(2)

                login_submit_button.click()
                print("✅ Login via cabeçalho realizado com sucesso.")
                WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
                time.sleep(2)
            else:
                print("⚠️  Botão de login no cabeçalho não encontrado. Supondo que já esteja autenticado.")
        except Exception as ex:
            print(f"❌ Falha no login via cabeçalho: {ex}. Continuando sem login.")
            if debug_mode:
                print("⏸️  [DEBUG] Aguardando 3s antes de continuar...")
                time.sleep(3)


def apply_discount_coupon(driver: webdriver.Chrome, coupon_code: str, debug_mode: bool = True) -> None:
    """Aplica um cupom de desconto na página de checkout.

    Args:
        driver: Instância do WebDriver
        coupon_code: Código do cupom a ser aplicado
        debug_mode: Se True, adiciona pausas para visualização
    """
    try:
        # Aguardar a página de checkout carregar completamente
        WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        time.sleep(2)  # Aguardar JavaScript e animações

        if debug_mode:
            print(f"🎟️  Procurando botão 'Adicionar cupom de desconto'...")
            time.sleep(1)

        # Clicar em "Adicionar cupom de desconto"
        # Estratégias múltiplas para encontrar o botão
        add_coupon_button = None
        add_coupon_strategies = [
            # Estratégia 1: Pelo texto do parágrafo
            (By.XPATH, "//div[@class='_3WGKFcN9yzJhzVCXTcSFcU']//p[contains(text(), 'Adicionar cupom de desconto')]"),
            # Estratégia 2: Pelo div clicável
            (By.XPATH, "//div[@class='_3WGKFcN9yzJhzVCXTcSFcU' and @style='cursor: pointer;']"),
            # Estratégia 3: Busca mais genérica
            (By.XPATH, "//p[contains(text(), 'Adicionar cupom')]//parent::div"),
            # Estratégia 4: Por texto parcial
            (By.XPATH, "//*[contains(text(), 'cupom de desconto')]//ancestor::div[@style='cursor: pointer;']"),
        ]

        for idx, (by, selector) in enumerate(add_coupon_strategies, 1):
            try:
                if debug_mode:
                    print(f"🔍 Tentando estratégia {idx} para botão de cupom...")
                add_coupon_button = WebDriverWait(driver, 5).until(
                    EC.element_to_be_clickable((by, selector))
                )
                if debug_mode:
                    print(f"✅ Botão 'Adicionar cupom' encontrado com estratégia {idx}")
                break
            except Exception:
                if debug_mode and idx < len(add_coupon_strategies):
                    print(f"⚠️  Estratégia {idx} falhou, tentando próxima...")
                continue

        if not add_coupon_button:
            raise Exception("Não foi possível encontrar o botão 'Adicionar cupom de desconto'")

        # Rolar até o botão e clicar
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", add_coupon_button)
        time.sleep(0.5)
        add_coupon_button.click()
        print("✅ Clicou em 'Adicionar cupom de desconto'")

        if debug_mode:
            print("⏸️  [DEBUG] Aguardando campo de cupom aparecer...")
            time.sleep(3)  # Aumentado para dar tempo à animação

        # Não verificar formulário específico - ir direto ao campo de input
        # (mais robusto para mudanças no HTML)

        # Encontrar o campo de entrada do cupom
        coupon_input = None
        coupon_input_strategies = [
            # Estratégia 1: Pelo placeholder
            (By.XPATH, "//input[@placeholder='Digite o código promocional']"),
            # Estratégia 2: Pelo tipo e classe
            (By.XPATH, "//input[@type='text' and contains(@class, 'MKo_xynqE1YeJKQ02iZ5d')]"),
            # Estratégia 3: Pelo parent label
            (By.XPATH, "//label/input[@type='text']"),
            # Estratégia 4: Input de texto visível recentemente adicionado
            (By.XPATH, "(//input[@type='text' and not(@disabled)])[last()]"),
        ]

        for idx, (by, selector) in enumerate(coupon_input_strategies, 1):
            try:
                if debug_mode:
                    print(f"🔍 Tentando estratégia {idx} para campo de cupom...")
                coupon_input = WebDriverWait(driver, 7).until(  # Aumentado de 5 para 7
                    EC.presence_of_element_located((by, selector))
                )
                if debug_mode:
                    print(f"✅ Campo de cupom encontrado com estratégia {idx}")
                break
            except Exception:
                if debug_mode and idx < len(coupon_input_strategies):
                    print(f"⚠️  Estratégia {idx} falhou, tentando próxima...")
                continue

        if not coupon_input:
            raise Exception("Não foi possível encontrar o campo de entrada do cupom")

        # Rolar até o campo e garantir que está visível
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", coupon_input)
        time.sleep(0.5)

        # Limpar e preencher o campo com o código do cupom
        coupon_input.clear()
        time.sleep(0.3)
        coupon_input.send_keys(coupon_code)
        print(f"✅ Código do cupom '{coupon_code}' inserido")

        if debug_mode:
            print("⏸️  [DEBUG] Procurando botão 'Aplicar Cupom'...")
            time.sleep(1)

        # Encontrar e clicar no botão "Aplicar Cupom"
        apply_button = None
        apply_button_strategies = [
            # Estratégia 1: Pelo texto exato
            (By.XPATH, "//button[@type='submit' and contains(text(), 'Aplicar Cupom')]"),
            # Estratégia 2: Pelas classes
            (By.XPATH, "//button[@type='submit' and contains(@class, '_1Uw8CVVQMCmPn4amRolA1E')]"),
            # Estratégia 3: Por parent div
            (By.XPATH, "//div[@class='_1VZMADKLSMA0zMb4rJbEnc pUGJNJmpuP_yI5R211Ds6 PMPoizMzwUHltVK0KUSXe']//button[@type='submit']"),
        ]

        for idx, (by, selector) in enumerate(apply_button_strategies, 1):
            try:
                if debug_mode:
                    print(f"🔍 Tentando estratégia {idx} para botão 'Aplicar Cupom'...")
                apply_button = WebDriverWait(driver, 5).until(
                    EC.element_to_be_clickable((by, selector))
                )
                if debug_mode:
                    print(f"✅ Botão 'Aplicar Cupom' encontrado com estratégia {idx}")
                break
            except Exception:
                if debug_mode and idx < len(apply_button_strategies):
                    print(f"⚠️  Estratégia {idx} falhou, tentando próxima...")
                continue

        if not apply_button:
            raise Exception("Não foi possível encontrar o botão 'Aplicar Cupom'")

        # Clicar no botão Aplicar Cupom
        apply_button.click()
        print(f"✅ Cupom '{coupon_code}' aplicado com sucesso!")

        if debug_mode:
            print("⏸️  [DEBUG] Aguardando confirmação de aplicação do cupom...")
            time.sleep(3)

        # Aguardar um momento para o cupom ser processado
        time.sleep(2)

    except Exception as e:
        print(f"❌ Erro ao aplicar cupom: {e}")
        if debug_mode:
            print("⏸️  [DEBUG] Erro detectado. Pausando 5s para inspeção...")
            time.sleep(5)
        raise


def apply_coupon_to_checkout_url(checkout_url: str, coupon_code: str = "ESPACOFACIALNH10",
                                  debug_mode: bool = True, headless: bool = False,
                                  submission_id: Optional[str] = None,
                                  webhook_url: Optional[str] = None) -> bool:
    """Acessa uma URL de checkout e aplica um cupom de desconto.

    Esta função cria um navegador, acessa a URL de checkout fornecida,
    e aplica automaticamente o cupom de desconto especificado.
    Após aplicar o cupom com sucesso, envia notificação para webhook do Wix.

    Args:
        checkout_url: URL completa do checkout (ex: https://checkout.sprinta.com.br/v27310473...)
        coupon_code: Código do cupom a ser aplicado (padrão: ESPACOFACIALNH10)
        debug_mode: Se True, mostra logs detalhados e pausas para visualização
        headless: Se True, executa sem interface gráfica
        submission_id: ID da submissão (coluna B do CSV) para enviar ao webhook
        webhook_url: URL do webhook do Wix para notificação

    Returns:
        True se o cupom foi aplicado com sucesso, False caso contrário

    Example:
        >>> apply_coupon_to_checkout_url(
        ...     "https://checkout.sprinta.com.br/v27310473E9D7faRFXxNkM4g",
        ...     submission_id="inscricao_001",
        ...     webhook_url="https://manage.wix.com/_api/webhook-trigger/...",
        ...     debug_mode=True
        ... )
        True
    """
    driver = None
    try:
        print("\n" + "="*70)
        print(f"🎟️  APLICAÇÃO DE CUPOM EM CHECKOUT")
        print("="*70)
        print(f"🔗 URL: {checkout_url}")
        print(f"🎫 Cupom: {coupon_code}")
        print(f"🐛 Debug: {'Ativado' if debug_mode else 'Desativado'}")
        print(f"👻 Headless: {'Sim' if headless else 'Não'}")
        print("="*70 + "\n")

        # Criar driver temporário
        chrome_options = Options()
        if headless:
            chrome_options.add_argument("--headless=new")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--window-size=1920,1080")

        driver = webdriver.Chrome(options=chrome_options)

        if debug_mode:
            print(f"🌐 Acessando URL do checkout...")

        # Acessar a URL do checkout
        driver.get(checkout_url)

        if debug_mode:
            print(f"✅ Página carregada: {driver.title}")
            print("⏸️  [DEBUG] Aguardando página estabilizar...")
            time.sleep(3)

        # Aguardar página carregar
        WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.TAG_NAME, "body")))

        # Aplicar o cupom usando a função existente
        apply_discount_coupon(driver, coupon_code=coupon_code, debug_mode=debug_mode)

        print("\n" + "="*70)
        print(f"🎉 CUPOM APLICADO COM SUCESSO!")
        print("="*70)
        print(f"✅ URL: {checkout_url}")
        print(f"✅ Cupom: {coupon_code}")
        print("="*70 + "\n")

        # Enviar webhook para Wix se tiver submission_id e webhook_url
        if submission_id and webhook_url:
            print("📤 Enviando notificação para Wix...")
            webhook_sent = send_wix_webhook(
                submission_id=submission_id,
                success=True,
                redirect_url=checkout_url,
                webhook_url=webhook_url
            )
            if webhook_sent:
                print("✅ Webhook enviado com sucesso!")
            else:
                print("⚠️  Aviso: Webhook não foi enviado, mas cupom foi aplicado.")

        if debug_mode:
            print("⏸️  [DEBUG] Mantendo navegador aberto por 10s para verificação...")
            time.sleep(10)

        return True

    except Exception as e:
        print("\n" + "="*70)
        print(f"❌ ERRO AO APLICAR CUPOM")
        print("="*70)
        print(f"URL: {checkout_url}")
        print(f"Erro: {e}")
        print("="*70 + "\n")

        if debug_mode:
            print("⏸️  [DEBUG] Mantendo navegador aberto por 10s para inspeção do erro...")
            time.sleep(10)

        return False

    finally:
        if driver:
            driver.quit()
            if debug_mode:
                print("🔒 Navegador fechado.")


def register_participant(driver: webdriver.Chrome, participant: Dict[str, str], debug_mode: bool = True) -> str:
    """Inscreve um participante no evento e retorna a URL de checkout.

    Args:
        driver: Instância do WebDriver
        participant: Dicionário com dados do participante
        debug_mode: Se True, adiciona pausas para visualização
    """
    event_url = "https://app.sprinta.com.br/event/30560768ac8e7500fef"
    driver.get(event_url)
    WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
    print(f"🌐 Acessou a página do evento para {participant['email']}.")

    if debug_mode:
        print("⏸️  [DEBUG] Procurando botão 'Enroll a friend'...")
        time.sleep(2)

    driver.execute_script("window.scrollTo(0, document.body.scrollHeight/2);")
    first_enroll = WebDriverWait(driver, 20).until(
        EC.element_to_be_clickable((By.XPATH, "//button[span[contains(text(),'Enroll a friend')]]"))
    )
    try:
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", first_enroll)
    except Exception:
        pass

    if debug_mode:
        print("⏸️  [DEBUG] Primeiro 'Enroll a friend' encontrado. Clicando...")
        time.sleep(1)

    first_enroll.click()
    print("✅ Primeiro clique em 'Enroll a friend' realizado.")
    WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.TAG_NAME, "body")))

    if debug_mode:
        print("⏸️  [DEBUG] Procurando segundo 'Enroll a friend' (pode estar em carousel)...")
        time.sleep(2)

    # O segundo "Enroll a friend" pode estar em um carousel/slider, não é um botão
    second_enroll = None
    strategies_enroll = [
        # Estratégia 1: Botão tradicional com span
        (By.XPATH, "//button[span[contains(text(),'Enroll a friend')]]"),
        # Estratégia 2: Qualquer elemento clicável dentro de slide do carousel
        (By.XPATH, "//div[contains(@class, 'slick-slide')]//span[contains(text(),'Enroll a friend')]/ancestor::div[@tabindex]"),
        # Estratégia 3: Font dentro de carousel
        (By.XPATH, "//div[contains(@class, 'slick-slide')]//font//span[contains(text(),'Enroll a friend')]"),
        # Estratégia 4: Qualquer elemento com o texto
        (By.XPATH, "//*[contains(text(),'Enroll a friend') and not(ancestor::button)]"),
    ]

    for idx, (by, selector) in enumerate(strategies_enroll, 1):
        try:
            if debug_mode:
                print(f"🔍 Tentando estratégia {idx} para segundo Enroll...")
            second_enroll = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((by, selector))
            )
            # Esperar que seja visível
            WebDriverWait(driver, 5).until(
                EC.visibility_of(second_enroll)
            )
            if debug_mode:
                print(f"✅ Elemento encontrado com estratégia {idx}")
            break
        except Exception:
            if debug_mode and idx < len(strategies_enroll):
                print(f"⚠️  Estratégia {idx} falhou, tentando próxima...")
            continue

    if not second_enroll:
        raise Exception("Não foi possível encontrar o segundo 'Enroll a friend'")

    try:
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", second_enroll)
        time.sleep(1)
    except Exception:
        pass

    if debug_mode:
        print("⏸️  [DEBUG] Clicando no segundo 'Enroll a friend'...")
        time.sleep(1)

    # Tentar clicar, se falhar, usar JavaScript
    try:
        second_enroll.click()
    except Exception as e:
        if debug_mode:
            print(f"⚠️  Clique normal falhou: {e}. Tentando com JavaScript...")
        driver.execute_script("arguments[0].click();", second_enroll)

    print("✅ Segundo clique em 'Enroll a friend' realizado.")

    try:
        if debug_mode:
            print("⏸️  [DEBUG] Preenchendo dados pessoais...")
            time.sleep(2)

        WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.NAME, "name"))).send_keys(participant["name"])
        driver.find_element(By.NAME, "email").send_keys(participant["email"])
        driver.find_element(By.NAME, "phone").send_keys(participant["phone"])
        Select(driver.find_element(By.NAME, "country")).select_by_value("BR")
        WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.XPATH, "//select[@name='province']/option[@value='RS']"))
        )
        Select(driver.find_element(By.NAME, "province")).select_by_value("RS")
        WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.XPATH, "//select[@name='city']/option[contains(text(),'Novo Hamburgo')]"))
        )
        Select(driver.find_element(By.NAME, "city")).select_by_visible_text("Novo Hamburgo")
        driver.find_element(By.NAME, "bday").send_keys(participant["bday"])

        # Formatar CPF garantindo zeros à esquerda (11 dígitos)
        cpf_formatted = participant["cpf"].zfill(11)
        if debug_mode:
            print(f"🔍 CPF original: '{participant['cpf']}' -> Formatado: '{cpf_formatted}'")
        driver.find_element(By.NAME, "cpf").send_keys(cpf_formatted)

        # Mapear gênero para o formato aceito pelo sistema
        gender_mapping = {
            'male': 'm',
            'masculino': 'm',
            'm': 'm',
            'female': 'f',
            'feminino': 'f',
            'f': 'f',
        }
        gender_value = gender_mapping.get(participant["gender"].lower(), 'm')

        if debug_mode:
            print(f"🔍 Gênero original: '{participant['gender']}' -> Mapeado para: '{gender_value}'")

        Select(driver.find_element(By.NAME, "gender")).select_by_value(gender_value)

        # Preencher o campo "team" (name="team") nesta primeira página
        try:
            team_field = driver.find_element(By.NAME, "team")
            team_value = participant.get("team", "Espaço Facial") or "Espaço Facial"
            team_field.send_keys(team_value)
            if debug_mode:
                print(f"✅ Campo 'team' preenchido com: '{team_value}'")
        except Exception as e:
            if debug_mode:
                print(f"⚠️  Campo 'team' não encontrado nesta página: {e}")

        driver.find_element(By.XPATH,
            "//button[@type='submit' and (.//span[text()='Next'] or .//span[text()='Próximo'])]"
        ).click()
        print("📝 Formulário de dados pessoais preenchido.")
        time.sleep(2)

        if debug_mode:
            print("⏸️  [DEBUG] Selecionando categoria 10KM...")
            time.sleep(2)

        # A categoria 10KM tem um botão "Select" associado
        # Encontrar o botão Select para a categoria "Corrida - 10KM"
        select_button = None
        category_strategies = [
            # Estratégia 1: Encontrar div que contém "Corrida - 10KM" e depois o botão Select
            (By.XPATH, "//span[contains(text(),'Corrida - 10KM')]/ancestor::div[contains(@class, 'no2PrYl2D1x9IfR9A6h2N')]//button[.//span[text()='Select']]"),
            # Estratégia 2: Botão com Select próximo a texto que contém 10KM
            (By.XPATH, "//span[contains(text(),'10KM')]/ancestor::div[contains(@class, 'no2PrYl2D1x9IfR9A6h2N')]//button[@type='button']"),
            # Estratégia 3: Buscar qualquer botão Select após texto com 10
            (By.XPATH, "//*[contains(text(),'Corrida - 10KM')]/following::button[.//span[text()='Select']][1]"),
            # Estratégia 4: Botão Select genérico próximo a 10KM
            (By.XPATH, "//span[contains(text(),'Corrida - 10KM')]/ancestor::div//button[contains(@class, '_3dJlFtZuyArRRqTOOtNuPQ')]"),
        ]

        for idx, (by, selector) in enumerate(category_strategies, 1):
            try:
                if debug_mode:
                    print(f"🔍 Tentando estratégia {idx} para categoria...")
                select_button = WebDriverWait(driver, 5).until(
                    EC.element_to_be_clickable((by, selector))
                )
                if debug_mode:
                    print(f"✅ Botão Select encontrado com estratégia {idx}")
                break
            except Exception:
                if debug_mode and idx < len(category_strategies):
                    print(f"⚠️  Estratégia {idx} falhou, tentando próxima...")
                continue

        if not select_button:
            if debug_mode:
                print("⚠️  Nenhuma estratégia encontrou o botão Select. Pausando 10s para inspeção...")
                time.sleep(10)
            raise Exception("Não foi possível encontrar o botão Select da categoria 10KM")

        select_button.click()
        print("✅ Categoria selecionada.")

        if debug_mode:
            print("⏸️  [DEBUG] Aguardando página de kit carregar...")
            time.sleep(3)

        if debug_mode:
            print("⏸️  [DEBUG] Selecionando kit...")
            time.sleep(2)

        # O kit também tem um botão "Select" associado, similar à categoria
        # Encontrar o botão Select para "Inscrição com Kit"
        kit_button = None
        kit_strategies = [
            # Estratégia 1: Encontrar div que contém "Inscrição com Kit" e depois o botão Select
            (By.XPATH, "//span[contains(text(),'Inscrição com Kit')]/ancestor::div[contains(@class, '_1VZMADKLSMA0zMb4rJbEnc')]//button[.//span[text()='Select']]"),
            # Estratégia 2: Botão Select próximo ao texto "Inscrição com Kit"
            (By.XPATH, "//span[contains(text(),'Inscrição com Kit')]/following::button[.//span[text()='Select']][1]"),
            # Estratégia 3: Qualquer botão com classe específica após "Inscrição com Kit"
            (By.XPATH, "//span[contains(text(),'Inscrição com Kit')]/ancestor::div//button[contains(@class, '_3dJlFtZuyArRRqTOOtNuPQ')]"),
            # Estratégia 4: Texto "With Kit" em inglês
            (By.XPATH, "//span[contains(text(),'With Kit')]/following::button[.//span[text()='Select']][1]"),
        ]

        for idx, (by, selector) in enumerate(kit_strategies, 1):
            try:
                if debug_mode:
                    print(f"🔍 Tentando estratégia {idx} para kit...")
                kit_button = WebDriverWait(driver, 5).until(
                    EC.element_to_be_clickable((by, selector))
                )
                if debug_mode:
                    print(f"✅ Botão Select do kit encontrado com estratégia {idx}")
                break
            except Exception:
                if debug_mode and idx < len(kit_strategies):
                    print(f"⚠️  Estratégia {idx} falhou, tentando próxima...")
                continue

        if not kit_button:
            if debug_mode:
                print("⚠️  Nenhuma estratégia encontrou o botão Select do kit. Pausando 10s para inspeção...")
                time.sleep(10)
            raise Exception("Não foi possível encontrar o botão Select do kit")

        kit_button.click()
        print("✅ Kit selecionado.")

        if debug_mode:
            print("⏸️  [DEBUG] Aguardando próxima página (camiseta/equipe)...")
            time.sleep(3)

        if debug_mode:
            print("⏸️  [DEBUG] Preenchendo tamanho de camiseta e nome da equipe...")
            time.sleep(2)

        # Aguardar a página carregar completamente
        WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.TAG_NAME, "body")))

        # Encontrar o campo de tamanho de camiseta pelo placeholder/option text
        # Os campos têm name dinâmico (ex: "6527"), então buscar por características do select
        shirt_field = None
        try:
            # Estratégia 1: Buscar select que contém option com "Tamanho da camiseta"
            shirt_field = WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.XPATH, "//select[option[contains(text(),'Tamanho da camiseta')]]"))
            )
            if debug_mode:
                print(f"✅ Campo de camiseta encontrado: name='{shirt_field.get_attribute('name')}'")
        except Exception:
            # Estratégia 2: Buscar select com classes específicas e opções de tamanho
            try:
                shirt_field = driver.find_element(By.XPATH, "//select[contains(@class, '_3krKLeJ-oP7fjuiuMao4-K')]//ancestor::select")
                if debug_mode:
                    print(f"✅ Campo de camiseta encontrado (estratégia 2): name='{shirt_field.get_attribute('name')}'")
            except Exception:
                pass

        if not shirt_field:
            if debug_mode:
                print("⚠️  Campo de tamanho de camiseta não encontrado.")
                print("⚠️  Pausando 10s para inspeção manual...")
                time.sleep(10)
            raise Exception("Não foi possível encontrar o campo de tamanho de camiseta")

        # Selecionar o tamanho
        shirt_size = participant.get("shirt_size", "G").strip().upper()
        Select(shirt_field).select_by_visible_text(shirt_size)
        if debug_mode:
            print(f"✅ Tamanho de camiseta '{shirt_size}' selecionado")

        # Encontrar o campo "Nome da equipe" pelo placeholder
        team_field = None
        try:
            team_field = WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.XPATH, "//input[@placeholder='Nome da equipe']"))
            )
            team_value = participant.get("team", "Espaço Facial") or "Espaço Facial"
            team_field.send_keys(team_value)
            if debug_mode:
                print(f"✅ Campo 'Nome da equipe' preenchido com: '{team_value}'")
        except Exception as e:
            if debug_mode:
                print(f"⚠️  Campo 'Nome da equipe' não encontrado ou já preenchido: {e}")

        # Clicar no botão Finish/Finalizar
        if debug_mode:
            print("⏸️  [DEBUG] Procurando botão Finish/Finalizar...")
            time.sleep(1)

        driver.find_element(By.XPATH,
            "//button[@type='submit' and (.//span[text()='Finish'] or .//span[text()='Finalizar'])]"
        ).click()
        print("✅ Informações de camiseta e equipe preenchidas. Finalizando inscrição...")

        if debug_mode:
            print("⏸️  [DEBUG] Aguardando redirecionamento para checkout...")
            time.sleep(2)

        WebDriverWait(driver, 10).until(EC.url_contains("checkout.sprinta.com.br"))

        # Aplicar cupom de desconto automaticamente
        if debug_mode:
            print("🎟️  [DEBUG] Aplicando cupom de desconto ESPACOFACIALNH10...")
            time.sleep(2)

        try:
            apply_discount_coupon(driver, coupon_code="ESPACOFACIALNH10", debug_mode=debug_mode)
        except Exception as coupon_error:
            print(f"⚠️  Não foi possível aplicar cupom: {coupon_error}")
            if debug_mode:
                print("⏸️  [DEBUG] Continuando sem cupom...")
                time.sleep(2)

        checkout_url = driver.current_url
        print(f"🎉 Checkout gerado para {participant['email']}: {checkout_url}")

        if debug_mode:
            print("⏸️  [DEBUG] Pausando 3s antes de continuar...")
            time.sleep(3)

        return checkout_url
    except Exception as error:
        print(f"❌ Erro ao inscrever {participant.get('email')}: {error}")
        if debug_mode:
            print("⏸️  [DEBUG] ERRO ENCONTRADO! Pausando 5s para inspeção...")
            time.sleep(5)
        return ""


def process_csv(input_file: str, output_file: str, debug_mode: bool = True, use_persistent_session: bool = True) -> None:
    """Processa um CSV com dados de atletas, realiza a inscrição e grava URLs.

    Args:
        input_file: Caminho do CSV de entrada
        output_file: Caminho do CSV de saída
        debug_mode: Se True, executa com pausas e logs detalhados para depuração
        use_persistent_session: Se True, usa perfil persistente do Chrome para manter login
    """
    print("\n" + "="*70)
    print("🚀 INICIANDO AUTOMAÇÃO SPRINTA")
    print("="*70)
    if debug_mode:
        print("⚙️  MODO DEBUG ATIVADO - O navegador ficará visível com pausas")
    if use_persistent_session:
        print("💾 SESSÃO PERSISTENTE ATIVADA - Login será mantido entre execuções")
    print("="*70 + "\n")

    driver = create_driver(debug_mode=debug_mode, use_persistent_session=use_persistent_session)
    try:
        # Verificar se já está logado antes de tentar fazer login
        if debug_mode:
            print("🔍 Verificando se já está logado...")

        is_logged_in = check_if_logged_in(driver, debug_mode=debug_mode)

        if not is_logged_in:
            if debug_mode:
                print("🔐 Realizando login...")

            # Obter credenciais de variáveis de ambiente ou usar padrão
            USERNAME = os.environ.get("SPRINTA_EMAIL", "novohamburgo@espacofacial.com.br")
            PASSWORD = os.environ.get("SPRINTA_PASSWORD", "*NEv6cVYfdmR3J")

            login(driver,
                  username=USERNAME,
                  password=PASSWORD,
                  debug_mode=debug_mode)
        else:
            if debug_mode:
                print("⏭️  Login não necessário - sessão já ativa!")
                time.sleep(2)

        checkout_records: List[Dict[str, str]] = []
        with open(input_file, newline='', encoding='utf-8') as csvfile:
            # Detectar o delimitador automaticamente
            sample = csvfile.read(1024)
            csvfile.seek(0)
            delimiter = ';' if ';' in sample else ','

            if debug_mode:
                print(f"📄 Delimitador detectado: '{delimiter}'")

            reader = csv.DictReader(csvfile, delimiter=delimiter)
            for idx, row in enumerate(reader, 1):
                # Detectar formato do CSV (antigo vs novo formato do Google Sheets)
                # Novo formato: DATA, ID, NOME, SOBRENOME, EMAIL, TELEFONE, CPF, GENERO, CORRIDA, DATA_NASC, TAMANHO
                # Formato antigo: name, email, phone, cpf, bday, gender, shirt_size, team

                is_new_format = 'NOME' in row or 'ID' in row

                if is_new_format:
                    # Novo formato do Google Sheets
                    nome_completo = f"{row.get('NOME', '').strip()} {row.get('SOBRENOME', '').strip()}".strip()
                    participant_name = nome_completo if nome_completo else "N/A"

                    print(f"\n{'='*70}")
                    print(f"📋 PROCESSANDO PARTICIPANTE {idx}: {participant_name}")
                    print(f"📧 ID: {row.get('ID', 'N/A')} | Email: {row.get('EMAIL', 'N/A')}")
                    print(f"{'='*70}")

                    participant = {
                        "name": nome_completo,
                        "email": row.get("EMAIL", "").strip(),
                        "phone": row.get("TELEFONE", "").strip(),
                        "cpf": row.get("CPF", "").strip(),
                        "bday": row.get("DATA_NASC", "").strip(),
                        "gender": row.get("GENERO", "").strip(),
                        "shirt_size": row.get("TAMANHO", "G").strip(),
                        "team": row.get("CORRIDA", "Espaço Facial").strip(),
                        "submission_id": row.get("ID", "").strip(),  # ID para webhook
                        "data_inscricao": row.get("DATA", "").strip(),
                    }
                else:
                    # Formato antigo (compatibilidade)
                    print(f"\n{'='*70}")
                    print(f"📋 PROCESSANDO PARTICIPANTE {idx}: {row.get('name', 'N/A')}")
                    print(f"{'='*70}")

                    participant = {
                        "name": row.get("name", "").strip(),
                        "email": row.get("email", "").strip(),
                        "phone": row.get("phone", "").strip(),
                        "cpf": row.get("cpf", "").strip(),
                        "bday": row.get("bday", "").strip(),
                        "gender": row.get("gender", "").strip(),
                        "shirt_size": row.get("shirt_size", "G").strip(),
                        "team": row.get("team", "").strip(),
                        "submission_id": None,
                        "data_inscricao": None,
                    }

                checkout_url = register_participant(driver, participant, debug_mode=debug_mode)
                checkout_records.append({
                    "email": participant["email"],
                    "checkout_url": checkout_url,
                    "submission_id": participant.get("submission_id"),
                    "name": participant["name"]
                })

                # Enviar webhook para Wix após cupom aplicado com sucesso
                # Prioridade: 1) Coluna B do CSV, 2) Nome do arquivo
                submission_id = participant.get("submission_id")
                if not submission_id:
                    submission_id = extract_submission_id_from_filename(input_file)
                    if submission_id:
                        print(f"ℹ️  submission_id extraído do nome do arquivo: {submission_id}")

                webhook_url = os.environ.get(
                    "WIX_WEBHOOK_URL",
                    "https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f"
                )

                if checkout_url and submission_id:
                    print(f"\n📤 Enviando notificação para Wix (ID: {submission_id})...")
                    # Atualizar submission_id no dicionário do participante
                    participant["submission_id"] = submission_id
                    webhook_sent = send_wix_webhook(
                        participant_data=participant,
                        success=True,
                        redirect_url=checkout_url,
                        webhook_url=webhook_url
                    )
                    if webhook_sent:
                        print("✅ Webhook enviado com sucesso!")
                    else:
                        print("⚠️  Aviso: Não foi possível enviar webhook, mas inscrição foi concluída.")
                elif not submission_id:
                    print("⚠️  Aviso: submission_id não disponível. Webhook não será enviado.")

        # Salvar CSV (para compatibilidade)
        with open(output_file, 'w', newline='', encoding='utf-8') as outfile:
            fieldnames = ["email", "checkout_url", "submission_id", "name"]
            writer = csv.DictWriter(outfile, fieldnames=fieldnames, extrasaction='ignore')
            writer.writeheader()
            for record in checkout_records:
                writer.writerow({
                    "email": record.get("email", ""),
                    "checkout_url": record.get("checkout_url", ""),
                    "submission_id": record.get("submission_id", ""),
                    "name": record.get("name", "")
                })

        # Gerar JSON estruturado para o Wix
        json_output_file = output_file.replace('.csv', '.json')
        results_json = {
            "status": "success",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "total_participants": len(checkout_records),
            "processed_successfully": sum(1 for r in checkout_records if r["checkout_url"]),
            "failed": sum(1 for r in checkout_records if not r["checkout_url"]),
            "results": [
                {
                    "email": record["email"],
                    "checkout_url": record["checkout_url"],
                    "success": bool(record["checkout_url"]),
                    "discount_applied": "ESPACOFACIALNH10" if record["checkout_url"] else None
                }
                for record in checkout_records
            ]
        }

        with open(json_output_file, 'w', encoding='utf-8') as jsonfile:
            json.dump(results_json, jsonfile, indent=2, ensure_ascii=False)

        print("\n" + "="*70)
        print(f"✅ Processamento finalizado!")
        print(f"📄 CSV salvo em: {output_file}")
        print(f"📋 JSON salvo em: {json_output_file}")
        print("="*70 + "\n")
    finally:
        if debug_mode:
            print("⏸️  [DEBUG] Mantendo navegador aberto por 10s para inspeção final...")
            time.sleep(10)
        driver.quit()
        print("🔒 Navegador fechado.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Automação de inscrições Sprinta com integração Wix"
    )
    parser.add_argument(
        "csv_file",
        nargs="?",
        default="participants.csv",
        help="Caminho do arquivo CSV com os participantes"
    )
    parser.add_argument(
        "--output",
        default="checkout_urls.csv",
        help="Caminho do arquivo de saída (padrão: checkout_urls.csv)"
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Ativa modo debug (mostra navegador)"
    )
    parser.add_argument(
        "--no-persistent",
        action="store_true",
        help="Desativa sessão persistente (faz login toda vez)"
    )
    parser.add_argument(
        "--webhook-url",
        help="URL do webhook Wix para notificação"
    )
    parser.add_argument(
        "--submission-id",
        help="ID da submissão para enviar ao webhook"
    )

    args = parser.parse_args()

    # Determinar modo debug (via argumento ou variável de ambiente)
    debug_mode = args.debug or os.environ.get('DEBUG', '').lower() == 'true'
    use_persistent = not args.no_persistent

    print(f"\n{'='*70}")
    print(f"🚀 SPRINTA AUTOMATION v2.0")
    print(f"{'='*70}")
    print(f"📄 Arquivo CSV: {args.csv_file}")
    print(f"💾 Arquivo saída: {args.output}")
    print(f"🐛 Modo debug: {'Ativado' if debug_mode else 'Desativado'}")
    print(f"🔐 Sessão persistente: {'Ativada' if use_persistent else 'Desativada'}")
    if args.webhook_url:
        print(f"🔔 Webhook Wix: Configurado")
    print(f"{'='*70}\n")

    try:
        # Processar CSV
        process_csv(
            args.csv_file,
            args.output,
            debug_mode=debug_mode,
            use_persistent_session=use_persistent
        )

        # Enviar webhook se configurado
        if args.webhook_url and args.submission_id:
            # Ler o resultado do JSON gerado
            json_output_file = args.output.replace('.csv', '.json')
            if os.path.exists(json_output_file):
                with open(json_output_file, 'r', encoding='utf-8') as f:
                    results = json.load(f)

                # Pegar a primeira URL de checkout (ou None se falhou)
                redirect_url = None
                if results.get('results') and len(results['results']) > 0:
                    redirect_url = results['results'][0].get('checkout_url')

                success = bool(redirect_url)

                # Enviar webhook
                send_wix_webhook(
                    submission_id=args.submission_id,
                    success=success,
                    redirect_url=redirect_url,
                    webhook_url=args.webhook_url
                )
            else:
                print(f"⚠️  Arquivo JSON não encontrado: {json_output_file}")
                # Enviar webhook de falha
                send_wix_webhook(
                    submission_id=args.submission_id,
                    success=False,
                    redirect_url=None,
                    webhook_url=args.webhook_url
                )

        print("\n✅ Processamento finalizado com sucesso!")
        sys.exit(0)

    except Exception as e:
        print(f"\n❌ Erro durante processamento: {e}")

        # Enviar webhook de falha se configurado
        if args.webhook_url and args.submission_id:
            send_wix_webhook(
                submission_id=args.submission_id,
                success=False,
                redirect_url=None,
                webhook_url=args.webhook_url
            )

        sys.exit(1)
