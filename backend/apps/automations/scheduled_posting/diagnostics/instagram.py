try:
    import requests
except ImportError:  # pragma: no cover
    requests = None

class InstagramDiagnostics:
    """
    Testes de conectividade com a API do Instagram.
    """
    def __init__(self, instagram_creds):
        self.accounts = instagram_creds.accounts

    def test_connection(self):
        if requests is None:
            return False, "Dependência ausente: requests (instale via backend/requirements.txt)"
        if not self.accounts:
            return False, "Nenhuma conta do Instagram configurada."
        all_ok = True
        messages = []
        for acc in self.accounts:
            name = acc.get('name', acc.get('account_id', 'Desconhecido'))
            token = acc.get('access_token')
            acc_id = acc.get('account_id')
            if not token or not acc_id:
                messages.append(f"Conta {name}: credenciais ausentes.")
                all_ok = False
                continue
            url = f"https://graph.facebook.com/v18.0/{acc_id}"
            params = {"fields": "name,username", "access_token": token}
            try:
                resp = requests.get(url, params=params, timeout=10)
                if resp.status_code == 200:
                    messages.append(f"Conta {name}: conexão OK.")
                else:
                    messages.append(f"Conta {name}: erro {resp.status_code} - {resp.text}")
                    all_ok = False
            except Exception as e:
                messages.append(f"Conta {name}: exceção {e}")
                all_ok = False
        return all_ok, " | ".join(messages)
