# Livia: promoção e recuperação isoladas

1. Confirme que não há execução Livia em `running`, `waiting` ou `new`; não reinicie o Orb durante publicação.
2. Crie checkpoint do workflow, manifesto, ledger e release ativa.
3. Gere o archive com `git archive <merge-commit>`, gere a linhagem descendente e valide SHA-256.
4. Execute `prepare-native-source-release.sh --apply --stage-only`; ele deve validar o construtor, a matriz offline e os entrypoints antes de criar a release.
5. Crie o manifesto da nova versão, valide o candidato e publique com `apply-livia-runtime-isolation.js` usando `--expected-version`.
6. Nunca promova `/opt/skincos/current/source` para corrigir Livia. Rode `workflow-runtime-manifest.js audit-live` depois da promoção.
7. Só faça restart com `orb-safe-restart.sh` após drenagem; normalmente uma nova versão histórica não requer restart.

Retomadas exigem `semanticJobKey`; `publishRunIndex` serve apenas para dependências dentro da fila. Registros legados ou sem identidade semântica não podem suprimir jobs atuais.
