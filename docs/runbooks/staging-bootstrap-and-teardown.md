# Bootstrap e teardown do staging isolado

Este runbook cria apenas a fundação de controle para um domínio. Não migra tráfego, dados de produto, usuários, grants, sessões ou feature flags de negócio.

## Pré-requisitos

- A branch/PR que contém `platform/staging/manifest.json` está integrada e passou `npm run staging:manifest:validate`.
- A autenticação Wrangler pertence à conta de staging autorizada. Não use credenciais de produção por conveniência.
- Defina `SKINCOS_STAGING_STATE_DIR` para um diretório privado fora do repositório. Ele receberá a configuração gerada pelo Wrangler, que pode conter IDs de recursos e nunca deve ser commitada.
- Registre a janela e o owner. Crie o segredo `STAGING_CONTROL_TOKEN` diretamente no Worker após o bootstrap; o repositório contém somente seu nome.

## Bootstrap

Primeiro gere o plano, que não chama a API:

```bash
node scripts/staging/bootstrap.mjs --domain identity
```

Na janela aprovada, execute para um único domínio:

```bash
SKINCOS_STAGING_STATE_DIR=/private/skincos/staging SKINCOS_STAGING_APPLY=1 \
  node scripts/staging/bootstrap.mjs --domain identity --apply
```

O bootstrap usa a configuração sem IDs para o provisionamento automático de D1, KV e R2 pelo Wrangler e cria explicitamente a fila e a DLQ pelo binding do Worker. Em seguida, aplica apenas a fixture sintética, grava `module_enabled=false` e publica o sentinel de R2. Nenhum segredo é escrito pelo script.

## Reconciliação

A reconciliação atual valida somente os controles sintéticos do domínio isolado. Ela não lê nem copia a base compartilhada ou produção:

```bash
SKINCOS_STAGING_STATE_DIR=/private/skincos/staging SKINCOS_STAGING_RECONCILE=1 \
  node scripts/staging/reconcile.mjs --domain identity --apply
```

O arquivo de evidência resultante fica no diretório privado. Uma reconciliação de dados de domínio exige PR própria com classificação, sanitização, journal e rollback aprovados.

## Teardown

Teardown é destrutivo e é proibido sem confirmar backup/retenção e que nenhum consumidor usa o domínio. O modo padrão só imprime o plano. A execução exige domínio explícito, estado privado correspondente e duas confirmações:

```bash
SKINCOS_STAGING_STATE_DIR=/private/skincos/staging SKINCOS_STAGING_TEARDOWN=1 \
  node scripts/staging/teardown.mjs --domain identity --apply
```

O script não aceita URL, ID ou target fornecido pela linha de comando; deriva os recursos somente da configuração privada criada pelo bootstrap e confere o nome lógico do Worker. Ele nunca aponta para produção.
