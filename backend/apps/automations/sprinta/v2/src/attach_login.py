import os
import time
from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from pathlib import Path

# Este script abre OUTRA janela (não reusa session id) mas foca em realizar apenas login.
# Para atender ao pedido de clicar no botão 'Entrar' no topo, mantemos isolado.
# Se for realmente necessário reaproveitar a MESMA janela, precisaríamos interceptar a URL do executor
# e fazer attach via comando não-oficial (Selenium 4 não expõe attach direto oficialmente).

load_dotenv()

EVENT_URL = "https://app.sprinta.com.br/event/30560768ac8e7500fef"

def build_driver(headless=False, profile_dir=None):
    options = Options()
    if profile_dir:
        p = Path(profile_dir).expanduser().resolve()
        p.mkdir(parents=True, exist_ok=True)
        options.add_argument(f"--user-data-dir={p}")
    if headless:
        options.add_argument('--headless=new')
    options.add_argument('--lang=pt-BR')
    local_driver = Path.home() / '.local' / 'bin' / 'chromedriver'
    driver_path = str(local_driver) if local_driver.exists() else '/opt/homebrew/bin/chromedriver'
    return webdriver.Chrome(service=Service(driver_path), options=options)


def main():
    email = os.getenv('SPRINTA_EMAIL')
    senha = os.getenv('SPRINTA_SENHA')
    if not email or not senha:
        print('[erro] Credenciais não definidas em .env (SPRINTA_EMAIL / SPRINTA_SENHA).')
        return

    driver = build_driver(headless=False, profile_dir='.chrome-profile-step')
    driver.get(EVENT_URL)
    wait = WebDriverWait(driver, 15)

    # Seletores do botão Entrar/Login
    login_selectors = [
        (By.XPATH, "//button[span[normalize-space()='Entrar']]") ,
        (By.XPATH, "//button[span[normalize-space()='Login']]") ,
        (By.XPATH, "//button[contains(translate(.,'ENTRAR','entrar'),'entrar')]"),
    ]
    clicked = False
    for by_, sel in login_selectors:
        try:
            btn = wait.until(EC.element_to_be_clickable((by_, sel)))
            btn.click()
            print(f"[info] Clicou botão login via {by_}={sel}")
            clicked = True
            break
        except Exception:
            continue
    if not clicked:
        print('[erro] Não localizei botão Entrar/Login.')
        return

    try:
        user_input = wait.until(EC.presence_of_element_located((By.NAME, 'username')))
        pass_input = wait.until(EC.presence_of_element_located((By.NAME, 'password')))
        user_input.clear(); user_input.send_keys(email)
        pass_input.clear(); pass_input.send_keys(senha)
    except Exception as e:
        print(f"[erro] Campos de login não apareceram: {e}")
        return

    submit_variants = [
        (By.XPATH, "//button[@type='submit' and span[normalize-space()='Login']]") ,
        (By.XPATH, "//button[@type='submit' and (span[normalize-space()='Login'] or span[normalize-space()='Continuar'])]") ,
        (By.CSS_SELECTOR, "button[type='submit']._2j2ksaBy9aasTZ4lM1Dfpk._3kP19YfG6LlkC_G7R2hiWR")
    ]
    submitted = False
    for by_, sel in submit_variants:
        try:
            sb = wait.until(EC.element_to_be_clickable((by_, sel)))
            sb.click()
            print(f"[info] Submit login via {by_}={sel}")
            submitted = True
            break
        except Exception:
            continue
    if not submitted:
        print('[erro] Não consegui submeter login.')
        return

    time.sleep(3)
    print('[info] Tentativa de login concluída; mantenha janela aberta para próxima etapa.')

if __name__ == '__main__':
    main()
