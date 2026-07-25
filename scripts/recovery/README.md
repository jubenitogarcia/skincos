# Cifragem e recuperação offsite

Estes comandos manipulam somente arquivos privados em runtime. Eles não
conhecem destino, credencial, chave ou identificador de ambiente; esses dados
ficam no cofre privado do operador e em um escrow externo.

- `new-offsite-recovery-key.ps1` cria uma chave de 32 bytes protegida por DPAPI
  do operador e informa apenas o fingerprint para auditoria.
- `protect-offsite-archive.ps1` cifra um arquivo em streaming com AES-256-CBC
  e HMAC-SHA-256 (encrypt-then-MAC), produzindo hashes de origem e ciphertext.
- `restore-offsite-archive.ps1` verifica o HMAC antes de abrir o conteúdo e
  escreve atomically apenas no scratch explicitamente escolhido.

O processo de operação está em
`docs/runbooks/backup-and-restore-policy.md`. A rotação cria um novo `keyId`,
registra o material no escrow externo antes de qualquer backup e mantém a
chave anterior até o fim da retenção acrescido do RTO. Não copie o arquivo de
chave, o ciphertext, dumps ou manifests operacionais para o repositório.
