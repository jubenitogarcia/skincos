try:
    import requests
except ImportError:  # pragma: no cover
    requests = None

class GitHubDiagnostics:
    """
    Testes de conectividade e permissões do GitHub.
    """
    def __init__(self, github_creds):
        self.token = github_creds.token
        self.repo = github_creds.repo
        self.pages_url = github_creds.pages_url
        if self.token.startswith('github_pat_'):
            self.auth_header = f"Bearer {self.token}"
        else:
            self.auth_header = f"token {self.token}"
        self.headers = {
            "Authorization": self.auth_header,
            "Accept": "application/vnd.github.v3+json"
        }

    def test_connection(self):
        """Testa acesso ao repositório e permissões básicas."""
        if requests is None:
            return False, "Dependência ausente: requests (instale via backend/requirements.txt)"
        if not self.token or not self.repo:
            return False, "Token ou repositório não configurado."
        repo_url = f"https://api.github.com/repos/{self.repo}"
        try:
            response = requests.get(repo_url, headers=self.headers)
            if response.status_code == 200:
                return True, "Conexão bem-sucedida com o repositório."
            return False, f"Erro ao acessar repositório: {response.text}"
        except Exception as e:
            return False, f"Exceção: {e}"
