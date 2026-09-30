# Token Vault: release nativa sem GitHub Actions

## Estado operacional

GitHub Actions não é um gate deste release. Esta implementação usa um checkout
limpo na `main` para Preview e observação, um archive verificado instalado como
release Linux imutável, um lease global sob custódia root, journal privado,
versão Worker imutável e evidência de promoção selada por root. O workflow
`.github/workflows/deploy-token-vault.yml` permanece como contrato histórico de
paridade; não o dispare para contornar orçamento.

**Este caminho ainda não foi comissionado em staging nem produção.** Código,
testes focalizados e instalador não substituem custódia nativa dos bearers
Token Vault/Meta, prova da primeira execução staging e leitura de volta live.
Cada gate ausente falha fechado. Nenhum segredo deve ir para Windows, argv,
checkout, Git, log, PR ou artefato.

## Identidade e armazenamento

- Source: SHA completo alcançável em `origin/main`; tree Git e digest das
  superfícies `runtime` + `github-governance` devem coincidir com Preview.
- Candidate: `release-source-<SHA>/source.tar.gz`, `identity.json` e
  `closure.json`, produzidos pelo operador no filesystem nativo Ubuntu.
- Release: `/opt/skincos/releases/<SHA>/source`, com `source.tar.gz` sibling e
  sidecars root-owned `.skincos-token-vault-release-identity.json` e
  `.skincos-global-coordination-token-vault.json`. O código reconstrói a tree
  inteira, compara o SHA-256 do archive e recalcula o fechamento de dependências.
- Evidências e journal do operador: `/home/admin/.local/state/skincos/token-vault/`
  em arquivos privados, sem segredos. Observações novas de `origin/main` são
  produzidas antes de cada autorização de escrita.
- Evidência canônica staging/produção: arquivos create-only root:admin `0640`
  em `/var/lib/skincos-runtime/token-vault/promotion-evidence/<SHA>/`. Produção
  aceita somente o arquivo staging selado da mesma revisão e fechamento.
- Lease: `release:token-vault`; o proof é root-only em
  `/var/lib/skincos-runtime/global-coordination/token-vault-<transaction-id>.json`.
  O helper da release lê a custódia fixa em
  `/etc/skincos/global-coordination/native-runtime.env`; seu valor nunca sai
  para o publisher ou para o checkout.
- Credenciais de destino: `/etc/skincos/token-vault/native-staging.env` e
  `native-production.env`, em diretório root:root `0700`, arquivos root:root
  `0600`, com nomes de chaves permitidos por ambiente. O helper da release
  verifica sua própria tree antes de ler o arquivo e inicia o publicador como
  `admin` com variáveis de processo, sem passar valores em argumentos. Seu modo
  `provision --source-sha <SHA> --target <ambiente>` recebe o documento completo
  somente por stdin protegido, cria o arquivo uma vez e recusa sobrescrever;
  rotação exige plano separado com recuperação do valor anterior.

## Sequência do operador

Use Ubuntu-24.04 por `scripts/invoke-skincos-wsl.ps1` e um checkout **limpo**
da revisão já integrada à `main`. O SHA escolhido precisa conter os scripts
nativos. Os exemplos mostram argumentos, nunca valores de credenciais.

1. Execute o Preview e conserve a evidência privada. Ele executa testes do
   Token Vault, D1 migrations locais e dry run do Wrangler `4.120.0` antes de
   gravar o resultado:

   ```powershell
   $sha = '<SHA completo da main>'
   $repo = '<checkout limpo desse SHA>'
   & "$repo\scripts\invoke-skincos-wsl.ps1" -ProjectRoot $repo -Executable node -Argument @('scripts/token-vault-native-preview.mjs','preview','--source-sha',$sha)
   ```

2. Gere o candidate no filesystem **nativo** do Ubuntu, fora do checkout.
   O preparo exige a evidência de Preview e revalida source/tree/digest antes
   e depois do `git archive`:

   ```powershell
   & "$repo\scripts\invoke-skincos-wsl.ps1" -ProjectRoot $repo -Executable node -Argument @('scripts/token-vault-native-prepare-source.mjs','--source-sha',$sha,'--preview-evidence',"/home/admin/.local/state/skincos/token-vault/$sha-preview.json",'--candidate',"/home/admin/.local/state/skincos/token-vault/candidates/release-source-$sha")
   ```

3. Valide o candidate com `scripts/runtime/install-token-vault-native-source.mjs`
   em dry run; só aplique a instalação após a árvore e o archive conferirem.
   O installer publica um novo diretório root-owned e não substitui o runtime
   ativo. O instalador não executa código do archive como root. `--apply`
   exige o mesmo SHA ainda na `main`, verifica novamente os bytes copiados,
   instala os sidecars e registra o checkpoint da ACL anterior.

   ```powershell
   $candidate = "/home/admin/.local/state/skincos/token-vault/candidates/release-source-$sha"
   & "$repo\scripts\invoke-skincos-wsl.ps1" -ProjectRoot $repo -Executable node -Argument @('scripts/runtime/install-token-vault-native-source.mjs','--candidate',$candidate,'--source-sha',$sha)
   & "$repo\scripts\invoke-skincos-wsl.ps1" -ProjectRoot $repo -Executable node -Argument @('scripts/runtime/install-token-vault-native-source.mjs','--candidate',$candidate,'--source-sha',$sha,'--apply')
   ```

   A instalação altera somente a ACL do parent `/opt/skincos/releases` para
   `u:admin:--x`, permitindo atravessar um SHA conhecido. O caminho
   `aclCheckpoint` retornado contém a ACL anterior. Uma eventual restauração
   com `sudo -n setfacl --restore=<checkpoint>` requer confirmar primeiro que
   nenhuma release Token Vault dependente desse acesso está em uso.

4. Provisione as credenciais de staging/produção pelo mecanismo canônico
   protegido diretamente nos arquivos nativos acima, sem usar checkout,
   Windows, argumento, log ou artefato. O arquivo de staging requer fonte Meta
   externa autorizada e seletores do ambiente; não reutilize o token Orb de
   produção. Use o modo `provision` da release a partir do emissor autorizado,
   passando o documento por stdin protegido. Se o arquivo já existir, não
   substitua seu valor por conveniência. Gere uma observação nova de
   `origin/main` sem credenciais antes do
   preflight. O preflight somente leitura
   verifica o token de configuração, a fonte sintética isolada de staging,
   flags, secrets herdados do Worker, incumbent exato e bookmark D1 Time Travel.
   Quando o incumbent já possui o binding de configuração, o preflight
   autentica o bearer na rota live, somente para leitura, antes de permitir
   qualquer upload:

   Se o binding de analytics não existir, o bearer deve estar disponível pela
   custódia nativa canônica e também para seu consumidor privado antes do
   upload. O publicador não gera um valor descartável. A produção aceita
   apenas autoridade `tracking_ready`; bootstrap legado é exclusivo de staging.

   ```powershell
   $observation = "/home/admin/.local/state/skincos/token-vault/observations/$sha-$([guid]::NewGuid().ToString('N')).json"
   & "$repo\scripts\invoke-skincos-wsl.ps1" -ProjectRoot $repo -Executable node -Argument @('scripts/token-vault-native-observe.mjs','--source-sha',$sha,'--file',$observation)
   & "$repo\scripts\invoke-skincos-wsl.ps1" -ProjectRoot $repo -Executable bash -Argument @('scripts/runtime/invoke-token-vault-native-release.sh','readiness','--target','staging','--source-sha',$sha,'--preview-evidence',"/home/admin/.local/state/skincos/token-vault/$sha-preview.json",'--observation-file',$observation)
   ```

5. Publique com `scripts/runtime/invoke-token-vault-native-release.sh publish` pelo
   wrapper tipado. Esse launcher apenas seleciona o SHA; o publisher roda da
   release imutável após carregar a custódia do destino. Passe `--checkout-root` com o caminho WSL do checkout
   limpo, usado **somente** para Git/readback sem privilégios. Staging exige
   Preview e readiness da mesma revisão. Produção acrescenta
   `--staging-evidence` apontando para a cópia root-sealed de staging.
   Use `transaction-id` novo e estável; não reinicie uma transação ambígua com
   outro ID.

## Transação e recuperação

O publisher grava cada tentativa no journal privado antes da chamada remota.
Ele bloqueia uma nova transação do mesmo ambiente enquanto houver uma anterior
indeterminada. A ordem é: lease, D1 Time Travel/journal/migrations aditivas,
upload de versão imutável com `--keep-vars --strict`, atestado/reconciliação/
seed sintético em staging, autenticação e plano selado da candidata, ativação
`version_id@100%`, leitura exata da versão e rota, bootstrap quando necessário,
saúde autenticada, exercício reversível da fixture de staging, evidência e
liberação do lease. A operação de produção exige a versão candidata de staging
ainda ativa.

Falhas com resultado conhecido revertem bootstrap e seed de staging nessa
ordem, depois restauram o Worker incumbent **somente quando a transação ainda
possui o tráfego**. Migrations D1 são aditivas e **forward-only**; um timeout
durante D1 exige readback do journal e reconciliação, jamais retry cego ou
alegação de rollback. Se o upload perder a resposta, reconcilie o inventário
de versões antes de tentar novamente; a transação não afirma que a versão foi
descartada. Timeout em bootstrap ou fixture retém o candidato e
marca a transação indeterminada para investigação. Se a liberação do lease ou
o selo root da evidência falhar, a promoção também fica indeterminada até
readback/reconciliação. A evidência root-owned de staging é a única entrada
  aceita para promoção de produção, junto com o journal terminal `succeeded`
  e o registro de selo da mesma transação.

## Validação antes do primeiro uso live

Execute os testes focalizados `scripts/tests/token-vault-native-*.test.mjs` em
Ubuntu-24.04, confira `git diff --check`, faça dry run do installer e verifique
o manifest/tree da release instalada. Depois, em staging, acompanhe D1 journal,
Worker version ID, health autenticado, fixture revertida e evidência root-sealed.
Só então promova produção, com rollback incumbent conhecido e readback da rota.
Build, teste ou health isolado não prova uma promoção live.
