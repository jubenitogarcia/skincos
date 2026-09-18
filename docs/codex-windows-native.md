# Codex nativo no Windows, backend SKINCOS no Linux

O Codex e o terminal integrado rodam em Windows/PowerShell. Node, Python,
Playwright, Wrangler, PostgreSQL e testes do projeto rodam somente no
Ubuntu-24.04 por meio de `scripts/invoke-skincos-wsl.ps1`.

Não execute `npm install`, `npm ci`, builds ou crie ambientes Python no
Windows, nem copie `node_modules` ou caches entre os sistemas.

## Gateway único

Toda ação começa em PowerShell e usa operações tipadas:

```powershell
.\scripts\invoke-skincos-wsl.ps1 -NpmScript codex:context
.\scripts\invoke-skincos-wsl.ps1 -ScriptPath .\scripts\codex-context.sh
```

Diretório, argumentos e variáveis são parâmetros separados. Não monte chamadas
manuais `wsl.exe -> bash -lc`. O gateway valida distribuição, operador, raiz
do projeto, ferramentas Linux e `safe.directory` antes de executar.

Scripts que administram ACLs, atalhos e diretórios do Windows permanecem no
PowerShell. Produtos externos, inclusive o CRM independente, são operados em
seus próprios projetos e não por atalhos deste repositório.

Chamadas diretas a processos WSL só são permitidas para infraestrutura que
mantém a própria VM; cada exceção deve conter `WSL_BOUNDARY_EXCEPTION`.
