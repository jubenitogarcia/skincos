# CRM: orçamento de bundle

O aviso de versão do Wrangler é informativo: `wrangler` permanece fixado em `4.107.0` até uma atualização deliberada e validada.

`npm run build` valida dois perfis de JavaScript do CRM:

- shell inicial: máximo de 800 KiB, incluindo somente o entrypoint e seus imports estáticos;
- recursos especializados do Ponto: no máximo 1.400 KiB por chunk, somente como imports dinâmicos de `PontoModule`.

`npm run analyze:bundle` também grava um JSON fora do repositório. Defina `CRM_BUNDLE_REPORT_DIR` para escolher o diretório; sem essa variável, o relatório usa o diretório temporário do sistema.

`npm run smoke:bundle-deferred:local` exige o CRM local em execução e confirma que Atendimento, Conversa, Insumos e Meta Ads não carregam TensorFlow ou `face-api`.

Os avisos de `mock-icon-import-proxy` e `mock-spark-plugin` descrevem tempo de compilação. Eles não são erros de execução do CRM e devem ser investigados separadamente se o build se tornar lento demais.
