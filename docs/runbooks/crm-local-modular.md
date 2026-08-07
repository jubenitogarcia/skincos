# CRM local modular

## Superfícies suportadas

- `CRM – Local` inicia o CRM completo como Gestor e mantém o gate rígido de todo o shell.
- `CRM – Módulos` mostra apenas papel e módulo; variáveis técnicas continuam internas.
- O Menu Iniciar também recebe os 16 atalhos diretos em
  `Skincos Codex\CRM – Módulos\<papel> – <módulo>.lnk`, por exemplo
  `Gestor – Insumos.lnk` e `Consultor – Ponto.lnk`.
- Uma invocação explícita, útil para diagnóstico, é:

```powershell
.\scripts\run-shared-codex-shortcut.ps1 -Action CrmModule -CrmRole Gestor -CrmModule insumos
```

O Codex App também expõe a ação `CRM – Prévia Insumos Thread`. Ela usa o
mesmo launcher, materializa o snapshot atual do checkout em runtime isolado e
abre diretamente o módulo Insumos como Gestor:

```powershell
.\scripts\run-shared-codex-shortcut.ps1 -Action CrmThreadPreview -CrmRole Gestor -CrmModule insumos
```

Cada execução direta dessa prévia primeiro produz e valida um snapshot D1
somente leitura, pelo `inventory/wrangler.toml`, antes de parar uma prévia já
saudável. As tabelas de negócio são lidas juntas em um único lote remoto para
evitar um recorte inconsistente entre itens, saldo e movimentações. O payload
contém apenas o domínio de Insumos necessário para telas e métricas
(itens/lotes, saldos, ledger, transferências, contagens, compras e reposição);
ele não copia credenciais, usuários, auditoria, IPs, payloads de notificação
ou histórico de compartilhamento. Antes de qualquer escrita local, o Worker
recalcula o digest canônico, rejeita chaves fora desse contrato e exige que as
contagens restauradas coincidam com o snapshot. Uma falha de exportação ou
integridade anterior à troca preserva a prévia anterior como rollback. Se a
inicialização local falhar depois da troca, o launcher encerra qualquer processo
parcial e tenta restaurar automaticamente a versão anterior a partir da fonte
privada que estava pronta. O último manifesto saudável é mantido no runtime
privado para que essa recuperação também funcione após a entrega limpa entre
worktrees.

O exportador também reconhece a versão anterior do schema remoto: campos
aditivos ausentes recebem `null` e tabelas ainda não criadas entram vazias no
snapshot. Isso preserva a leitura real do banco sem executar migrações nem
atribuir valores que não existiam na origem.

Cada snapshot usa um diretório D1 local novo, por identificador do snapshot,
para que movimentações ou mutações de uma sessão anterior não contaminem os
dados nem as métricas da próxima. Cliques concorrentes são agrupados e os
artefatos recebem nomes únicos; após uma prévia pronta, o runtime mantém no
máximo duas gerações privadas. O manifesto `current.json` expõe somente os
metadados verificáveis do snapshot em `insumosSnapshot` (origem, instante,
digest e contagens), nunca os registros exportados.

O endereço publicado é gravado em
`C:\CodexRuntime\operator\admin\skincos\runtime\crm-local\thread-previews\gestor\insumos\current.json` somente quando `state` é `ready`; durante a
inicialização, `url` permanece `null` e não deve ser usado. A prévia começa
com a faixa preferencial `25000+`, mas reserva um bundle completo de portas
livres sob lease compartilhado e registra as portas realmente alocadas no
mesmo manifesto. Em hosts Windows sem encaminhamento de `localhost` para o
WSL, o launcher seleciona automaticamente o IPv4 privado do WSL e valida esse
host pelo Windows antes de abrir o navegador.

Para encerrar somente essa combinação:

```powershell
.\scripts\run-shared-codex-shortcut.ps1 -Action CrmThreadPreview -CrmRole Gestor -CrmModule insumos -CrmThreadPreviewStop
```

Use WSL/Ubuntu-24.04 como runtime do agente e terminal integrado. PowerShell permanece como a ponte para atalhos, navegador e estado nativo do Windows.

No Codex App, a preferência de terminal vale para novas tarefas/sessões. A ação
do topo deve escrever no terminal integrado da própria tarefa; ela não contém
deep link nem identificador de tarefa. Se uma versão do cliente Windows ainda
abrir outra tarefa, execute na tarefa atual:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ./scripts/run-shared-codex-shortcut.ps1 -Action CrmLocal
```

Esse fallback conserva exatamente o mesmo launcher e evita depender do
roteamento visual do cliente.

## Matriz canônica

O catálogo está em `crm/console/modules/localLaunchCatalog.json`; a política de papéis está em `crm/console/modules/localRolePolicy.json`.

| Papel | Módulos locais |
| --- | --- |
| Gestor | Insumos, Conversa, Atendimento, Ponto, Clientes, Caixa, Faturamento, Procedimentos, Unit Monitor, Redes Sociais, Meta Review, Meta Ads, Site EF e Escala |
| Consultor | Atendimento e Ponto |

Gestor usa a identidade local administrativa e pode acessar os 14 módulos. Consultor usa `role=CONSULTOR`, sem privilégio administrativo, e conserva somente Atendimento e o Ponto de autosserviço. O foco local não libera navegação para módulos cuja dependência não foi iniciada.

Para adicionar uma combinação, altere o catálogo/policy, preserve a chave registrada em `crm/console/modules/registry.tsx` e rode:

```powershell
wsl.exe -d Ubuntu-24.04 -- bash -lc "node --test scripts/crm-local-module-catalog.test.mjs scripts/tests/crm-local-dual-persona.test.mjs"
```

## Isolamento e atualização

Cada combinação usa um `runtimeId` determinístico e uma faixa exclusiva de portas. Prévia de thread preserva apenas uma faixa preferencial: ela seleciona dinamicamente um bundle completo que não colide com listeners existentes e o serializa por lease privado. O estado privado fica em:

```text
C:\CodexRuntime\operator\admin\skincos\runtime\crm-local\instances\<papel>\<módulo>\
  current.json
  launch.lock\owner.json
  logs\
  state\pages\
  state\insumos\
  state\insumos-snapshots\
  snapshots\
  state\timekeeping\
  state\whatsapp\
  state\wrangler-registry\
  browser\profile\
```

A fonte exata é materializada em `source\crm-local\immutable\<fingerprint>`. O catálogo publica uma impressão do contrato inteiro do launcher (PowerShell, Bash, policy, build, gate e browser); a ação falha fechada se o chamador e a fonte materializada divergirem. O cache de dependências do frontend fica no filesystem Linux e é identificado pelo lockfile; uma árvore `node_modules` legada do CRM completo é preservada no runtime privado antes da migração para esse cache. As dependências do Insumos ficam no cache de build privado e compartilhado somente pelas instâncias do mesmo snapshot: um lock serializa a instalação, a árvore é publicada por renomeação atômica e candidatos interrompidos são preservados em quarentena. O marcador do contrato `package.json` + `pnpm-lock.yaml` só é gravado depois que o Wrangler é validado. Artefatos, logs, Playwright e decisões de build continuam no runtime privado do operador.

Na repetição de uma ação:

1. o manifesto precisa ser v3, ter o mesmo módulo, papel, configuração, fonte e build;
2. PID e `startTicks` precisam representar o mesmo processo Linux;
3. auth, shell e dependências declaradas precisam responder saudáveis;
4. somente então o navegador é reaberto no perfil daquela combinação;
5. qualquer divergência encerra graciosamente apenas a combinação e reconstrói o necessário.

A prévia direta de Insumos é a exceção deliberada ao reuso: uma ação concluída
inicia um novo snapshot D1 privado. Cliques concorrentes esperam a mesma
execução em andamento para não duplicar exportações ou trocar a prévia duas
vezes.

Locks publicam um owner atômico com token. Um owner vivo nunca é removido; locks incompletos recentes são tratados como contenção e owners mortos são movidos para quarentena antes da recuperação. A parada usa as identidades registradas e não varre processos ou portas por aproximação.

## Gate e segurança local

O navegador só abre depois que o gate do módulo retorna `ok=true`. Insumos e
Ponto usam Workers e persistência locais quando declarados; o adapter do CRM
deriva de `runtimeId` um banco PostgreSQL local próprio e recusa URLs de banco
arbitrárias. Pages e Insumos compartilham apenas o registry Wrangler privado
daquela instância.

Os valores de autenticação, chaves de teste, mocks de Escala e cenários de tracking são exclusivamente locais. Não copie `.dev.vars`, sessões, perfis ou valores deste runtime para produção.
