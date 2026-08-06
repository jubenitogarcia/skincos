# Clientes: runtime de produção somente leitura

O runtime isolado de Clientes roda em `crm-atendimento-production.service`,
com release imutável em `/opt/skincos/releases/<sha>/source`, bind privado em
`127.0.0.1:8110` e banco dedicado `skincos_clientes_production`. A aplicação
usa `skincos_clientes_ro` (somente `SELECT` e `default_transaction_read_only`),
enquanto `skincos_clientes_migrator` e `skincos_clientes_owner` são exclusivos
para schema pré-gerenciado. Nenhum desses processos inicia o worker Harmonia.

O health `/api/atendimento/health` é liveness/configuração sem consulta ao
banco e pode permanecer 200 durante uma indisponibilidade controlada. O
readiness `/api/atendimento/readiness` é interno (loopback ou token interno),
consulta banco/schema e retorna 503 quando uma dependência não está pronta.
O proxy público sanitiza o health e encaminha somente
`https://crm-atendimento.skincos.com.br`; dados de ator, credenciais e PII
nunca são retornados pelo health ou registrados em observabilidade.

## Contrato e instalação

1. Inspecione sem escrever:

   ```bash
   scripts/provision-atendimento-production-readonly.sh --dry-run
   ```

2. Depois de confirmar backup e o checkpoint de banco, aplique. O script
   cria o banco apenas se ele não existir, restaura o snapshot das fontes sob o
   owner dedicado, grava config/migrator com permissões nativas e inicia em
   `maintenance`:

   ```bash
   scripts/provision-atendimento-production-readonly.sh --apply
   ```

   Um banco existente é recusado (exit 73); não há sobrescrita destrutiva.

3. Prepare e instale apenas o SHA aprovado em
   `/opt/skincos/releases/<sha>/source`:

   Primeiro, o staging nativo exige que o SHA seja exatamente o `origin/main`
   atual e registra o predecessor verificado:

   ```bash
   scripts/runtime/prepare-atendimento-production-release.sh \
     --release-sha <sha-main> --predecessor-sha <sha-predecessor> --apply
   ```

   ```bash
   scripts/runtime/install-atendimento-production-service.sh \
     --source-root /opt/skincos/releases/<sha>/source --apply
   ```

   O `crm-clientes-source-refresh.service` genérico permanece desabilitado na
   primeira promoção: o alvo histórico `production` aponta para o banco
   compartilhado `skincos_crm_local`. Ele só poderá ser habilitado depois de
   existir um runner dedicado para `skincos_clientes_production`, com papel de
   migration, checkpoint e backup próprios.

4. Para a rota dedicada, obtenha o UUID e o JSON de credenciais do túnel
   exclusivamente no Cloudflare e instale sem tocar no túnel compartilhado:

   ```bash
   scripts/runtime/install-atendimento-production-tunnel.sh \
     --tunnel-id <uuid> \
     --credentials-file /etc/skincos/cloudflare/atendimento-production/<uuid>.json \
     --apply
   ```

   O script aceita apenas o hostname fixo
   `crm-atendimento.skincos.com.br`, ingressa somente em `127.0.0.1:8110`,
   valida o config, faz backup e inicia somente
   `cloudflare-atendimento-production.service`. Não executa shell, SSH, `eval`
   nem reinicia `cloudflare-runtime.service` ou `crm.service`.

   Crie o CNAME dedicado em uma ação separada e sem sobrescrita implícita; o
   script falha se já existir um registro para o hostname:

   ```bash
   scripts/runtime/route-atendimento-production-dns.sh \
     --tunnel-id <uuid> \
     --origin-cert /etc/skincos/cloudflare/atendimento-production/cert.pem \
     --apply
   ```

5. Abra o controle somente depois do smoke assinado do mesmo SHA. O controle
   é fail-closed; sem `active` o serviço não atende a superfície comercial:

   ```bash
   scripts/set-atendimento-production-readonly-control.sh \
     --state active --release-sha <sha> --apply
   ```

## Smoke, rollback e validação

O smoke usa um ator sintético `clientes-readonly-smoke`, assinatura HMAC v2
com nonce, e prova health público, GET autenticado, replay rejeitado (401) e
POST rejeitado (405 `READ_ONLY_RUNTIME`). Ele lê a configuração como `skincos`
sem imprimir o segredo:

```bash
sudo -n -u skincos /usr/bin/node scripts/crm/atendimento-production-signed-smoke.mjs \
  --env-file /etc/skincos/crm-clientes-production-readonly.env \
  --base-url http://127.0.0.1:8110 \
  --expected-release-sha <sha-promovido>
```

Validação completa, incluindo health público, readiness, role/DDL, smoke e
prova de que o `crm.service` mantém PID e timestamp:

```bash
EXPECTED_STATE=active scripts/validate-atendimento-production-readonly.sh
```

Rollback é somente para um SHA já staged e comprovado pelo marcador imutável;
coloca o módulo em maintenance, instala apenas a unidade Atendimento, valida
health e só então reabre `active`. Em falha, permanece em maintenance:

```bash
scripts/runtime/rollback-atendimento-production.sh --to-sha <sha> --apply
```

Cada mudança de unidade, config, controle e snapshot fica em
`/var/backups/skincos/clientes/production-readonly`. Nenhum endpoint de POST,
PUT, PATCH ou DELETE comercial é executável na primeira promoção; não há
registro de consentimento/contato, mensagem, campanha ou decisão real de
identidade. O canário permanece vazio.
