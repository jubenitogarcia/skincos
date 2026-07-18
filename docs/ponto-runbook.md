# Runbook — Controle de Ponto

## Arquitetura

O navegador usa `https://crm.skincos.com.br/api/ponto/*`. A Pages Function assina a identidade da sessão e encaminha somente headers permitidos para `https://api.skincos.com.br/api/ponto/*`. O gateway monta o domínio Workforce por Service Binding; o Worker Timekeeping usa D1 próprio.

O arquivo `ponto_store.v2.json` não é fonte operacional do novo domínio. Ele só pode ser lido pelo importador controlado, primeiro em `--dry-run`.

## Saúde e diagnóstico

```bash
curl -i https://crm.skincos.com.br/api/ponto/health
curl -i https://crm.skincos.com.br/api/ponto/readiness
```

Ambos devem retornar JSON e `x-request-id`. `health` não exige login; `readiness` nunca revela secrets. Para um `404`, seguir a cadeia: Pages proxy → `api.skincos.com.br/api/ponto` → binding `TIMEKEEPING` → Worker Timekeeping. Um HTML ou content-type diferente de JSON é falha de deploy/proxy.

## Migrations e importação

```bash
npx wrangler d1 migrations apply skincos-timekeeping --local --config workforce/timekeeping/wrangler.toml
node workforce/timekeeping/scripts/import-ponto-json.mjs --source <arquivo-json-controlado> --dry-run
```

Antes de escrita remota, exportar D1 para diretório privado do operador, registrar checksum e validar restauração em staging. Migrations são expansivas; rollback de aplicação é feito pela versão anterior do Worker. Não executar rollback destrutivo sem backup testado.

## Secrets e operação

- `PONTO_ACTOR_HMAC_KEY`: assinatura curta de actor entre CRM e Workforce.
- `PONTO_IDEMPOTENCY_KEY`: hash de fingerprints de retries.
- `PONTO_TEMPLATES_KEY`: obrigatório para biometria; nunca gravar template em claro.

Não registrar PIN, token, cookie, template, vetor ou imagem em logs. Revogar dispositivo ou consentimento biométrico invalida uso imediatamente e deve gerar auditoria.
