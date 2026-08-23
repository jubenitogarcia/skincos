# Codex nativo no Windows, backend SKINCOS no Linux

## Configuração suportada

- Agente Codex: Windows nativo.
- Terminal integrado: PowerShell.
- Ferramentas gerais no Windows: Git, GitHub CLI, Node LTS e Python.
- Backend do projeto: `Ubuntu-24.04`, operador `admin`.
- Modelo padrão: GPT-5.6 Sol com esforço `xhigh`; use `max` somente quando uma
  tarefa excepcional justificar o custo e a latência adicionais.

Essa separação mantém tarefas, plugins, navegador, Computer Use, MCPs e
autenticação no cliente Windows. O runtime do produto continua compatível com
Linux, CI e produção.

## Regra de dependências

Node e Python do Windows existem para utilitários do Codex. Dentro deste
repositório, não execute com eles:

- `npm install` ou `npm ci`;
- builds, testes, Playwright ou Wrangler;
- criação de `.venv` ou instalação de requirements;
- PostgreSQL, systemd ou launchers de serviços.

As árvores `node_modules`, ambientes Python e caches do SKINCOS são gerenciados
exclusivamente pelo Ubuntu. Não copie uma árvore de dependências entre Windows
e Linux.

## Gateway único

Toda ação visível começa em PowerShell. Quando precisa do backend Linux, ela
chama `scripts/invoke-skincos-wsl.ps1`.

Exemplos:

```powershell
.\scripts\invoke-skincos-wsl.ps1 -NpmScript codex:context

.\scripts\invoke-skincos-wsl.ps1 `
  -ScriptPath .\scripts\run-local-crm.sh `
  -EnvVar CRM_BUILD_BEFORE_START=auto,CRM_OPEN_BROWSER=1
```

O gateway aceita scripts, executáveis, scripts npm e Python como operações
tipadas. Diretório, argumentos e variáveis são parâmetros separados; novas
ações não devem montar `PowerShell -> wsl.exe -> bash -lc` manualmente.

Antes de executar a operação, o gateway confirma:

1. `wsl.exe`;
2. a distribuição `Ubuntu-24.04`;
3. o operador Linux `admin`;
4. o diretório do projeto;
5. as ferramentas Linux exigidas;
6. o `safe.directory` aprovado.

Qualquer falha encerra a ação antes de iniciar um serviço.

## Exceções de infraestrutura

Chamadas diretas ao processo WSL são permitidas somente para manter a
distribuição residente e para a publicação Windows de backups nativos:

- `scripts/start-wsl-runtime-keepalive.ps1`;
- `scripts/install-wsl-runtime-keepalive.ps1`;
- `scripts/test-wsl-runtime-keepalive.ps1`;
- `scripts/runtime/publish-orb-backup.ps1`.

Essas exceções não são launchers de aplicação e não autorizam novas chamadas
diretas em ações do Codex.

## Verificação após reiniciar o Codex

1. Confirme que tarefas anteriores, plugins, navegador e novas tarefas estão
   disponíveis.
2. Confirme em Configurações que o agente está em Windows nativo e o terminal
   integrado em PowerShell.
3. Em um PowerShell novo, rode `node --version`, `npm --version`,
   `python --version`, `git --version` e `gh --version`.
4. Rode pelo gateway `node --version`, `npm --version` e `python3 --version`.
5. Execute a ação CRM Local duas vezes e confirme build/gate na primeira e
   reutilização explícita na segunda.
