# Política de backup e restauração

Esta política é obrigatória para qualquer mudança de maturidade. Um backup não
substitui uma restauração testada; evidência local, endpoint saudável ou deploy
anterior não qualificam um módulo para `operational`.

## Controles obrigatórios

| Dado | RPO alvo | RTO alvo | Retenção | Cópia e criptografia | Owner |
| --- | ---: | ---: | --- | --- | --- |
| D1 por domínio | 15 min | 30 min | 35 dias + mensal por 12 meses | export cifrado AES-256, destino primário e cofre de outro fornecedor | owner do domínio + Platform |
| PostgreSQL por domínio | 15 min | 30 min | 35 dias + mensal por 12 meses | dump consistente cifrado AES-256, destino primário e cofre de outro fornecedor | owner do serviço + Platform |
| R2 e configurações | 24 h, ou antes de alteração | 60 min | 90 dias | inventário de objetos e arquivo de configuração cifrados; cópia fora da conta Cloudflare | Platform |
| Estados operacionais (filas, DLQ, outbox, bindings) | 15 min | 60 min | 35 dias | export versionado, cifrado e reconciliável | owner do módulo |

As credenciais de escrita do destino, a chave de criptografia e o acesso à
origem devem ser contas/roles diferentes. A chave precisa de escrow fora do
fornecedor de armazenamento, com procedimento break-glass auditável. Segredos
e dados pessoais nunca entram no repositório nem na evidência versionada.

## Procedimento de restore

1. Suspender somente as escritas do domínio afetado e registrar o bookmark ou
   timestamp de recuperação.
2. Recuperar o ciphertext em ambiente scratch isolado e verificar a assinatura
   ou SHA-256 antes de decriptar.
3. Restaurar sem binding, rota, segredo ou fila de produção.
4. Comparar esquema, contagens, checksum de conteúdo e integridade referencial;
   executar uma jornada de leitura/escrita segura do domínio.
5. Medir RPO e RTO do início da recuperação ao teste funcional; anexar o
   identificador de evidência privada e destruir o scratch ao final.
6. Só então avaliar o corte, com rollback documentado e aprovação explícita.

## Gate de maturidade

O CI exige `recoveryProof` estruturado para estados `operational` e `critical`.
Ele deve conter id do drill, escopo, referência de evidência, timestamp da
restauração, testes de dados e funcional, e RTO medido. `critical` exige ainda
prova de restauração offsite e referência de escrow da chave. Uma referência
sem esses campos falha o check `module-maturity:validate`.

## Situação transitória em 2026-07-23

O exercício `20260723T223442Z` comprovou D1, PostgreSQL e configuração em
scratch, com ciphertext no R2 de staging. Esse bucket é Cloudflare e a chave
está apenas em DPAPI do operador; portanto **não é cópia offsite nem escrow**.
Nenhum módulo pode usar esse exercício para avançar a `operational` ou
`critical`. A provisão do cofre externo, role de backup segregada e escrow é
P0 antes de qualquer promoção.
