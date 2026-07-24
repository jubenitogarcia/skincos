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

## Implementação do cofre externo

O cofre externo é um diretório privado em Google Drive, fora da conta
Cloudflare e do host PostgreSQL. Seu ID, o arquivo de configuração do cliente
e os logs de transferência ficam exclusivamente em
`C:\CodexRuntime\operator\admin\skincos\offsite-recovery\`, com ACL para
`SYSTEM` e o operador. O repositório guarda apenas estes contratos:

- a origem usa a credencial de leitura do fornecedor (Cloudflare ou role de
  backup PostgreSQL), nunca a credencial do Drive;
- o cliente do Drive deve usar o escopo `drive.file`, para enxergar somente os
  arquivos que ele próprio criou; uma conta de serviço em Shared Drive é a
  substituição obrigatória antes de classificar o cofre como corporativo;
- os objetos são ciphertexts e manifestos sanitizados. O Drive não recebe
  dumps, configuração, chaves ou tokens em claro;
- a chave de 32 bytes permanece protegida por DPAPI no runtime privado. Uma
  cópia do material de recuperação fica como GitHub Actions Environment Secret
  no environment `recovery`, separado do Drive e da Cloudflare; ela não pode
  existir como secret genérico do repositório;
- cada rotação cria um `keyId` novo e um Secret de escrow novo antes do primeiro
  upload. Chaves anteriores permanecem por `retenção + 30 dias`; revogação,
  suspeita de exposição ou perda de operador força rotação imediata.

`scripts/recovery/new-offsite-recovery-key.ps1` cria a chave privada;
`protect-offsite-archive.ps1` cifra arquivos grandes em streaming com
AES-256-CBC + HMAC-SHA-256 (encrypt-then-MAC); e
`restore-offsite-archive.ps1` verifica o HMAC antes de decriptar em scratch.
Os scripts nunca contêm IDs, chaves, contas ou destinos.

## Retenção, acesso e auditoria

- Manter 35 pontos diários e 12 mensais; qualquer exclusão requer a retenção
  equivalente no cofre e registro de auditoria. Nunca usar `sync --delete`.
- Antes de promover um arquivo, comparar SHA-256 do ciphertext local com o
  remoto e registrar `keyId`, hash, tamanho, timestamps e operador em evidência
  sanitizada. O hash do plaintext fica somente na evidência privada.
- O acesso normal tem somente upload/listagem no prefixo de backup. Download e
  decriptação são break-glass: registrar incidente, owner, motivo, escopo,
  hora, `keyId` e hash; restaurar em scratch sem rotas, bindings ou secrets de
  produção; e destruir o scratch após validação.
- O escrow é exercitado a cada trimestre: um administrador autorizado usa o
  Secret de recuperação em ambiente isolado, valida seu fingerprint e registra
  a evidência sem revelar a chave. O GitHub Secret não é usado por aplicações.
- Falha de upload, hash, escrow, retenção ou restore bloqueia promoção e abre
  alerta P0 para Platform. Acesso de emergência não autoriza sobrescrever a
  origem nem restaurar sobre produção.

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

## Situação e gate em 2026-07-24

O exercício `20260723T223442Z` comprovou D1, PostgreSQL e configuração em
scratch, com ciphertext no R2 de staging. Ele permanece uma prova útil de
restore local/same-provider, mas não de offsite.

Em `20260724T0620Z`, um cofre Google Drive privado recebeu ciphertexts novos
de D1, PostgreSQL e configuração, com AES-256-CBC + HMAC-SHA-256 e escrow de
chave separado em GitHub Actions. A cópia satisfaz separação de fornecedor e
de material criptográfico, mas **a restauração a partir do Drive ainda não foi
aceita como prova**: a autorização OAuth de escopo restrito do cliente de
recovery está pendente. Não há `recoveryProof` novo, promoção ou alteração de
produção até que o download do cofre, a restauração scratch, os checksums, a
jornada funcional e a destruição do scratch sejam registrados.

Também permanece P1 a migração desse cofre privado para Shared Drive com conta
de serviço e owner corporativo; isso evita dependência de uma conta humana sem
rebaixar o gate técnico atual.
