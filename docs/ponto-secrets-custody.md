# Ponto — custódia de secrets

Os valores do Ponto são gerados e mantidos fora do repositório, em cofres
independentes por ambiente. Este registro lista apenas nomes, escopos e
referências opacas; nunca inclua valores, chaves privadas, credenciais,
cookies, PII ou material plaintext em commits, logs, artefatos ou comentários.

## GitHub environments

- `staging`: `PONTO_PROFILE_DATA_KEY`, `PONTO_ROOT_ATTESTATION_KEY_SHARED`,
  `PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY`,
  `PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY`.
- `production`: os mesmos quatro nomes, com material independente.
- Os secrets de emergência são separados por ambiente e só permitem o
  fechamento externo (`PONTO_EMERGENCY_CLOSE_BROKER_CREDENTIAL`).

`PONTO_PROFILE_DATA_KEY` e `PONTO_IDEMPOTENCY_KEY` não podem existir como
repository secrets nem ser copiados entre environments. Workflows validam
presença, escopo, fingerprints e custódia; o valor nunca é impresso nem
transportado pela evidência pública.

A reattestação do broker permanece close-only e só atualiza a referência de
execução da evidência enquanto o latch continua fechado.

## Cloudflare Workers

Os brokers `skincos-ponto-emergency-staging` e
`skincos-ponto-emergency-production` usam bindings e secrets próprios, com
operação close-only e latch monotônico. A attestation registra apenas versão,
database ID, nomes de secrets e fingerprint da chave de resposta.
