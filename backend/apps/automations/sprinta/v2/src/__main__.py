import argparse
import os
from pathlib import Path
from dotenv import load_dotenv
from rich import print
from .csv_loader import carregar_participantes_csv
from .models import Participante
from .sprinta_bot import SprintaBot
from .crawl_support import diagnosticar_evento
try:
    from .playwright_diagnostico import diagnostico_avancado
except Exception:
    diagnostico_avancado = None

# Carrega variáveis de ambiente do arquivo .env
load_dotenv()

EXAMPLE = {
    "nome": "João Teste",
    "email": "joao.teste@email.com",
    "telefone": "11999990000",
    "time": "Os Velozes",
    "aniversario": "01/05/1980",
    "cpf": "12345678909",
    "genero": "m",
    "categoria": "5KM",
    "camiseta": "GG",
    "nome_equipe": "Equipe Veloz IA"
}

def parse_args():
    p = argparse.ArgumentParser(description='Automação de inscrição Sprinta.')
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument('--csv', help='Arquivo CSV com lista de participantes.')
    group.add_argument('--exemplo', action='store_true', help='Executa apenas com um participante de exemplo.')
    p.add_argument('--headless', action='store_true', help='Executa sem abrir janela do browser.')
    p.add_argument('--diagnosticar', action='store_true', help='Executa diagnóstico de botões da página do evento usando Crawl4AI e sai.')
    p.add_argument('--diagnostico-avancado', action='store_true', help='Executa diagnóstico avançado Playwright (login + coleta de elementos).')
    p.add_argument('--listar-botoes', action='store_true', help='Lista botões visíveis (Selenium) na página do evento e sai.')
    p.add_argument('--email', help='E-mail de login Sprinta (ou use variável SPRINTA_EMAIL).')
    p.add_argument('--senha', help='Senha de login Sprinta (ou use variável SPRINTA_SENHA).')
    p.add_argument('--profile-dir', help='Diretório para perfil persistente do Chrome (mantém sessão). Ex: ./.chrome-profile')
    p.add_argument('--force-login', action='store_true', help='Força tentativa de login mesmo se heurística indicar já estar logado.')
    return p.parse_args()

def main():
    args = parse_args()
    if args.diagnosticar:
        print('[info] Executando diagnóstico Crawl4AI...')
        try:
            diagnosticar_evento()
        except Exception as e:
            print(f'[erro] Falha no diagnóstico: {e}')
        return
    if args.diagnostico_avancado:
        if diagnostico_avancado is None:
            print('[erro] Diagnóstico avançado indisponível (Playwright não carregado).')
            return
        print('[info] Executando diagnóstico avançado Playwright...')
        try:
            out = diagnostico_avancado(headless=False)
            print(f'[info] Arquivo gerado: {out}')
        except Exception as e:
            print(f'[erro] Falha no diagnóstico avançado: {e}')
        return
    if args.listar_botoes:
        # Inicializa bot apenas para listagem
        bot_tmp = SprintaBot(headless=args.headless, profile_dir=args.profile_dir, debug=True)
        try:
            email = args.email or os.getenv('SPRINTA_EMAIL')
            senha = args.senha or os.getenv('SPRINTA_SENHA')
            bot_tmp.listar_botoes_visiveis(ensure_login=True, email=email, senha=senha)
        finally:
            bot_tmp.close()
        return
    if args.exemplo:
        participantes = [Participante(**EXAMPLE)]
    else:
        participantes = carregar_participantes_csv(args.csv)

    bot = SprintaBot(headless=args.headless, profile_dir=args.profile_dir)
    links = []
    try:
        # Preparação de login (credenciais via CLI têm precedência sobre env)
        email = args.email or os.getenv('SPRINTA_EMAIL')
        senha = args.senha or os.getenv('SPRINTA_SENHA')
        if email and senha:
            try:
                print('[cyan]Verificando sessão / login...[/cyan]')
                bot.ensure_logged_in(email, senha, force=args.force_login)
                print('[green]Sessão autenticada.[/green]')
            except Exception as e:
                print(f"[yellow]Aviso: Não foi possível autenticar automaticamente: {e}[/yellow]")
        else:
            print('[yellow]Prosseguindo sem credenciais (tentará fluxo público).[/yellow]')
        for p in participantes:
            print(f"[cyan]Inscrevendo[/cyan] {p.nome} ...")
            link = bot.inscrever(p)
            print(f"[green]OK[/green] {p.nome} -> {link}")
            links.append((p.email, link))
    finally:
        bot.close()

    print("\n[bold]Links de checkout gerados:[/bold]")
    for email, link in links:
        print(f"{email};{link}")

if __name__ == '__main__':
    main()
