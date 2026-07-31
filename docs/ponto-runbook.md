# Runbook — Controle de Ponto

## Arquitetura operacional

O navegador usa `https://crm.skincos.com.br/api/ponto/*`. A Pages Function autentica a sessão, assina claims mínimos e encaminha apenas headers autorizados para `https://api.skincos.com.br/api/ponto/*`. O gateway `api` monta o Worker `workforce/timekeeping` por Service Binding `TIMEKEEPING`. O domínio usa D1 próprio e consome a Escala pelo binding `SCHEDULE`.

O backend legado `crm/api/server/pontoRoutes.js` não participa desse caminho. `ponto_store.v2.json` é somente entrada de migração/rollback controlado.

O terminal físico usa `https://crm.skincos.com.br/ponto-terminal.html`, autentica somente com um token de dispositivo revogável e registra por matrícula + PIN. A unidade, o dispositivo e o instante são definidos pelo servidor; não há seleção de unidade, reconhecimento facial ou horário do navegador. O procedimento de ativação e as políticas de rede/trabalho externo ficam em [ponto-terminal-presenca.md](ponto-terminal-presenca.md).

## Saúde e 404

```bash
curl -i https://crm.skincos.com.br/api/ponto/health
curl -i https://crm.skincos.com.br/api/ponto/readiness
curl -i https://api.skincos.com.br/api/ponto/health
```

`health` é público e informa serviço/versão sem secrets. `readiness` consulta D1 e retorna 503 JSON quando indisponível. Ambos precisam ter `content-type: application/json` e `x-request-id`.

Para 404: validar nesta ordem Pages proxy, `PONTO_API_TARGET`, gateway publicado, binding `TIMEKEEPING`, Worker publicado e migrations. HTML, redirect de frontend ou 200 sem JSON é falha operacional.

## Permissões

| Papel | Acesso |
| --- | --- |
| Funcionário | próprio contexto, histórico, batida e solicitação de correção |
| Dispositivo | batida na unidade gravada no cadastro do dispositivo |
| Gestor | leitura das unidades autorizadas, correção e dispositivos; não aprova a própria correção |
| RH | leitura, identidade canônica, aprovação/recusa, fechamento e reabertura |
| Administrador | RH + dispositivos e auditoria |
| Auditor | leitura, exportação e auditoria; sem mutações |

O frontend apenas oculta/desabilita ações; o Worker sempre revalida papel, unidade, funcionário e dispositivo.

Mutações same-origin exigem o token CSRF da sessão. A Pages Function envia um envelope HMAC v2 que vincula ator, instante, método, caminho com query string, nonce e SHA-256 do corpo; o Worker rejeita versão antiga, assinatura reaproveitada e nonce repetido. O proxy encaminha somente uma allowlist de headers e limita o corpo a 1 MiB.

## Secrets e variáveis

- `PONTO_ACTOR_HMAC_KEY`: assinatura CRM → Timekeeping;
- `PONTO_IDEMPOTENCY_KEY`: fingerprint de retries;
- `PONTO_TEMPLATES_KEY`: A256GCM dos templates biométricos;
- `PONTO_PROFILE_DATA_KEY`: A256GCM de documentos, filiação, telefone e endereço do perfil canônico;
- `PONTO_ROOT_ATTESTATION_KEY_SHARED`: mesma versão da chave de comparação,
  provisionada como secret somente nos environments GitHub `staging` e
  `production`; cria compromissos HMAC, nunca existe no escopo do repositório e
  nunca é implantada no runtime;
- `PONTO_ROOT_ATTESTATION_KEY_ID`: referência opaca, somente como variable do
  repositório, à versão custodiada da chave de auditoria;
- `PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY`: chave privada Ed25519 distinta
  por target e secret somente do respectivo environment; apenas o coordenador
  aprovado a hidrata para emitir capabilities;
- `PONTO_ORCHESTRATOR_CAPABILITY_PUBLIC_KEYS_JSON`: mapa não secreto,
  target-bound, dos verificadores públicos e key IDs de `staging` e
  `production`, mantido como variable do repositório; consumers e watchdog
  nunca recebem a chave privada;
- `PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY`: secret independente e somente no
  environment selecionado, usado apenas para a intenção one-shot de rollback
  de Pages; nunca reutiliza chave do orquestrador;
- `PONTO_PROFILE_DATA_KEY_CUSTODY_REF` e
  `PONTO_IDEMPOTENCY_KEY_CUSTODY_REF`: referências opacas distintas do cofre,
  configuradas como variables próprias de cada environment;
- `ESCALA_ACTOR_HMAC_KEY`: autenticação Timekeeping → Escala;
- `TIMEKEEPING_BACKUP_PASSPHRASE`: cifra o checkpoint D1 criado pelo workflow antes de migrations remotas;
- `PONTO_FACE_PUNCH_ENABLED`: mantém identificação facial desabilitada por padrão; só use `true` após aprovação operacional explícita. A interface também bloqueia temporariamente novas capturas faciais; as marcações usam PIN;
- `PONTO_NETWORK_CONTEXT_KEY`: assinatura do IP público observado pela Pages Function para o Worker. Configure o mesmo secret nos dois serviços somente quando for usar política de rede `OBSERVE` ou `REQUIRE`;
- `PONTO_FACE_THRESHOLD`, `PONTO_PIN_ITERATIONS`, `PONTO_COOLDOWN_SECONDS`: ajustes operacionais no servidor;
- `PONTO_TIMEKEEPING_D1_STAGING_ID` e
  `PONTO_TIMEKEEPING_D1_PRODUCTION_ID`: IDs D1 exclusivos de Ponto, como
  variables dos respectivos GitHub environments, nunca secrets;
- `PONTO_MODULE_CONTROL_STAGING_KV_ID` e
  `PONTO_MODULE_CONTROL_PRODUCTION_KV_ID`: namespaces KV exclusivos de
  module-control/latch por target;
- `PONTO_CLOUDFLARE_PAGES_PROJECT_STAGING` e
  `PONTO_CLOUDFLARE_PAGES_PROJECT`: projetos Pages exatos de Ponto;
- `ENABLE_PONTO_CRM_PAGES_DEPLOY_STAGING`,
  `ENABLE_PONTO_CRM_PAGES_DEPLOY`,
  `ENABLE_PONTO_CORE_WORKERS_DEPLOY` e
  `ENABLE_PONTO_TIMEKEEPING_PRODUCTION_DEPLOY`: flags fail-closed que precisam
  ser explicitamente `true` somente no estágio autorizado;
- `CRM_PAGES_PROJECT_STAGING` e `CRM_PAGES_PROJECT`: projetos do CRM Pages
  geral. Não são fallback para o publisher Ponto;
- `PONTO_EMERGENCY_CLOSE_BROKER_CREDENTIAL` (secret),
  `PONTO_EMERGENCY_CLOSE_BROKER_URL`,
  `PONTO_EMERGENCY_CLOSE_CUSTODY_REF` e
  `PONTO_EMERGENCY_CLOSE_MODE=external-close-only-broker-v1` (variables):
  contrato mínimo e independente dos environments
  `ponto-emergency-staging` / `ponto-emergency-production`. O broker permite
  somente `latch-true` e `maintenance`, nega abertura/delete/arbitrary KV e não
  retorna credenciais ou PII. Não armazene ali token Cloudflare/KV direto,
  account/KV ID ou credencial ampla; as custody refs dos dois targets devem ser
  diferentes.

Os nomes Ponto-only acima pertencem ao pacote integrado em #943/#945. Os
brokers live são `skincos-ponto-emergency-staging` e
`skincos-ponto-emergency-production`, cada um com D1 dedicado e secrets
`BROKER_CREDENTIAL`/`RESPONSE_PRIVATE_KEY_PEM`; a política fixa URL, custody
ref, response key ID e SPKI público. O exercício staging `910001/910002`
foi atestado e deixou o latch monotônico fechado e o controle em maintenance.
Os nomes
gerais/legados usados na contenção externa atual
continuam apenas como fences; não os trate como configuração do candidato nem
os restaure antes do merge revisado e da autorização de release. Seleção de
target não possui default: qualquer nome ausente, target fora de
`staging|production` ou mistura entre os dois targets falha antes de hidratar
credenciais ou mutar.

O deploy e o sincronizador periódico falham fechados quando qualquer segredo
obrigatório falta. Em particular, `PONTO_PROFILE_DATA_KEY` deve existir nos
environments GitHub `staging` e `production` antes da promoção: não use um
fallback para `PONTO_ACTOR_HMAC_KEY`, não copie o valor de staging e não gere
uma chave ad hoc em CI.

Nunca registrar PIN, token de dispositivo, cookie, template, vetor, foto, score ou chave. A UI nunca recebe template/score.

## Composição local

O launcher local usa deliberadamente o caminho reduzido
`Pages → Timekeeping`; ele não é prova do gateway Core nem da composição
remota. Esse modo direto de desenvolvimento é aceito somente pelo guard local:
loopback, `LOCAL_AUTH_BYPASS=true`, `SKINCOS_DEPLOYMENT_ENV=local`, SHA Git
completo e `PONTO_ALLOW_LOCAL_DIRECT_TIMEKEEPING=true`. Nenhuma dessas
condições existe em staging ou produção.

O launcher não contém nem gera chaves. Antes de iniciar Ponto local, provisione
valores sintéticos independentes pelo processo privado do operador nos caminhos
padrão abaixo, ou informe caminhos privados alternativos por
`CRM_TIMEKEEPING_ENV_FILE` e `PONTO_PAGES_ENV_FILE`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\initialize-local-crm-private-bindings.ps1
```

O inicializador é idempotente: não exibe nem rotaciona valores existentes,
acrescenta somente bindings ausentes de um contrato legado íntegro e falha se
encontrar um conjunto parcial.

- `C:\CodexRuntime\operator\admin\skincos\runtime\crm-local\ponto-private\timekeeping.worker.env`
  contém exatamente `PONTO_ACTOR_HMAC_KEY`, `PONTO_IDEMPOTENCY_KEY`,
  `PONTO_TEMPLATES_KEY`, `PONTO_PROFILE_DATA_KEY`,
  `PONTO_NETWORK_CONTEXT_KEY` e `IDENTITY_WORKFORCE_HMAC_KEY`;
- `C:\CodexRuntime\operator\admin\skincos\runtime\crm-local\ponto-private\ponto.pages.env`
  contém `PONTO_ACTOR_HMAC_KEY`, `PONTO_NETWORK_CONTEXT_KEY` e
  `PONTO_RELEASE_PROBE_HMAC_KEY`, derivada localmente da chave de idempotência;
- `C:\CodexRuntime\operator\admin\skincos\runtime\crm-local\ponto-private\inventory.identity.env`
  contém `IDENTITY_WORKFORCE_HMAC_KEY`, `INSUMOS_SEED_TOKEN` e
  `SESSION_SECRET`.

Actor e network precisam coincidir entre os dois arquivos; todos os bindings
do Worker devem ser distintos; a chave de identidade precisa coincidir entre
Worker e Inventory. Arquivo ausente, dentro da árvore compartilhada, com
placeholder, binding extra ou valor divergente interrompe o launcher antes de
iniciar serviços. Os valores são carregados por `--env-file`, não aparecem na
linha de comando e nunca devem ser copiados para `.dev.vars`. Em filesystem
POSIX, o validador exige owner igual ao operador, arquivo `0600` e diretório
`0700`. Em caminho Windows/DrvFS ele exige proprietário e DACL explícita
restritos à conta atual, pois bits POSIX não atestam essa fronteira.

Para cada início, o launcher usa o SHA completo do snapshot selecionado como
`APP_VERSION`, configura `ENVIRONMENT=local`, grava explicitamente
`module-control:timekeeping=active` somente no KV local persistido no runtime
privado e exige readiness com a mesma afinidade de SHA/ambiente. Isso não altera
o controle KV nem qualquer secret remoto.

## Fechamento mensal

1. Sincronizar Escala e resolver conflitos de identidade.
2. Carregar espelho, inconsistências e solicitações de correção.
3. Aprovar/recusar correções por usuário diferente do solicitante.
4. Informar justificativa e fechar o período.
5. Confirmar snapshot, checksum e auditoria.

Fechamento bloqueia novas batidas/correções no intervalo. Reabertura exige RH/Admin, justificativa e auditoria. Mudanças de regra posteriores não alteram snapshots fechados.

A trava `timekeeping_period_guards` é adquirida por data antes do cálculo e impede que uma batida concorra com o fechamento. O bloqueio de PIN é global por funcionário, inclusive quando as tentativas alternam entre dispositivos.

## Deploy e rollback

> Estado em 2026-07-30: os controles de replay, overlay de emergência,
> mutex/watchdog e os nomes Ponto-only descritos nesta seção existem apenas no
> worktree local. Não há commit, PR, SHA candidato, hosted checks, merge,
> provisioning ou prova live. Staging e produção continuam
> `module-control:timekeeping=maintenance`; staging foi fechado pela execução
> canônica `30527767707`, que é somente evidência fail-close, e os fences
> externos registrados no checkpoint privado devem permanecer.

Use somente `.github/workflows/ponto-progressive-release.yml` para a composição
de release. O coordenador não publica por conta própria: ele despacha e atesta
os publishers canônicos de Timekeeping, Identity/Inventory, Core API e CRM
Pages. Cada execução exige um SHA completo alcançável a partir de `main`; de
forma mais restritiva, esse SHA precisa ser exatamente o `GITHUB_SHA` do
coordenador executado em `refs/heads/main` e o checkout atual. De staging em
diante, exige também o run bem-sucedido do predecessor para o mesmo SHA. Se
`main` avançar entre estágios, não continue com o ancestral: reinicie em
`preview` usando o novo SHA.

Toda mutation direta de Worker, Pages, secret de Pages, D1, KV ou
module-control na cadeia Ponto usa o mutex global
`ponto-surface-mutation`. Isso inclui publishers canônicos, os três writers
agendados de secrets Pages, o drill de rollback, reset do latch e a escrita de
manutenção do watchdog. Não crie outro grupo para o mesmo alvo físico e não
despache publisher auxiliar/aposentado. O latch monotônico de emergência é a
única escrita remota autorizada antes de obter esse mutex.

O primeiro release governado depende do baseline privado de Ponto Core
publicado pela PR #919/run `30512105626` a partir do source revisado
`0f3480dce1a170ac0f862fa392a95456af292a88`. O catálogo fixa artifact
ID/digest, deployment e version independentes de staging e produção. Antes da
primeira mutação de staging e antes de capturar o baseline do pilot, o
coordenador baixa exatamente esses artefatos, valida run/path/head/repository e
reateasta ao vivo peso 100%, mensagem/APP_VERSION, binding de Timekeeping,
route-only, ausência de routes/domains, `workers.dev=false` e preview URLs
desabilitadas. Drift bloqueia a operação; não recapture o candidato como
incumbente nem substitua esse predecessor sem decisão revisada.

`preview` executa testes e dry-runs sem deploy, migration, KV, secret ou dado.
`staging` põe Ponto em manutenção antes da primeira mutação, captura checkpoints
cifrados, aplica migrations aditivas e publica **o mesmo SHA** nas quatro
superfícies. Somente depois grava o controle `active` schema v2 vinculado ao
SHA e executa `.github/workflows/timekeeping-staging-journey.yml` com os quatro
artefatos e o URL imutável `*.skincos-staging.pages.dev`. A jornada cria apenas
um CONSULTOR sintético efêmero com os módulos `atendimento` e `ponto`, verifica
navegação, vínculo, PIN inválido, batida/idempotência, escopo de unidade,
correção própria e negação administrativa; remove somente os registros
sintéticos daquele run e preserva a auditoria.

`pilot` mantém Timekeeping e Identity/Inventory fora da distribuição geral e
seleciona Core, Timekeeping e Identity/Inventory exatos somente dentro dos
service bindings privados de CRM Pages. O edge público bloqueia
incondicionalmente os headers de seleção de versão e a rota
`/insumos/health/workforce-contract` em produção e staging; nem clientes nem
Workers externos podem usá-los para escolher um candidato.
As duas regras custom zone-scoped e seus IDs são precondição externa. Token sem
permissão para o custom-rules entrypoint, dashboard sem sessão autenticada ou
regra apenas no Worker falham fechados; não existe fallback operacional.
`PONTO_WAF_READ_API_TOKEN` deve existir somente no repositório e
`PONTO_WAF_WRITE_API_TOKEN` somente no environment `production`; ambos estão
atualmente não provisionados e bloqueiam a cadeia. Não use
`CLOUDFLARE_SECURITY_API_TOKEN` como fallback.
O gate externo exige 14 observações: em cada host, um controle negativo, os
dois headers proibidos e a rota bloqueada nas formas literal, com encoding
simples, com encoding duplo (prova do decode recursivo) e com caixa divergente.
A coorte exige uma identidade autorizada, uma unidade e um contexto de rede
opaco. `canary` mantém as versões candidatas em zero por cento de tráfego
default e aplica o percentual aprovado somente ao bucketing protegido no
Pages; interrompe automaticamente em falha de publisher, jornada ou SLO. Nos
dois estágios, Identity/Inventory precisa provar auth/session, uma leitura
autorizada representativa e o contrato HMAC v2 com Workforce. `production` só
torna as quatro versões candidatas correntes e grava `active` depois da cadeia
verde.
Revisão de código não é aprovação de deployment. Staging e produção precisam
de uma custom deployment branch policy única e exata para `main`, required
reviewer/protection independente, `prevent_self_review=true` na regra de
reviewers e `can_admins_bypass=false`; o coordenador comprova esses atributos
pela API antes de emitir qualquer capability, e os mutators os revalidam antes
de consumir autoridade. Separadamente,
Identity/Workforce precisa designar de forma humana válida um
CONSULTOR/EMPLOYEE já elegível e ativo como piloto. Não use bypass admin,
`required_approvals=0` de uma PR, conta inventada ou ativação indevida como
substitutos.
Os artefatos registram SHA/tree, runs, versões candidatas e incumbentes,
deployment IDs, percentuais, migrations, checkpoint, coorte, SLO e rollback,
sem PII nem valores de secrets.

Configure secrets e variables separadamente nos environments GitHub `staging`
e `production`. `PONTO_PROFILE_DATA_KEY` é injetado somente no upload da nova
versão candidata de Timekeeping por `wrangler versions upload --secrets-file`;
`PONTO_PROFILE_DATA_KEY` e `PONTO_IDEMPOTENCY_KEY` são proibidos como
repository secrets: o preflight exige presença somente no environment
selecionado e falha se encontrar duplicata em escopo de repositório.
`wrangler secret put` é proibido nesta cadeia porque implantaria imediatamente
uma nova versão em 100%. Bindings remotos omitidos são herdados, verificados
por nome/presença e exercitados por contratos funcionais; não são copiados para
o runner. Antes de manutenção ou mutation, o preflight rejeita em tempo
constante qualquer igualdade de bytes entre `PONTO_PROFILE_DATA_KEY` e
`PONTO_IDEMPOTENCY_KEY`. A chave de auditoria
`PONTO_ROOT_ATTESTATION_KEY_SHARED` existe somente como secret próprio de cada
environment, nunca como secret do repositório, e produz compromissos
HMAC-SHA-256 domain-separated. O custodiante aprovado provisiona a mesma versão
efetiva em `staging` e `production` sem transportar o valor pelo workflow.
`PONTO_ROOT_ATTESTATION_KEY_ID` identifica opacamente essa versão; um
compromisso HMAC de label fixo prova que staging e produção usaram a mesma
versão efetiva, mesmo se o metadado estiver incorreto. Cada environment
também declara referências de cofre distintas para os dois roots. No pilot, os
dois compromissos e as duas referências de produção precisam ser disjuntos dos
de staging do mesmo SHA. A evidência preserva ainda run do produtor, artifact
ID/digest e correlação do coordenador. Isso prova não reutilização dos bytes
exatos sob a mesma chave de comparação e custódia declarada em referências
separadas; não prova entropia nem descarta derivação correlacionada, que seguem
responsabilidade do cofre/custodiante aprovado. Nenhum valor é impresso,
transportado entre environments, gravado na evidência ou entregue ao runtime
como chave de auditoria.
O coordenador hospedado consulta login, password e coorte piloto somente por
nome; as credenciais são hidratadas apenas no runner self-hosted autorizado que
executa a jornada externa, e a coorte opaca somente no transition de
module-control que precisa validá-la. Alterar secret de Pages exige uma release
de manutenção separada. O
seletor `PONTO_PILOT_RUNNER_LABELS_JSON` deve existir como **repository
variable**, porque `runs-on` é resolvido antes de o environment do job ficar
disponível. O preflight lê esse valor pela API, exige igualdade exata com a
allowlist versionada e rejeita uma variável homônima no environment
`production`; `PONTO_PILOT_RUNNER_ENCRYPTION_PUBLIC_KEY_PEM` segue o mesmo
contrato de escopo. A allowlist tem exatamente os labels automáticos
`self-hosted`, `Linux`, `X64` e um único label
`ponto-jit-<identificador-one-shot>` pinado pela política. Antes de abrir a
coorte e novamente antes do agendamento do SLO, o inventário completo precisa
ter exatamente um match online/idle, com ID e nome pinados, política JIT
Ed25519 completa e chave RSA pública correspondente. O `runs-on` consome o
seletor emitido por esse preflight, não reavalia uma variable mutável. Não
cadastre esses valores como environment variables nem reutilize o label após o
runner one-shot. O token de inventário protegido precisa de
`Administration:read`, `Variables:read`, `Actions:read` e `Environments:read`
(ou equivalentes no tipo de token usado).
Pages environment `preview` usa `https://api-staging.skincos.com.br`; nunca
compartilhe upstream ou chave HMAC de produção com preview. O smoke produtivo
permanece somente leitura e não aceita opção para criar marcações.

### Overlay e watchdog de emergência

`module-control:timekeeping:emergency-latch` é um overlay monotônico separado
do controle regular `module-control:timekeeping`. Edge Pages, Worker
Timekeeping, coordenador e qualquer fluxo que possa abrir/mutar exigem payload
schema v1 íntegro com `latched=false`. Latch ausente, inacessível, JSON
inválido/malformado ou `latched=true` significa indisponível e bloqueia
progressão. Um controle regular `active` nunca prevalece sobre esse overlay.

Somente `.github/workflows/ponto-emergency-latch-reset.yml` pode escrever
`latched=false`. O reset exige manutenção regular, superfície governada idle e
evidências imutáveis de latch/reconciliação; depois do reset, o módulo continua
em manutenção. Fechamento manual e automático escrevem somente `latched=true`.
Não delete a chave, não trate ausência como aberta e não escreva `false` em
script, migration ou publisher alternativo.

`.github/workflows/ponto-release-watchdog.yml` observa o `workflow_run`
terminal do coordenador canônico em `main`. Para falha, cancelamento ou timeout
de qualquer estágio mutante, ele:

1. usa o environment dedicado `ponto-emergency-<target>` para gravar e
   reatestar `latched=true` antes de aguardar mutex;
2. cancela/force-cancela e reconcilia runs/capabilities governados;
3. obtém `ponto-surface-mutation`, grava o controle regular em `maintenance` e
   confirma que o latch continua fechado.

O environment de emergência deve ser reviewer-free para que o fail-close não
dependa de aprovação, conter apenas a credencial estreita de fechamento e
nunca o token amplo de release. Isso não dispensa approval independente para
abrir/promover. O watchdog também não é um sistema externo ao GitHub/Cloudflare:
depende da entrega do evento terminal, de GitHub Actions e da API Cloudflare.
Outage, evento atrasado ou control plane indisponível podem atrasar/impedir a
recuperação. Preserve monitor externo, checkpoint/fences e procedimento de
operador; um artifact do watchdog não prova por si só que o estado live mudou.

Rollback é um estágio do mesmo coordenador. Ele grava manutenção primeiro,
restaura somente o baseline imutável de incumbentes capturado e provado antes
do pilot para Timekeeping, Identity/Inventory, Core API e CRM Pages e mantém o
módulo fechado até a validação externa. Uma nova tentativa reutiliza esse
baseline; nunca elege um candidato parcialmente promovido como incumbente.
Migrations são
expansivas e não são revertidas durante o incidente. O kill switch isolado
continua disponível em `.github/workflows/module-availability.yml` com
`module=timekeeping` e `state=maintenance` ou `disabled`; `active` exige
schema v2 e o SHA completo da versão já atestada. Registrar todos os run IDs e
IDs de versão/deployment. Rollback de importação segue
`docs/ponto-migration.md`. Backups e evidências ficam em
`C:\CodexRuntime\operator\admin\skincos\timekeeping`, nunca no repositório.

## Incidentes

## Evidência de release e linhagem

Cada promoção deve partir do `HEAD` atual de `main`, com um único SHA completo
alcançável por merge canônico e com os checks obrigatórios associados ao mesmo
commit. Antes de despachar `preview`, registre o SHA consultado e confirme que
ele não mudou; se mudar, descarte o predecessor e repita o preview. A ausência
de um check obrigatório no commit selecionado é bloqueio de linhagem, não motivo
para promover um ancestral ou usar bypass administrativo. O coordenador deve
preservar os IDs dos runs, digests dos artefatos, versões/deployments e o
resultado de cada estágio no ledger privado; secrets, credenciais, PII e dados
operacionais sintéticos nunca entram nesse registro.

- Banco indisponível: readiness 503, bloquear marcações e orientar contingência auditada; não escrever JSON.
- Facial indisponível: diferenciar indisponibilidade técnica de não cadastrado/não reconhecido; permitir PIN auditado com rate limit.
- PIN bloqueado: aguardar `locked_until`; RH pode redefinir credencial, nunca consultar o PIN.
- Dispositivo comprometido: revogar cadastro, revisar auditoria pelo `deviceId` e emitir novo token mostrado uma vez.
- Divergência de cálculo: não editar evento; abrir correção, recalcular período aberto ou reabrir formalmente o fechado.
