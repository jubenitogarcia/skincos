"""Session controller (final clean) Option A.

Single authoritative version without duplicated legacy tail.
"""
import os, json, time
from pathlib import Path
from typing import Dict, Any, Callable
from dotenv import load_dotenv
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from .sprinta_bot import SprintaBot, SPRINTA_EVENT_URL

load_dotenv()

COMMANDS_DIR = Path('commands'); COMMANDS_DIR.mkdir(exist_ok=True)
STATE_FILE = COMMANDS_DIR / 'state.json'
SESSION_INFO = COMMANDS_DIR / 'session_info.json'
CMD_FILE = COMMANDS_DIR / 'cmd.json'
HEARTBEAT_INTERVAL = 5
STATE_STALE_SECONDS = 12

def write_state(status: str, detail: str = ""):
    try: STATE_FILE.write_text(json.dumps({'status':status,'detail':detail,'ts':time.time()}, ensure_ascii=False, indent=2), encoding='utf-8')
    except Exception: pass

def _is_form_present(d)->bool:
    try:
        if 'inscription' in (d.current_url or '').lower(): return True
    except Exception: pass
    try: WebDriverWait(d,2).until(EC.presence_of_element_located((By.NAME,'name'))); return True
    except Exception: return False

def _click_enroll_variants(d, wait_seconds=6)->bool:
    variants=[
        (By.XPATH,"//button[span[normalize-space()='Criar uma nova inscrição']]") ,
        (By.XPATH,"//button[span[normalize-space()='Quero me inscrever']]") ,
        (By.XPATH,"//button[span[normalize-space()='Enroll a friend']]") ,
        (By.XPATH,"//button[.//span[contains(translate(.,'ENROLL','enroll'),'enroll') and contains(translate(.,'FRIEND','friend'),'friend')]]"),
        (By.XPATH,"//button[contains(translate(.,'ENROLL','enroll'),'enroll')][.//span[contains(translate(.,'FRIEND','friend'),'friend')] or contains(translate(.,'FRIEND','friend'),'friend')]")
    ]
    for by_,sel in variants:
        try: WebDriverWait(d,wait_seconds).until(EC.element_to_be_clickable((by_,sel))).click(); return True
        except Exception: pass
    return False

def _fill_basic_fields(d, part:Dict[str,str]):
    for f in ['name','email','cpf','bday']:
        try: d.find_element(By.NAME,f).send_keys(part[f])
        except Exception: pass
    for alt in ['phone','telefone','tel']:
        try: d.find_element(By.NAME,alt).send_keys(part['phone']); break
        except Exception: continue
    try:
        g=d.find_element(By.NAME,'gender'); from selenium.webdriver.support.ui import Select; Select(g).select_by_value(part.get('gender','m'))
    except Exception: pass

def act_shutdown(bot:SprintaBot,data:Dict[str,Any]): write_state('shutting-down','Encerrando'); raise SystemExit

def act_login(bot:SprintaBot,data:Dict[str,Any]):
    email=os.getenv('SPRINTA_EMAIL'); senha=os.getenv('SPRINTA_SENHA')
    if not email or not senha: write_state('login-error','Credenciais ausentes'); return
    d=bot.driver; d.get(SPRINTA_EVENT_URL)
    if bot.is_logged_in(): write_state('login-skip','Já logado'); return
    for by_,sel in [
        (By.XPATH,"//button[span[normalize-space()='Entrar']]") ,
        (By.XPATH,"//button[span[normalize-space()='Login']]") ,
        (By.XPATH,"//button[contains(translate(.,'ENTRAR','entrar'),'entrar')]")
    ]:
        try: WebDriverWait(d,10).until(EC.element_to_be_clickable((by_,sel))).click(); break
        except Exception: pass
    try:
        u=WebDriverWait(d,10).until(EC.presence_of_element_located((By.NAME,'username')));
        p=WebDriverWait(d,10).until(EC.presence_of_element_located((By.NAME,'password')));
        u.clear(); u.send_keys(email); p.clear(); p.send_keys(senha)
    except Exception as e: write_state('login-error',f'Campos não encontrados: {e}'); return
    for by_,sel in [
        (By.XPATH,"//button[@type='submit' and span[normalize-space()='Login']]") ,
        (By.XPATH,"//button[@type='submit' and (span[normalize-space()='Login'] or span[normalize-space()='Continuar'])]") ,
        (By.CSS_SELECTOR,"button[type='submit']._2j2ksaBy9aasTZ4lM1Dfpk._3kP19YfG6LlkC_G7R2hiWR")
    ]:
        try: WebDriverWait(d,8).until(EC.element_to_be_clickable((by_,sel))).click(); break
        except Exception: pass
    time.sleep(2); write_state('login-ok' if bot.is_logged_in() else 'login-partial','Resultado login')

def act_open_login_modal(bot:SprintaBot,data:Dict[str,Any]):
    print('[action] open-login-modal')
    d=bot.driver; d.get(SPRINTA_EVENT_URL); opened=False
    selectors=[
        (By.XPATH,"//button[span[normalize-space()='Entrar'] and not(@type='submit')]") ,
        (By.XPATH,"//button[span[normalize-space()='Login'] and not(@type='submit')]") ,
        (By.XPATH,"//button[contains(translate(normalize-space(.),'ENTRAR','entrar'),'entrar') and not(@type='submit')]")
    ]
    for by_,sel in selectors:
        try:
            WebDriverWait(d,3).until(EC.element_to_be_clickable((by_,sel))).click(); opened=True; print(f'[open-login-modal] clicked {sel}'); break
        except Exception:
            continue
    if opened:
        write_state('login-modal-open','Modal')
    else:
        write_state('login-button-not-found','Nenhum botão login visível')

def act_fill_credentials(bot:SprintaBot,data:Dict[str,Any]):
    d=bot.driver; email=os.getenv('SPRINTA_EMAIL',''); senha=os.getenv('SPRINTA_SENHA','')
    try:
        u=WebDriverWait(d,5).until(EC.presence_of_element_located((By.NAME,'username'))); p=WebDriverWait(d,5).until(EC.presence_of_element_located((By.NAME,'password')))
        u.clear(); u.send_keys(email); p.clear(); p.send_keys(senha); write_state('login-credentials-filled','Credenciais preenchidas')
    except Exception as e: write_state('login-error',f'fill-credentials: {e}')

def act_submit_login(bot:SprintaBot,data:Dict[str,Any]):
    d=bot.driver; clicked=False
    for by_,sel in [
        (By.CSS_SELECTOR,"button[type='submit']._2j2ksaBy9aasTZ4lM1Dfpk._3kP19YfG6LlkC_G7R2hiWR"),
        (By.CSS_SELECTOR,"button[type='submit']._2j2ksaBy9aasTZ4lM1Dfpk._1-mru2JvfgBTVOA7motdPZ"),
        (By.XPATH,"//button[@type='submit' and span[normalize-space()='Entrar']]") ,
        (By.XPATH,"//button[@type='submit' and span[normalize-space()='Login']]") ,
        (By.XPATH,"//button[@type='submit' and (span[normalize-space()='Login'] or span[normalize-space()='Entrar'] or span[normalize-space()='Continuar'])]")
    ]:
        try: WebDriverWait(d,4).until(EC.element_to_be_clickable((by_,sel))).click(); clicked=True; break
        except Exception: pass
    time.sleep(2); write_state('login-ok' if bot.is_logged_in() else 'login-partial','Submit'+(' ok' if clicked else ' ausente'))

def act_start_enrollment(bot:SprintaBot,data:Dict[str,Any]):
    if not bot.is_logged_in(): write_state('enroll-error','Não logado'); return
    d=bot.driver; d.get(SPRINTA_EVENT_URL); time.sleep(1)
    if not _click_enroll_variants(d): write_state('enroll-error','Primeiro CTA ausente'); return
    write_state('enroll-first-clicked','Primeiro CTA'); time.sleep(2)
    if _is_form_present(d): write_state('enroll-form-ready','Form após primeiro clique'); return
    if _click_enroll_variants(d,5): write_state('enroll-form-ready' if _is_form_present(d) else 'enroll-second-clicked','Resultado segundo clique')
    else: write_state('enroll-wait-second','Segundo CTA ausente')

def act_enroll_first(bot:SprintaBot,data:Dict[str,Any]):
    ok=_click_enroll_variants(bot.driver,5); write_state('enroll-first-clicked' if ok else 'enroll-error','Primeiro CTA' if ok else 'CTA não encontrado')

def act_enroll_second(bot:SprintaBot,data:Dict[str,Any]):
    d=bot.driver
    if _click_enroll_variants(d,5): write_state('enroll-form-ready' if _is_form_present(d) else 'enroll-second-clicked','Segundo clique')
    else: write_state('enroll-wait-second','Seg CTA ausente')

def act_form_check(bot:SprintaBot,data:Dict[str,Any]): write_state('form-ready' if _is_form_present(bot.driver) else 'form-wait','form-check')

def act_enroll_sequence(bot:SprintaBot,data:Dict[str,Any]):
    email=os.getenv('SPRINTA_EMAIL'); senha=os.getenv('SPRINTA_SENHA')
    if not bot.is_logged_in():
        try: quick=bot.ensure_logged_in(email,senha,force=False,quick=True)
        except Exception: quick=False
        if not quick:
            try: bot.ensure_logged_in(email,senha,force=False,quick=False)
            except Exception as e: write_state('login-error',f'sequence login: {e}')
    d=bot.driver; d.get(SPRINTA_EVENT_URL); time.sleep(1)
    if _click_enroll_variants(d,5): write_state('enroll-first-clicked','Sequence primeiro'); time.sleep(1.2); _click_enroll_variants(d,4)
    else: write_state('enroll-error','Sequence sem primeiro CTA')
    write_state('form-ready' if _is_form_present(d) else 'form-wait','sequence form check')

def act_fill_form(bot:SprintaBot,data:Dict[str,Any]):
    d=bot.driver; pl=data.get('data') or {}
    part={'name':pl.get('name','Teste Bot'),'email':pl.get('email',os.getenv('SPRINTA_TEST_EMAIL','teste+bot@example.com')),'phone':pl.get('phone','000000'),'cpf':pl.get('cpf','00000000000'),'bday':pl.get('bday','01011990'),'gender':pl.get('gender','m')}
    _fill_basic_fields(d,part); write_state('fill-done','fill-form')

def act_list_buttons(bot:SprintaBot,data:Dict[str,Any]):
    btns=bot.listar_botoes_visiveis(ensure_login=False,goto_event=True,save=True)
    alvo=[b for b in btns if any(t in b.get('text','') for t in ['inscrever','inscri','Criar uma nova inscrição','Quero me inscrever'])]
    summary={'total':len(btns),'potenciais_cta':len(alvo),'exemplos':alvo[:5]}
    write_state('buttons-listed', json.dumps(summary, ensure_ascii=False)[:950])

def act_form_fill_basic(bot:SprintaBot,data:Dict[str,Any]):
    part={'name':'Teste Bot','email':os.getenv('SPRINTA_TEST_EMAIL','teste+bot@example.com'),'phone':'1199999999','cpf':'00000000000','bday':'01011990','gender':'m'}
    _fill_basic_fields(bot.driver,part); write_state('fill-basic-done','form-fill-basic')

def act_form_next(bot:SprintaBot,data:Dict[str,Any]):
    d=bot.driver; clicked=False
    for by_,sel in [
        (By.XPATH,"//button[span[normalize-space()='Next']]") ,
        (By.XPATH,"//button[span[normalize-space()='Prosseguir']]") ,
        (By.XPATH,"//button[span[normalize-space()='Continuar']]") ,
        (By.XPATH,"//button[span[contains(translate(.,'NEXT','next'),'next')]]")
    ]:
        try: WebDriverWait(d,3).until(EC.element_to_be_clickable((by_,sel))).click(); clicked=True; break
        except Exception: pass
    write_state('form-next-clicked' if clicked else 'form-wait','form-next')

def act_form_finish(bot:SprintaBot,data:Dict[str,Any]):
    d=bot.driver; clicked=False
    for by_,sel in [
        (By.XPATH,"//button[span[normalize-space()='Finish']]") ,
        (By.XPATH,"//button[span[normalize-space()='Concluir']]") ,
        (By.XPATH,"//button[span[normalize-space()='Finalizar']]") ,
        (By.XPATH,"//button[span[contains(translate(.,'FINISH','finish'),'finish')]]")
    ]:
        try: WebDriverWait(d,4).until(EC.element_to_be_clickable((by_,sel))).click(); clicked=True; break
        except Exception: pass
    write_state('form-finished' if clicked else 'form-wait','form-finish')

def act_diag_url(bot:SprintaBot,data:Dict[str,Any]):
    print('[action] diag-url')
    try:
        url=bot.driver.current_url
    except Exception as e:
        write_state('diag-error',f'current_url: {e}'); return
    try:
        title=bot.driver.title
    except Exception:
        title=''
    write_state('diag-url', json.dumps({'url':url,'title':title})[:500])

ACTION_MAP:Dict[str,Callable[[SprintaBot,Dict[str,Any]],None]]={
    'shutdown':act_shutdown,'login':act_login,'open-login-modal':act_open_login_modal,'fill-credentials':act_fill_credentials,
    'submit-login':act_submit_login,'start-enrollment':act_start_enrollment,'enroll-first':act_enroll_first,'enroll-second':act_enroll_second,
    'form-check':act_form_check,'enroll-sequence':act_enroll_sequence,'fill-form':act_fill_form,'list-buttons':act_list_buttons,
    'form-fill-basic':act_form_fill_basic,'form-next':act_form_next,'form-finish':act_form_finish,'diag-url':act_diag_url,
}

def main():
    print('[controller] starting')
    write_state('starting','Inicializando driver')
    profile_dir=f'.chrome-profile-step-{int(time.time())}'
    bot=SprintaBot(headless=False, profile_dir=profile_dir, debug=True)
    bot.driver.get(SPRINTA_EVENT_URL)
    print('[controller] opened event url')
    write_state('opened',f'Acessou {SPRINTA_EVENT_URL}')
    try: SESSION_INFO.write_text(json.dumps({'session_id':bot.driver.session_id,'executor_url':bot.driver.command_executor._url,'start_ts':time.time()}, indent=2), encoding='utf-8')
    except Exception: pass
    write_state('idle','Aguardando comandos.')
    print('[controller] idle loop')
    last_cmd_time=0.0; last_cmd_mtime=0.0
    while True:
        try: cur=json.loads(STATE_FILE.read_text(encoding='utf-8'))
        except Exception: cur={}
        if (time.time()-last_cmd_time)>STATE_STALE_SECONDS and cur.get('status') not in ('idle','starting','opened'): write_state('idle','Aguardando comandos.')
        if CMD_FILE.exists():
            try: mtime=CMD_FILE.stat().st_mtime
            except FileNotFoundError: mtime=0
            if mtime>last_cmd_mtime:
                last_cmd_mtime=mtime
                try: raw=CMD_FILE.read_text(encoding='utf-8'); cmd=json.loads(raw) if raw.strip() else {}
                except Exception as e: write_state('cmd-error',f'Leitura cmd.json: {e}'); last_cmd_time=time.time(); time.sleep(HEARTBEAT_INTERVAL); continue
                action=(cmd.get('action') or '').strip()
                if action and action not in ('heartbeat','idle'):
                    print(f'[controller] received action={action}')
                    write_state('cmd-received',f'action={action}')
                last_cmd_time=time.time()
                if action not in ('','idle','heartbeat',None):
                    func=ACTION_MAP.get(action)
                    if func:
                        try:
                            func(bot,cmd)
                        except SystemExit:
                            print('[controller] shutdown requested')
                            break
                        except Exception as e:
                            print(f'[controller] error executing {action}: {e}')
                            write_state('cmd-error',f'Exec {action}: {e}')
                    else: write_state('unknown-cmd',action)
                try: CMD_FILE.unlink()
                except Exception: pass
        time.sleep(HEARTBEAT_INTERVAL)
    try: bot.close()
    except Exception: pass
    write_state('stopped','Sessão encerrada')

if __name__=='__main__':
    main()
