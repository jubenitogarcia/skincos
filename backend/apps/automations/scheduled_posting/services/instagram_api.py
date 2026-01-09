import requests

class InstagramAPI:
    def __init__(self, instagram_creds):
        self.accounts = instagram_creds.accounts

    def publish(self, post, media_url, caption):
        # Exemplo simplificado: publica para a primeira conta
        if not self.accounts:
            print("[ERRO] Nenhuma conta do Instagram configurada.")
            return False
        acc = self.accounts[0]
        access_token = acc.get('access_token')
        account_id = acc.get('account_id')
        if not access_token or not account_id:
            print("[ERRO] Credenciais da conta ausentes.")
            return False
        # Fluxo real de publicação (container + publish) pode ser implementado aqui
        print(f"[SIMULAÇÃO] Publicando {media_url} com legenda '{caption}' na conta {acc.get('name')}")
        return True
