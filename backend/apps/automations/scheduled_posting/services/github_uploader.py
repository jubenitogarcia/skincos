import base64
import os
import time
from pathlib import Path

import requests


def _parse_repo(repo_name: str):
    if not repo_name or "/" not in repo_name:
        raise ValueError("repo_name deve ser no formato 'owner/repo'")
    owner, repo = repo_name.split("/", 1)
    if not owner or not repo:
        raise ValueError("repo_name inválido")
    return owner, repo


def upload_media_to_github_pages(
    file_path: str,
    github_token: str,
    repo_name: str,
    github_pages_url: str,
    wait_time: int = 30,
    branch: str = "gh-pages",
    target_dir: str = "scheduled-posting-media",
):
    """
    Faz upload de um arquivo para o GitHub via Contents API e retorna a URL pública (GitHub Pages).

    Observações:
    - Requer `github_token` com permissão de escrita no repo.
    - Assume que o `github_pages_url` aponta para a raiz do site do repo.
    - Para casos em que o Pages está configurado em outra branch/pasta, ajuste `branch/target_dir`.
    """
    if not github_token:
        raise ValueError("github_token ausente")
    if not github_pages_url:
        raise ValueError("github_pages_url ausente")

    owner, repo = _parse_repo(repo_name)

    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {file_path}")

    timestamp = int(time.time())
    filename = path.name
    # evita colisões simples
    remote_name = f"{timestamp}_{filename}"
    remote_path = f"{target_dir}/{remote_name}"

    api_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{remote_path}"
    headers = {
        "Authorization": f"token {github_token}",
        "Accept": "application/vnd.github+json",
    }

    content_b64 = base64.b64encode(path.read_bytes()).decode("utf-8")
    payload = {
        "message": f"chore(scheduled-posting): upload media {remote_name}",
        "content": content_b64,
        "branch": branch,
    }

    resp = requests.put(api_url, headers=headers, json=payload, timeout=60)
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Falha upload GitHub: {resp.status_code} - {resp.text}")

    # best-effort: aguarda propagação do Pages/CDN
    try:
        wait_s = int(wait_time)
    except Exception:
        wait_s = 0
    if wait_s > 0:
        time.sleep(wait_s)

    return f"{github_pages_url.rstrip('/')}/{target_dir}/{remote_name}"
