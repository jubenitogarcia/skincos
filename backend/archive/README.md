## Archive (backend)

Esta pasta guarda conteúdo **histórico** ou **não-executado** no runtime atual, mas que vale manter para referência.

Regras:
- Nada aqui deve ser usado como dependência/entrada principal de execução.
- Se algo voltar a ser usado, deve ser promovido para `backend/apps/`, `backend/apps/automations/`, `backend/libs/`, `backend/tools/` ou `backend/scripts/`.

Pastas:
- `github/`: `.github/` aninhados de subprojetos (não rodam no GitHub Actions do monorepo).
- `tools/`: ferramentas que não têm uso/referências ativas no projeto.
