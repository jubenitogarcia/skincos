#!/usr/bin/env python3
import argparse, hashlib, json, os, subprocess, sys
from typing import List, Dict


def sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


def run(cmd: List[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


def finding(
    title: str, body_md: str, category: str, key: str, labels=None, severity="info"
) -> Dict:
    fp_source = f"{category}:{key}:{title}"
    return {
        "title": title,
        "body": body_md,
        "category": category,
        "key": key,
        "severity": severity,
        "labels": labels or [],
        "fingerprint": sha(fp_source),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out/findings.json")
    args = ap.parse_args()

    output_dir = os.path.dirname(args.out)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    findings: List[Dict] = []

    # Example: detect versioned .env files
    for root, _, files in os.walk(".", topdown=True):
        if root.startswith("./.git"):
            continue
        for f in files:
            if f == ".env":
                path = os.path.join(root, f)[2:]
                title = "Arquivo .env versionado"
                body = (
                    f"Foi encontrado um arquivo sensível versionado em `{path}`.\n"
                    "- Remover do repositório e adicionar ao `.gitignore`.\n"
                    "- Rotacionar credenciais afetadas.\n"
                    "- Purge no histórico do git.\n"
                )
                findings.append(
                    finding(
                        title=title,
                        body_md=body,
                        category="secrets",
                        key=path,
                        labels=["security", "needs-attention"],
                        severity="high",
                    )
                )

    # Example: read Ruff findings if ruff is available
    try:
        r = run(["ruff", "check", "--exit-zero", "--output-format", "json"])
        if r.returncode == 0 and r.stdout.strip():
            issues = json.loads(r.stdout)
            for issue in issues:
                path = issue.get("filename") or issue.get("filepath") or ""
                # Make path relative to current directory
                if path.startswith(os.getcwd()):
                    path = os.path.relpath(path)
                code = issue.get("code", "RUFF")
                msg = issue.get("message", "")
                row = (issue.get("location") or {}).get("row", "?")
                title = f"Ruff: {code} em {path}"
                body = f"{msg}\n\nLocal: `{path}:{row}`"
                findings.append(
                    finding(
                        title=title,
                        body_md=body,
                        category="lint",
                        key=f"{path}:{code}:{row}",
                        labels=["lint"],
                        severity="low",
                    )
                )
    except FileNotFoundError:
        pass

    # Safety cap per run
    MAX = 100
    findings = findings[:MAX]

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(findings, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    sys.exit(main())
