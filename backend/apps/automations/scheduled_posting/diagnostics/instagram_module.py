from pathlib import Path
from typing import Optional
from libs.scheduler_config import backend_dir


class InstagramModuleDiagnostics:
    """
    Verifica a presença do módulo Instagram (instagrapi vendorizado + módulo Node/Python).
    """

    def __init__(self, backend_root: Optional[Path] = None):
        self.backend_root = backend_root or backend_dir()

    def test_presence(self):
        instagrapi_root = self.backend_root / "instagram" / "instagrapi"
        instagrapi_pkg = instagrapi_root / "instagrapi" / "__init__.py"
        module_root = self.backend_root / "instagram" / "module"
        module_entry = module_root / "instagram_main.py"
        node_api = module_root / "instagram_api_server.js"

        missing = []
        for p in (instagrapi_pkg, module_entry, node_api):
            if not p.exists():
                missing.append(str(p.relative_to(self.backend_root)))

        if missing:
            return False, f"Arquivos ausentes: {', '.join(missing)}"

        return True, "Módulo Instagram incorporado encontrado."
