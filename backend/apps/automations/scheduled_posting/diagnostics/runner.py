from .github import GitHubDiagnostics
from .instagram import InstagramDiagnostics
from .instagram_module import InstagramModuleDiagnostics
from .google import GoogleDiagnostics

class DiagnosticsRunner:
    """
    Orquestra a execução dos diagnósticos de todos os serviços.
    """
    def __init__(self, config_manager):
        self.github_diag = GitHubDiagnostics(config_manager.github)
        self.instagram_diag = InstagramDiagnostics(config_manager.instagram)
        self.instagram_module_diag = InstagramModuleDiagnostics()
        self.google_diag = GoogleDiagnostics(config_manager.google)

    def run_all(self):
        results = {}
        ok, msg = self.github_diag.test_connection()
        results['github'] = {'ok': ok, 'msg': msg}
        ok, msg = self.instagram_diag.test_connection()
        results['instagram'] = {'ok': ok, 'msg': msg}
        ok, msg = self.instagram_module_diag.test_presence()
        results['instagram_module'] = {'ok': ok, 'msg': msg}
        ok, msg = self.google_diag.test_connection()
        results['google'] = {'ok': ok, 'msg': msg}
        results['all_ok'] = all([results['github']['ok'], results['instagram']['ok'], results['instagram_module']['ok'], results['google']['ok']])
        return results
