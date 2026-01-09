class GoogleDiagnostics:
    """
    Testes de conectividade com a API do Google Drive.
    """
    def __init__(self, google_creds):
        self.credentials = google_creds.credentials

    def test_connection(self):
        if not self.credentials:
            return False, "Credenciais do Google Drive ausentes."
        try:
            from libs.google import build_drive_service

            service = build_drive_service(self.credentials, cache_discovery=False)
            results = service.files().list(pageSize=1).execute()
            files = results.get('files', [])
            return True, f"Conexão OK. {len(files)} arquivo(s) encontrados."
        except ImportError:
            return False, "Bibliotecas Google não instaladas."
        except Exception as e:
            return False, f"Erro: {e}"
