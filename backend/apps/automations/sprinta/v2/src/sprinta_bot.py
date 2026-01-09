from __future__ import annotations
import time
import os
from pathlib import Path
import json
from typing import Iterable, List, Optional, Sequence, Tuple
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import NoSuchElementException, TimeoutException, ElementClickInterceptedException
from .models import Participante

SPRINTA_INSCRIPTION_URL = "https://app.sprinta.com.br/event/inscription/30560768ac8e7500fef"
SPRINTA_EVENT_URL = "https://app.sprinta.com.br/event/30560768ac8e7500fef"

class SprintaBot:
    def __init__(self, headless: bool = False, driver_path: Optional[str] = None, timeout: int = 20, profile_dir: Optional[str] = None, debug: bool = False):
        options = Options()
        if profile_dir:
            # Garante diretório absoluto e existente para persistir sessão/cookies
            p = Path(profile_dir).expanduser().resolve()
            p.mkdir(parents=True, exist_ok=True)
            options.add_argument(f"--user-data-dir={p}")
        if headless:
            # Observação: perfis persistentes em headless podem não reutilizar estado em algumas versões do Chrome.
            options.add_argument('--headless=new')
            options.add_argument('--disable-gpu')
            options.add_argument('--no-sandbox')
        options.add_argument('--lang=pt-BR')
        # Reduz ruído / possíveis bloqueios
        options.add_argument('--disable-blink-features=AutomationControlled')
        # Permissões auto-allow (notifications, geolocation, camera, microfone, midi, etc.)
        prefs = {
            "profile.default_content_setting_values.notifications": 1,
            "profile.default_content_setting_values.geolocation": 1,
            "profile.default_content_setting_values.media_stream_mic": 1,
            "profile.default_content_setting_values.media_stream_camera": 1,
            "profile.default_content_setting_values.midi_sysex": 1,
            "profile.default_content_setting_values.usb_guard": 1,
            "profile.default_content_setting_values.clipboard": 1,
            "profile.default_content_setting_values.popups": 1,
            "profile.default_content_setting_values.automatic_downloads": 1,
            # Bloqueia prompts desnecessários de salvamento de senhas
            "credentials_enable_service": False,
            "profile.password_manager_enabled": False,
        }
        try:
            options.add_experimental_option('prefs', prefs)
        except Exception:
            pass

        # Usa o ChromeDriver instalado
        if driver_path is None:
            # Tenta usar o ChromeDriver do diretório local do usuário
            local_driver = Path.home() / '.local' / 'bin' / 'chromedriver'
            if local_driver.exists():
                driver_path = str(local_driver)
            else:
                driver_path = '/opt/homebrew/bin/chromedriver'
        service = Service(executable_path=driver_path)
        self.driver = webdriver.Chrome(service=service, options=options)
        self.wait = WebDriverWait(self.driver, timeout)
        self._login_checked = False
        self.debug = debug or bool(os.getenv('SPRINTA_DEBUG'))

    def close(self):
        try:
            self.driver.quit()
        except Exception:
            pass

    # ================= Login / Sessão =================
    def is_logged_in(self) -> bool:
        """Heurística mais robusta:
        Considera NÃO logado se encontrar qualquer um dos elementos:
          - Botão 'Login'
          - Botão/anchora com span 'Entrar' (maiúsculas/minúsculas)
          - Texto 'Criar conta'
        Caso contrário assume logado.
        """
        markers = [
            "//button[span[normalize-space()='Login']]",
            "//button[span[translate(normalize-space(.),'ENTRAR','entrar')='entrar']]",
            "//*[self::a or self::button][span[contains(translate(.,'ENTRAR','entrar'),'entrar')]]",
            "//*[contains(translate(.,'CRIAR CONTA','criar conta'),'criar conta')]"
        ]
        for xp in markers:
            try:
                self.driver.find_element(By.XPATH, xp)
                return False
            except NoSuchElementException:
                continue
        return True

    def _wait_for_overlays_to_disappear(self, timeout: float = 3):
        """Aguarda overlays/modais desaparecerem antes de interagir com elementos."""
        try:
            # Classes comuns de overlay/modal
            overlays = [
                "_2ZnZ-TemwZ5HkhaWZGYWoG",  # Overlay do login
                "_2ruMrl4WT1OLB3YyvejMyA"   # Outro overlay observado
            ]
            for overlay_class in overlays:
                try:
                    WebDriverWait(self.driver, timeout).until_not(
                        EC.presence_of_element_located((By.CLASS_NAME, overlay_class))
                    )
                except Exception:
                    pass
            time.sleep(0.3)  # Pequena pausa adicional
        except Exception:
            pass

    def ensure_logged_in(self, email: Optional[str], senha: Optional[str], force: bool = False, quick: bool = False) -> bool:
        """
        Garante que o usuário esteja autenticado.
        - Se já checado previamente e não force, não faz nada.
        - Retorna True se logado ao final.
        """
        if self._login_checked and not force:
            return self.is_logged_in()

        if not email or not senha:
            # Credenciais não fornecidas; apenas marca como checado.
            self._login_checked = True
            if self.debug:
                print('[debug] Credenciais não fornecidas, pulando login automático.')
            return self.is_logged_in()

        # Vai para a página pública do evento (onde existe o botão Login)
        if self.debug:
            print(f'[debug] Navegando para {SPRINTA_EVENT_URL} para autenticação...')
        self.driver.get(SPRINTA_EVENT_URL)
        time.sleep(1)

        if not force and self.is_logged_in():
            self._login_checked = True
            if self.debug:
                print('[debug] Já está logado (heurística).')
            return True

        # Tenta clicar no botão Login
        try:
            # Primeiro verifica se o formulário de login já está aberto (campos username/password presentes)
            form_already = False
            try:
                self.driver.find_element(By.NAME, 'username')
                self.driver.find_element(By.NAME, 'password')
                form_already = True
                if self.debug:
                    print('[debug] Formulário de login já presente, pulando clique inicial.')
            except Exception:
                pass
            if not form_already:
                if self.debug:
                    print('[debug] Procurando botão/Login/Entrar para abrir modal...')
                open_selectors = [
                    (By.XPATH, "//button[span[normalize-space()='Login'] and not(@type='submit')]") ,
                    (By.XPATH, "//button[span[normalize-space()='Entrar'] and not(@type='submit')]") ,
                    (By.XPATH, "//button[contains(translate(normalize-space(.),'ENTRAR','entrar'),'entrar') and not(@type='submit')]")
                ]
                btn_login = None
                # Usa um wait curto individual para não travar muito tempo no primeiro seletor
                short_wait = WebDriverWait(self.driver, 4)
                for by_, sel in open_selectors:
                    try:
                        btn_login = short_wait.until(EC.element_to_be_clickable((by_, sel)))
                        break
                    except TimeoutException:
                        continue
                if btn_login:
                    try:
                        btn_login.click()
                        if self.debug:
                            print('[debug] Clicou no botão para abrir modal de login.')
                    except ElementClickInterceptedException:
                        if self.debug:
                            print('[debug] Botão interceptado, tentando scroll e JS click.')
                        self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", btn_login)
                        time.sleep(0.3)
                        try:
                            btn_login.click()
                        except ElementClickInterceptedException:
                            self.driver.execute_script("arguments[0].click();", btn_login)
        except TimeoutException:
            # Se não encontrou, talvez já esteja logado
            self._login_checked = True
            if self.debug:
                print('[debug] Botão Login não encontrado, assumindo já logado.')
            return self.is_logged_in()

        # Preenche formulário
        try:
            if self.debug:
                print('[debug] Aguardando campos de login...' + (' (quick)' if quick else ''))
            short_wait = WebDriverWait(self.driver, 3 if quick else 8)
            user_input = short_wait.until(EC.presence_of_element_located((By.NAME, "username")))
            pass_input = short_wait.until(EC.presence_of_element_located((By.NAME, "password")))
            user_input.clear(); user_input.send_keys(email)
            pass_input.clear(); pass_input.send_keys(senha)
            if self.debug:
                print('[debug] Campos preenchidos, procurando botão Login/Continuar dentro da modal...')
            # Aguarda overlays desaparecerem antes do submit
            self._wait_for_overlays_to_disappear(timeout=2)

            # Botão submit DENTRO DA MODAL - usando as classes específicas da modal
            # <button type="submit" class="_2j2ksaBy9aasTZ4lM1Dfpk _3kP19YfG6LlkC_G7R2hiWR   ">Login</button>
            submit_selectors = [
                # Classe dupla original (Login)
                (By.CSS_SELECTOR, "button[type='submit']._2j2ksaBy9aasTZ4lM1Dfpk._3kP19YfG6LlkC_G7R2hiWR"),
                # Variante com segunda classe diferente observada no snippet enviado (_1-mru2JvfgBTVOA7motdPZ)
                (By.CSS_SELECTOR, "button[type='submit']._2j2ksaBy9aasTZ4lM1Dfpk._1-mru2JvfgBTVOA7motdPZ"),
                # Texto direto Login / Entrar / Continuar
                (By.XPATH, "//button[@type='submit' and span[normalize-space()='Login']]") ,
                (By.XPATH, "//button[@type='submit' and span[normalize-space()='Entrar']]") ,
                (By.XPATH, "//button[@type='submit' and (span[normalize-space()='Login'] or span[normalize-space()='Continuar'] or span[normalize-space()='Entrar'])]") ,
                # Qualquer submit dentro da região de modal conhecida
                (By.XPATH, "//div[contains(@class, '_18VQmmzAFnEBEIpRzRbRvF')]//button[@type='submit']"),
                # Fallback amplo
                (By.XPATH, "//form//button[@type='submit' and (contains(translate(.,'LOGINENTRARCONTINUAR','loginentrarcontinuar'),'login') or contains(translate(.,'LOGINENTRARCONTINUAR','loginentrarcontinuar'),'entrar') or contains(translate(.,'LOGINENTRARCONTINUAR','loginentrarcontinuar'),'continuar'))]")
            ]

            submit_btn = None
            for by_type, selector in submit_selectors:
                try:
                    submit_btn = self.wait.until(EC.element_to_be_clickable((by_type, selector)))
                    if self.debug:
                        print(f'[debug] Encontrou botão submit via: {by_type}={selector}')
                    break
                except TimeoutException:
                    continue

            if not submit_btn:
                raise RuntimeError("Não foi possível encontrar botão de submit do login.")

            # Tenta clicar (com fallback para JS)
            try:
                submit_btn.click()
                if self.debug:
                    print('[debug] Clicou no botão de submit do login.')
            except ElementClickInterceptedException:
                if self.debug:
                    print('[debug] Submit interceptado, usando JS click.')
                self.driver.execute_script("arguments[0].click();", submit_btn)
        except TimeoutException as e:
            if self.debug:
                print(f"[debug] Timeout esperando campos de login: {e}; tentando heurística de login já existente.")
            self._login_checked = True
            return self.is_logged_in()

        # Aguarda desaparecer botão Login ou outra evidência
        try:
            if self.debug:
                print('[debug] Aguardando confirmação de login...')
            self.wait.until(lambda _ : self.is_logged_in())
            if self.debug:
                print('[debug] Login confirmado.')
        except TimeoutException:
            if quick:
                if self.debug:
                    print('[debug] Timeout confirmação login em modo quick; retornando heurística.')
                self._login_checked = True
                return self.is_logged_in()
            else:
                raise RuntimeError("Falha ao autenticar: botão de Login ainda presente / sem confirmação.")

        self._login_checked = True
        return True

    def _try_click_enroll_friend(self) -> None:
        """(LEGADO) Mantido para compatibilidade: agora tenta novos CTAs em PT-BR.
        Irá procurar pelos botões de início de inscrição atuais.
        """
        d = self.driver
        # Garante não tentar sem login: se não logado, retorna exceção clara
        if not self.is_logged_in():
            raise NoSuchElementException("Usuário não está logado - CTA de inscrição pós-login indisponível.")
        selectors = [
            # Texto exato principal
            (By.XPATH, "//button[span[normalize-space()='Criar uma nova inscrição']]") ,
            (By.XPATH, "//button[span[normalize-space()='Quero me inscrever']]") ,
            # Inglês novo fluxo
            (By.XPATH, "//button[span[normalize-space()='Enroll a friend']]") ,
            (By.XPATH, "//button[.//span[contains(translate(.,'ENROLL','enroll'),'enroll') and contains(translate(.,'FRIEND','friend'),'friend')]]"),
            # Classes específicas (podem mudar, mas ajudam)
            (By.CSS_SELECTOR, "button._3dJlFtZuyArRRqTOOtNuPQ._2zL88bZPz62Iw8cr8MKDY4"),
            (By.CSS_SELECTOR, "button._1Uw8CVVQMCmPn4amRolA1E.Jdws-PuOJzKcKO1LxdCSz"),
            # Qualquer submit com texto contendo 'inscri'
            (By.XPATH, "//button[@type='submit'][.//span[contains(translate(.,'INSCRI','inscri'),'inscri')]]"),
            # Anchor fallback
            (By.XPATH, "//a[contains(translate(.,'INSCRI','inscri'),'inscri')]")
        ]
        last_exc = None
        for by_, sel in selectors:
            try:
                elem = self.wait.until(EC.element_to_be_clickable((by_, sel)))
                # Scroll + clique robusto
                try:
                    self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", elem)
                    time.sleep(0.1)
                except Exception:
                    pass
                try:
                    elem.click()
                except ElementClickInterceptedException:
                    self.driver.execute_script("arguments[0].click();", elem)
                if self.debug:
                    print(f"[debug] CTA inicial clicado via {by_}={sel}")
                return
            except Exception as e:
                last_exc = e
                continue
        raise NoSuchElementException(f"Não foi possível localizar CTA inicial de inscrição. Último erro: {last_exc}")

    def iniciar_inscricao_amigo(self) -> bool:
        """Fluxo atualizado para iniciar inscrição (layout atual PT-BR).
        Retorna True se conseguiu iniciar (form ou URL de inscrição detectada), False caso contrário.
        """
        d = self.driver
        # Garante página do evento (não a de inscrição direta) para novo layout
        try:
            if 'event/' not in d.current_url or 'inscription' in d.current_url:
                if self.debug:
                    print(f'[debug] Navegando para {SPRINTA_EVENT_URL} para iniciar inscrição de amigo.')
                d.get(SPRINTA_EVENT_URL)
                time.sleep(0.5)
        except Exception:
            d.get(SPRINTA_EVENT_URL)
            time.sleep(0.5)

        # Garante login antes (se heurística falhar, ensure_logged_in externo deve ter sido chamado)
        if not self.is_logged_in() and self.debug:
            print('[debug] Iniciar inscrição: usuário parece não logado.')
        # Tenta novos CTAs usando mesma lógica de _try_click_enroll_friend
        try:
            self._try_click_enroll_friend()
        except Exception:
            if self.debug:
                print('[debug] Nenhum CTA de inscrição encontrado no fluxo iniciar_inscricao_amigo.')
            return False

        # Segundo clique (conforme fluxo simples fornecido pelo usuário)
        # Após o primeiro clique, alguns layouts exibem um container/div ou ícone que precisa de um segundo clique.
        time.sleep(0.8)
        # Segundo clique legado removido (layout atual não exige). Mantemos tentativa idempotente em caso de UX duplicada.
        try:
            time.sleep(0.6)
            self._try_click_enroll_friend()
            if self.debug:
                print('[debug] Clique adicional (opcional) executado.')
        except Exception:
            pass

        # Modal de telefone opcional
        try:
            if self.debug:
                print('[debug] Verificando modal de telefone...')
            input_telefone = WebDriverWait(d, 5).until(
                EC.presence_of_element_located((By.XPATH, "//input[@type='text' and @placeholder='Country code / Area code / Phone number']"))
            )
            input_telefone.clear()
            input_telefone.send_keys("000000")  # Número fictício apenas para prosseguir
            if self.debug:
                print('[debug] Preencheu modal de telefone, clicando Continue...')

            # Aguarda overlays desaparecerem
            self._wait_for_overlays_to_disappear(timeout=1)

            # Tenta diferentes seletores para o botão Continue
            continue_btn = None
            continue_selectors = [
                (By.XPATH, "//button[span[text()='Continue']]"),
                (By.XPATH, "//button[contains(., 'Continue')]"),
                (By.XPATH, "//button[@type='submit' and contains(., 'Continue')]"),
                (By.CSS_SELECTOR, "button[type='submit']"),
            ]

            for by_type, selector in continue_selectors:
                try:
                    continue_btn = WebDriverWait(d, 3).until(
                        EC.element_to_be_clickable((by_type, selector))
                    )
                    if self.debug:
                        print(f'[debug] Encontrou botão Continue via {by_type}={selector}')
                    break
                except TimeoutException:
                    continue

            if continue_btn:
                try:
                    continue_btn.click()
                    if self.debug:
                        print('[debug] Clicou em Continue.')
                except ElementClickInterceptedException:
                    if self.debug:
                        print('[debug] Continue interceptado, usando JS click.')
                    self.driver.execute_script("arguments[0].click();", continue_btn)

                # Aguarda modal desaparecer
                time.sleep(1)
                if self.debug:
                    print('[debug] Modal de telefone fechada.')
                    print(f'[debug] URL atual após fechar modal: {d.current_url}')
            else:
                if self.debug:
                    print('[debug] Botão Continue não encontrado, mas modal foi preenchida.')
        except Exception as e:
            # Se modal não apareceu ou falhou, segue mesmo assim
            if self.debug:
                print(f'[debug] Modal de telefone não apareceu ou falhou: {e}')

        # Aguarda navegação ou carregamento após fechar modal
        time.sleep(2)
        if self.debug:
            print(f'[debug] Aguardando formulário aparecer... URL atual: {d.current_url}')

        return True

    # ================= Fluxo Básico Direto (script simplificado) =================
    def fluxo_basico_enroll_amigo(self, participante: Participante) -> Optional[str]:
        """Fluxo simplificado adaptado: usa CTAs PT-BR ('Criar uma nova inscrição' / 'Quero me inscrever').
        Retorna URL de checkout se concluir, ou None se falhar em alguma etapa inicial.
        """
        d = self.driver
        try:
            # Garante página do evento
            d.get(SPRINTA_EVENT_URL)
            WebDriverWait(d, 10).until(EC.presence_of_element_located((By.TAG_NAME, 'body')))
            # Se não logado, precisa autenticar primeiro (retorna None para permitir outra rota tratar)
            if not self.is_logged_in():
                if self.debug: print('[debug][basico] Abortando: não logado antes do CTA.')
                return None

            # Primeiro CTA
            primeira_cta = [
                (By.XPATH, "//button[span[normalize-space()='Criar uma nova inscrição']]/span"),
                (By.XPATH, "//button[span[normalize-space()='Quero me inscrever']]/span"),
                (By.XPATH, "//button[span[normalize-space()='Enroll a friend']]/span"),
                (By.XPATH, "//button[.//span[contains(translate(.,'ENROLL','enroll'),'enroll') and contains(translate(.,'FRIEND','friend'),'friend')]]/span"),
                (By.XPATH, "//button[@type='submit'][.//span[contains(translate(.,'INSCRI','inscri'),'inscri')]]")
            ]
            clicked = False
            for by_, sel in primeira_cta:
                try:
                    WebDriverWait(d, 6).until(EC.element_to_be_clickable((by_, sel))).click()
                    clicked = True
                    if self.debug: print(f'[debug][basico] CTA inicial via {by_}={sel}')
                    break
                except Exception:
                    continue
            if not clicked:
                if self.debug: print('[debug][basico] Nenhum CTA inicial encontrado.')
                return None
            time.sleep(1.2)

            # Segundo clique legado desnecessário no layout atual.

            # Formulário principal
            WebDriverWait(d, 10).until(EC.presence_of_element_located((By.NAME, 'name'))).send_keys(participante.nome)
            d.find_element(By.NAME, 'email').send_keys(participante.email)
            try:
                d.find_element(By.NAME, 'phone').send_keys(participante.telefone)
            except Exception: pass
            # País / Estado / Cidade
            Select(d.find_element(By.NAME, 'country')).select_by_value('BR')
            Select(d.find_element(By.NAME, 'province')).select_by_value('RS')
            time.sleep(0.8)
            try:
                Select(d.find_element(By.NAME, 'city')).select_by_visible_text('Novo Hamburgo')
            except Exception:
                pass
            # Data / CPF / Gênero
            try: d.find_element(By.NAME, 'bday').send_keys(participante.aniversario)
            except Exception: pass
            d.find_element(By.NAME, 'cpf').send_keys(participante.cpf)
            try: Select(d.find_element(By.NAME, 'gender')).select_by_value(participante.genero)
            except Exception: pass
            # Avança etapa
            d.find_element(By.XPATH, "//button[@type='submit' and .//span[text()='Next']]").click()
            time.sleep(1)

            # Categoria (usa participante.categoria diretamente)
            cat_label = participante.categoria
            try:
                WebDriverWait(d, 6).until(EC.element_to_be_clickable((By.XPATH, f"//span[contains(translate(.,'KM','km'),'{cat_label.lower()}')]"))).click()
                d.find_element(By.XPATH, "//button[@type='submit' and .//span[text()='Next']]").click()
            except Exception:
                if self.debug: print('[debug][basico] Categoria não clicada (talvez já definida)')
            time.sleep(0.6)

            # Kit
            try:
                WebDriverWait(d, 6).until(EC.element_to_be_clickable((By.XPATH, "//span[contains(normalize-space(.),'Inscrição com Kit') or contains(normalize-space(.),'Kit')][1]"))).click()
                d.find_element(By.XPATH, "//button[@type='submit' and .//span[text()='Next']]").click()
            except Exception:
                if self.debug: print('[debug][basico] Etapa Kit não apareceu')
            time.sleep(0.6)

            # Camiseta + Equipe
            try:
                Select(d.find_element(By.NAME, 'tamanhocamiseta')).select_by_visible_text(participante.camiseta)
            except Exception:
                pass
            try:
                equipe_field = d.find_element(By.NAME, 'nomeequipe')
                equipe_field.send_keys(participante.nome_equipe or participante.time)
            except Exception:
                pass
            # Finalizar
            try:
                d.find_element(By.XPATH, "//button[@type='submit' and .//span[text()='Finish']]").click()
            except Exception:
                # fallback next final
                try:
                    d.find_element(By.XPATH, "//button[@type='submit' and .//span[text()='Next']]").click()
                except Exception:
                    pass

            # Espera checkout
            WebDriverWait(d, 15).until(EC.url_contains('checkout'))
            return d.current_url
        except Exception as e:
            if self.debug:
                print(f'[debug][basico] Falhou fluxo básico: {e}')
            return None

    # ================= Fluxo Linear Estrito (passo a passo solicitado) =================
    def executar_fluxo_linear(self, participante: Participante) -> Optional[str]:
        """Executa exatamente o fluxo solicitado pelo usuário, sem heurísticas extras.
        Passos:
        1. Ir para URL do evento
        2. Clicar Login, preencher email/senha, clicar Login
        3. Clicar primeiro "Enroll a friend"
        4. Esperar nova página, clicar segundo "Enroll a friend"
        5. Preencher formulário completo
        6. Next -> preencher/selecionar -> Next -> selecionar corrida -> Next
        7. Selecionar ingresso com kit -> Finish
        8. Retornar URL final (checkout)
        """
        d = self.driver
        try:
            # 1. Página do evento
            d.get(SPRINTA_EVENT_URL)
            WebDriverWait(d, 12).until(EC.presence_of_element_located((By.TAG_NAME, 'body')))
            time.sleep(0.8)

            # 2. Login (sempre tenta explicitamente)
            try:
                login_btn = d.find_element(By.XPATH, "//button[span[text()='Login']]")
                login_btn.click()
                WebDriverWait(d, 10).until(EC.presence_of_element_located((By.NAME, 'username'))).send_keys(os.getenv('SPRINTA_EMAIL',''))
                d.find_element(By.NAME, 'password').send_keys(os.getenv('SPRINTA_SENHA',''))
                d.find_element(By.XPATH, "//button[@type='submit' and .//span[text()='Login']]").click()
                if self.debug: print('[linear] Login submetido')
                time.sleep(2.5)
            except Exception:
                if self.debug: print('[linear] Login não executado (já logado?)')

            # 3. Primeiro CTA inscrição (somente se logado)
            if not self.is_logged_in():
                if self.debug: print('[linear] Não logado antes de clicar CTA - abortando fluxo linear.')
                return None
            ctas = [
                (By.XPATH, "//button[span[normalize-space()='Criar uma nova inscrição']]"),
                (By.XPATH, "//button[span[normalize-space()='Quero me inscrever']]"),
                (By.XPATH, "//button[@type='submit'][.//span[contains(translate(.,'INSCRI','inscri'),'inscri')]]")
            ]
            clicked_cta = False
            for by_, sel in ctas:
                try:
                    WebDriverWait(d, 6).until(EC.element_to_be_clickable((by_, sel))).click()
                    clicked_cta = True
                    if self.debug: print(f'[linear] CTA inicial via {by_}={sel}')
                    break
                except Exception:
                    continue
            if not clicked_cta:
                if self.debug: print('[linear] Nenhum CTA inicial encontrado.')
                return None
            time.sleep(1.5)

            # 4. Segundo clique legado removido (layout atual)
            time.sleep(1.2)

            # 5. Formulário de inscrição
            WebDriverWait(d, 10).until(EC.presence_of_element_located((By.NAME, 'name'))).send_keys(participante.nome)
            d.find_element(By.NAME, 'email').send_keys(participante.email)
            try: d.find_element(By.NAME, 'phone').send_keys(participante.telefone)
            except Exception: pass
            Select(d.find_element(By.NAME, 'country')).select_by_value('BR')
            Select(d.find_element(By.NAME, 'province')).select_by_value('RS')
            time.sleep(0.8)
            try: Select(d.find_element(By.NAME, 'city')).select_by_visible_text('Novo Hamburgo')
            except Exception: pass
            try: d.find_element(By.NAME, 'bday').send_keys(participante.aniversario)
            except Exception: pass
            d.find_element(By.NAME, 'cpf').send_keys(participante.cpf)
            try: Select(d.find_element(By.NAME, 'gender')).select_by_value(participante.genero)
            except Exception: pass
            d.find_element(By.XPATH, "//button[@type='submit' and .//span[text()='Next']]").click()
            time.sleep(1.2)

            # 6. Selecionar corrida (categoria)
            try:
                cat = participante.categoria.lower()
                WebDriverWait(d, 6).until(EC.element_to_be_clickable((By.XPATH, f"//span[contains(translate(.,'KM','km'),'{cat}')]") )).click()
                d.find_element(By.XPATH, "//button[@type='submit' and .//span[text()='Next']]").click()
            except Exception:
                if self.debug: print('[linear] Etapa de corrida não encontrada / ignorada')
            time.sleep(1)

            # 7. Ingresso com Kit
            try:
                WebDriverWait(d, 6).until(EC.element_to_be_clickable((By.XPATH, "//span[contains(normalize-space(.),'Inscrição com Kit') or contains(normalize-space(.),'Kit')]"))).click()
                d.find_element(By.XPATH, "//button[@type='submit' and .//span[text()='Finish']]").click()
            except Exception:
                # Tenta caminho com Next intermediário
                try:
                    d.find_element(By.XPATH, "//button[@type='submit' and .//span[text()='Next']]").click()
                except Exception: pass
            time.sleep(1.5)

            # 8. Esperar checkout
            WebDriverWait(d, 20).until(EC.url_contains('checkout'))
            return d.current_url
        except Exception as e:
            if self.debug:
                print(f'[linear] Falha fluxo linear: {e}')
            return None


    def _handle_phone_modal(self):
        """Tenta fechar a modal de telefone opcional caso apareça em qualquer fluxo."""
        d = self.driver
        try:
            input_telefone = WebDriverWait(d, 5).until(
                EC.presence_of_element_located((By.XPATH, "//input[@type='text' and @placeholder='Country code / Area code / Phone number']"))
            )
            input_telefone.clear()
            input_telefone.send_keys("000000")
            WebDriverWait(d, 2).until(
                EC.element_to_be_clickable((By.XPATH, "//button[span[text()='Continue']]"))
            ).click()
            print('[debug] Modal de telefone tratada.')
        except Exception:
            # Não apareceu (normal)
            pass

    def _fallback_navigation(self):
        # Caso a página de inscrição direta mude, tenta página do evento e encontra botão de inscrição geral
        d = self.driver
        d.get(SPRINTA_EVENT_URL)
        try:
            # Evita botão de "Register" que cria nova conta; procura especificamente por inscrição no evento
            # XPATH mais específico para evitar cair no cadastro de usuário
            btn = self.wait.until(EC.element_to_be_clickable((By.XPATH,
                "//a[contains(., 'Inscrição') or contains(., 'Sign in') or contains(., 'Inscrever-se')] | "
                "//button[contains(., 'Inscrição') or contains(., 'Sign in') and not(contains(., 'Register'))]"
            )))
            if self.debug:
                print(f'[debug] Clicando em botão de inscrição/sign in: {btn.text}')
            btn.click()
        except Exception as e:
            raise NoSuchElementException(f"Não foi possível encontrar botão inicial de inscrição na página do evento: {e}")

    def inscrever(self, participante: Participante) -> str:
        d = self.driver
        if self.debug:
            print(f'[debug] Método inscrever() iniciado para {participante.nome}')
        # Garante login antes de iniciar fluxo caso não esteja logado (não força se credenciais não fornecidas)
        if not self._login_checked:
            # Apenas checagem heurística rápida na página do evento
            try:
                self.ensure_logged_in(email=os.getenv('SPRINTA_EMAIL'), senha=os.getenv('SPRINTA_SENHA'), force=False)
            except Exception as e:
                print(f"[AVISO] Login automático falhou ou não configurado: {e}")

        # 0) Fluxo linear estrito solicitado
        try:
            if self.debug:
                print('[debug] Executando fluxo linear estrito...')
            linear_url = self.executar_fluxo_linear(participante)
            if linear_url:
                if self.debug:
                    print('[debug] Fluxo linear concluiu com sucesso.')
                return linear_url
            else:
                if self.debug:
                    print('[debug] Fluxo linear não concluiu; tentando fluxo básico.')
        except Exception as e:
            if self.debug:
                print(f'[debug] Exceção no fluxo linear: {e}. Prosseguindo.')

        # 1) Fluxo básico direto (script prescritivo) - tentativa preferencial
        try:
            if self.debug:
                print('[debug] Tentando fluxo básico direto...')
            basic_url = self.fluxo_basico_enroll_amigo(participante)
            if basic_url:
                if self.debug:
                    print('[debug] Fluxo básico concluiu com sucesso (checkout alcançado).')
                return basic_url
            else:
                if self.debug:
                    print('[debug] Fluxo básico não concluiu; seguindo para fluxo heurístico.')
        except Exception as e:
            if self.debug:
                print(f'[debug] Exceção no fluxo básico: {e}. Prosseguindo com heurísticas.')
        # Primeiro tenta o fluxo novo pós-login
        iniciou = False
        try:
            if self.debug:
                print('[debug] Tentando fluxo novo (Enroll a friend)...')
            iniciou = self.iniciar_inscricao_amigo()
        except Exception as e:
            if self.debug:
                print(f'[debug] Fluxo novo falhou: {e}')
            iniciou = False

        if not iniciou:
            if self.debug:
                print('[debug] Usando fluxo antigo (URL direta)...')
            # Fluxo anterior: usar URL direta + tentativa de localizar botão
            d.get(SPRINTA_INSCRIPTION_URL)
            time.sleep(1)
            try:
                self._try_click_enroll_friend()
            except NoSuchElementException:
                # Fallback para fluxo alternativo (página evento + achar botão)
                if self.debug:
                    print('[debug] Botão enroll não encontrado, tentando fallback navigation...')
                self._fallback_navigation()
                self._try_click_enroll_friend()
        else:
            if self.debug:
                print('[debug] Fluxo novo iniciado com sucesso.')

        # Em ambos os casos, tentar modal de telefone opcional
        self._handle_phone_modal()

        # Aguarda que ao menos um campo chave do formulário apareça antes de preencher
        try:
            self.wait.until(EC.any_of(
                EC.presence_of_element_located((By.NAME, 'name')),
                EC.presence_of_element_located((By.NAME, 'full_name')),
                EC.presence_of_element_located((By.XPATH, "//input[contains(@placeholder,'Nome') or contains(@placeholder,'name')]") )
            ))
            if self.debug:
                print('[debug] Formulário de inscrição detectado.')
        except TimeoutException:
            # Captura screenshot e page_source para debug precoce
            try:
                ts = int(time.time())
                d.save_screenshot(f"logs/timeout_form_{ts}.png")
                with open(f"logs/timeout_form_{ts}.html", "w", encoding="utf-8") as f:
                    f.write(d.page_source)
                print(f'[debug] Capturado screenshot e HTML em logs/timeout_form_{ts}.*')
            except Exception as e:
                print(f'[debug] Erro ao capturar debug: {e}')
            raise TimeoutException('Formulário de inscrição não apareceu dentro do tempo esperado.')
        try:
            # Helper interno para tentar múltiplos seletores
            def type_first(value: str, selectors: Sequence[Tuple[str, str]], required: bool = True, describe: str = "campo"):
                last_exc: Optional[Exception] = None
                for by_, sel in selectors:
                    try:
                        elem = self.wait.until(EC.presence_of_element_located((by_, sel)))
                        # Scroll até elemento antes de interagir
                        try:
                            self.driver.execute_script("arguments[0].scrollIntoView({block: 'center', behavior: 'smooth'});", elem)
                            time.sleep(0.2)
                        except Exception:
                            pass
                        if self.debug:
                            print(f"[debug] Preenchendo {describe} via {by_}={sel}")
                        try:
                            elem.clear()
                        except Exception:
                            pass
                        elem.send_keys(value)
                        return True
                    except Exception as e:
                        last_exc = e
                        continue
                if required:
                    raise last_exc or NoSuchElementException(f"Nenhum seletor funcionou para {describe}: {selectors}")
                if self.debug:
                    print(f"[debug] Campo opcional ausente: {describe}")
                return False

            # Campos básicos com múltiplos seletores possíveis
            type_first(participante.nome, [
                (By.NAME, "name"),
                (By.NAME, "full_name"),
                (By.XPATH, "//input[contains(translate(@placeholder,'NOME','nome'),'nome')]")
            ], required=True, describe='nome')
            type_first(participante.email, [
                (By.NAME, "email"),
                (By.XPATH, "//input[contains(@type,'email')]")
            ], required=True, describe='email')
            type_first(participante.telefone, [
                (By.NAME, "phone"),
                (By.NAME, "phone_number"),
                (By.XPATH, "//input[contains(@name,'fone') or contains(@id,'fone') or contains(translate(@placeholder,'FONE','fone'),'fone') or contains(translate(@placeholder,'CEL','cel'),'cel') or contains(translate(@placeholder,'PHONE','phone'),'phone')]")
            ], required=False, describe='telefone')
            type_first(participante.time, [
                (By.NAME, "team"),
                (By.XPATH, "//input[contains(@name,'team') or contains(@placeholder,'Team') or contains(@placeholder,'Equipe')]")
            ], required=False, describe='time/equipe')
            type_first(participante.aniversario, [
                (By.NAME, "bday"),
                (By.XPATH, "//input[contains(@name,'birth') or contains(@placeholder,'Nascimento') or contains(@placeholder,'Data')]")
            ], required=False, describe='aniversario')
            type_first(participante.cpf, [
                (By.NAME, "cpf"),
                (By.XPATH, "//input[contains(@name,'cpf') or @data-mask='cpf']")
            ], required=True, describe='cpf')

            # Selects fixos
            Select(self.wait.until(EC.presence_of_element_located((By.NAME, "country")))).select_by_value("BR")
            Select(self.wait.until(EC.presence_of_element_located((By.NAME, "province")))).select_by_value("RS")

            # Cidade (espera opção apareça)
            def cidade_option_loaded(_):
                try:
                    Select(d.find_element(By.NAME, "city")).select_by_visible_text("Novo Hamburgo")
                    return True
                except Exception:
                    return False
            self.wait.until(cidade_option_loaded)

            # Gênero
            try:
                Select(d.find_element(By.NAME, "gender")).select_by_value(participante.genero)
            except NoSuchElementException:
                # fallback radio
                radios = d.find_elements(By.XPATH, f"//input[@type='radio' and (@value='{participante.genero}' or contains(@id,'gender'))]")
                if radios:
                    radios[0].click()
                else:
                    raise

            try:
                self.wait.until(EC.element_to_be_clickable((By.XPATH, "//button[@type='submit' and .//span[text()='Next']]"))).click()
            except TimeoutException:
                if self.debug:
                    print('[debug] Botão Next etapa 1 não encontrado (pode ter avançado automaticamente).')

            # Categoria
            categoria_text = f"Corrida - {participante.categoria}"
            try:
                self.wait.until(EC.element_to_be_clickable((By.XPATH, f"//*[contains(normalize-space(.), '{categoria_text}')]"))).click()
                self.wait.until(EC.element_to_be_clickable((By.XPATH, "//button[@type='submit' and .//span[text()='Next']]"))).click()
            except TimeoutException:
                if self.debug:
                    print('[debug] Etapa de categoria não encontrada (talvez categoria pré-fixada).')

            # Tipo inscrição
            try:
                self.wait.until(EC.element_to_be_clickable((By.XPATH, "//*[contains(normalize-space(.), 'Inscrição com Kit') or contains(normalize-space(.), 'Kit')]"))).click()
                self.wait.until(EC.element_to_be_clickable((By.XPATH, "//button[@type='submit' and .//span[text()='Next']]"))).click()
            except TimeoutException:
                if self.debug:
                    print('[debug] Etapa tipo de inscrição não encontrada.')

            # Informações adicionais
            try:
                Select(self.wait.until(EC.presence_of_element_located((By.NAME, "6527")))).select_by_visible_text(participante.camiseta)
                type_first(participante.nome_equipe, [
                    (By.NAME, "6528"),
                    (By.XPATH, "//input[contains(@placeholder,'Equipe') or contains(@name,'team')]")
                ], required=False, describe='nome_equipe')
                self.wait.until(EC.element_to_be_clickable((By.XPATH, "//button[@type='submit' and .//span[text()='Next']]"))).click()
            except TimeoutException:
                if self.debug:
                    print('[debug] Etapa informações adicionais não encontrada.')

            # Checkout
            self.wait.until(lambda _ : d.current_url and "checkout" in d.current_url)
            return d.current_url
        except Exception as e:
            # Captura screenshot e page_source para debug
            try:
                ts = int(time.time())
                d.save_screenshot(f"logs/erro_{ts}.png")
                with open(f"logs/erro_{ts}.html", "w", encoding="utf-8") as f:
                    f.write(d.page_source)
                print(f'[debug] Erro capturado em logs/erro_{ts}.* : {e}')
            except Exception:
                pass
            raise

    def inscrever_varios(self, participantes: Iterable[Participante]) -> List[str]:
        links = []
        for p in participantes:
            try:
                link = self.inscrever(p)
                links.append(link)
            except (NoSuchElementException, TimeoutException) as e:
                print(f"Falha ao inscrever {p.nome}: {e}")
            except Exception as e:
                print(f"Erro inesperado com {p.nome}: {e}")
        return links

    # ================= Diagnóstico: Listagem de Botões Visíveis =================
    def listar_botoes_visiveis(self, ensure_login: bool = True, email: Optional[str] = None, senha: Optional[str] = None, goto_event: bool = True, save: bool = True) -> List[dict]:
        """Coleta e retorna metadados de elementos potencialmente clicáveis (botões) na página do evento.

        Estratégia:
        - (Opcional) Garante login para revelar elementos restritos.
        - Navega até a página do evento.
        - Executa JavaScript para coletar elementos candidatos:
            * button
            * a (com role=button ou com classes típicas ou conteúdo de texto)
            * [role=button]
            * elementos com atributo onclick
        - Filtra apenas os visíveis (offsetParent != null + bounding box > 0).
        - Extrai atributos relevantes e gera um xpath curto para cada.
        - Salva JSON em logs/botoes_visiveis_<timestamp>.json, se save=True.
        """
        if ensure_login and email and senha and not self._login_checked:
            try:
                self.ensure_logged_in(email, senha)
            except Exception as e:
                if self.debug:
                    print(f"[debug] Não foi possível garantir login antes da listagem: {e}")
        if goto_event:
            try:
                self.driver.get(SPRINTA_EVENT_URL)
                WebDriverWait(self.driver, 15).until(EC.presence_of_element_located((By.TAG_NAME, 'body')))
                time.sleep(1)
            except Exception as e:
                if self.debug:
                    print(f"[debug] Falha ao carregar página do evento para listagem: {e}")

        js = r"""
        function shortXPath(el){
            if (!el || el.nodeType !== 1) return '';
            const sameTagSiblings = Array.from(el.parentNode ? el.parentNode.children : []).filter(n => n.tagName === el.tagName);
            const idx = sameTagSiblings.indexOf(el) + 1;
            const tag = el.tagName.toLowerCase();
            if(!el.parentNode || el === document.body) return '/' + tag + '['+idx+']';
            return shortXPath(el.parentNode) + '/' + tag + '['+idx+']';
        }
        function isVisible(el){
            if(!el) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return !!(el.offsetParent || (style.position === 'fixed')) && rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && style.display !== 'none';
        }
        const candidates = new Set();
        document.querySelectorAll('button,a,[role=button],div[role=button],span[role=button],[onclick]').forEach(el=>candidates.add(el));
        const out = [];
        let index = 0;
        for(const el of candidates){
            if(!isVisible(el)) continue;
            const rect = el.getBoundingClientRect();
            const text = (el.innerText||'').trim().replace(/\s+/g,' ');
            if(!text && el.tagName.toLowerCase()==='a' && el.getAttribute('href')==='#') continue; // ruído
            out.push({
                index: index++,
                tag: el.tagName.toLowerCase(),
                text: text,
                html_snippet: el.outerHTML.substring(0,350),
                classes: el.className,
                id: el.id || null,
                role: el.getAttribute('role'),
                href: el.getAttribute('href'),
                onclick: el.getAttribute('onclick'),
                aria_label: el.getAttribute('aria-label'),
                data_attrs: Array.from(el.attributes).filter(a=>a.name.startsWith('data-')).map(a=>({name:a.name,value:a.value})),
                rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
                xpath: shortXPath(el)
            });
        }
        out.sort((a,b)=> a.y===b.y ? a.x - b.x : a.y - b.y);
        return out;
        """
        try:
            elementos = self.driver.execute_script(js)
        except Exception as e:
            raise RuntimeError(f"Falha ao executar JS de coleta de botões: {e}")

        if save:
            try:
                Path('logs').mkdir(exist_ok=True, parents=True)
                ts = int(time.time())
                output_path = Path('logs') / f'botoes_visiveis_{ts}.json'
                with output_path.open('w', encoding='utf-8') as f:
                    json.dump(elementos, f, ensure_ascii=False, indent=2)
                if self.debug:
                    print(f"[debug] Lista de botões salva em {output_path}")
            except Exception as e:
                if self.debug:
                    print(f"[debug] Falha ao salvar JSON de botões: {e}")

        # Impressão resumida no console para seleção visual
        print("\n=== Botões Visíveis Detectados ===")
        for item in elementos:
            texto = (item.get('text') or '')
            if len(texto) > 60:
                texto = texto[:57] + '...'
            print(f"[{item['index']:02d}] <{item['tag']}> text='{texto}' classes='{item.get('classes','')[:50]}' xpath={item.get('xpath')}")
        print("=== Fim da Lista ===\n")
        return elementos
