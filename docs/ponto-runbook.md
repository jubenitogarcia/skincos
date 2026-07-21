# Runbook — Controle de Ponto

## Arquitetura operacional

O navegador usa `https://crm.skincos.com.br/api/ponto/*`. A Pages Function autentica a sessão, assina claims mínimos e encaminha apenas headers autorizados para `https://api.skincos.com.br/api/ponto/*`. O gateway `api` monta o Worker `workforce/timekeeping` por Service Binding `TIMEKEEPING`. O domínio usa D1 próprio e consome a Escala pelo binding `SCHEDULE`.

O backend legado `crm/api/server/pontoRoutes.js` não participa desse caminho. `ponto_store.v2.json` é somente entrada de migração/rollback controlado.

O terminal físico usa `https://crm.skincos.com.br/ponto-terminal.html`, autentica somente com um token de dispositivo revogável e registra por matrícula + PIN. A unidade, o dispositivo e o instante são definidos pelo servidor; não há seleção de unidade, reconhecimento facial ou horário do navegador. O procedimento de ativação e as políticas de rede/trabalho externo ficam em [ponto-terminal-presenca.md](ponto-terminal-presenca.md).

## Saúde e 404

```bash
curl -i https://crm.skincos.com.br/api/ponto/health
curl -i https://crm.skincos.com.br/api/ponto/readiness
curl -i https://api.skincos.com.br/api/ponto/health
```

`health` é público e informa serviço/versão sem secrets. `readiness` consulta D1 e retorna 503 JSON quando indisponível. Ambos precisam ter `content-type: application/json` e `x-request-id`.

Para 404: validar nesta ordem Pages proxy, `PONTO_API_TARGET`, gateway publicado, binding `TIMEKEEPING`, Worker publicado e migrations. HTML, redirect de frontend ou 200 sem JSON é falha operacional.

## Permissões

| Papel | Acesso |
| --- | --- |
| Funcionário | próprio contexto, histórico, batida e solicitação de correção |
| Dispositivo | batida na unidade gravada no cadastro do dispositivo |
| Gestor | leitura das unidades autorizadas, correção e dispositivos; não aprova a própria correção |
| RH | leitura, identidade canônica, aprovação/recusa, fechamento e reabertura |
| Administrador | RH + dispositivos e auditoria |
| Auditor | leitura, exportação e auditoria; sem mutações |

O frontend apenas oculta/desabilita ações; o Worker sempre revalida papel, unidade, funcionário e dispositivo.

Mutações same-origin exigem o token CSRF da sessão. A Pages Function envia um envelope HMAC v2 que vincula ator, instante, método, caminho com query string, nonce e SHA-256 do corpo; o Worker rejeita versão antiga, assinatura reaproveitada e nonce repetido. O proxy encaminha somente uma allowlist de headers e limita o corpo a 1 MiB.

## Secrets e variáveis

- `PONTO_ACTOR_HMAC_KEY`: assinatura CRM → Timekeeping;
- `PONTO_IDEMPOTENCY_KEY`: fingerprint de retries;
- `PONTO_TEMPLATES_KEY`: A256GCM dos templates biométricos;
- `PONTO_PROFILE_DATA_KEY`: A256GCM de documentos, filiação, telefone e endereço do perfil canônico;
- `ESCALA_ACTOR_HMAC_KEY`: autenticação Timekeeping → Escala;
- `TIMEKEEPING_BACKUP_PASSPHRASE`: cifra o checkpoint D1 criado pelo workflow antes de migrations remotas;
- `PONTO_FACE_PUNCH_ENABLED`: mantém identificação facial desabilitada por padrão; só use `true` após aprovação operacional explícita. A interface também bloqueia temporariamente novas capturas faciais; as marcações usam PIN;
- `PONTO_NETWORK_CONTEXT_KEY`: assinatura do IP público observado pela Pages Function para o Worker. Configure o mesmo secret nos dois serviços somente quando for usar política de rede `OBSERVE` ou `REQUIRE`;
- `PONTO_FACE_THRESHOLD`, `PONTO_PIN_ITERATIONS`, `PONTO_COOLDOWN_SECONDS`: ajustes operacionais no servidor;
- `TIMEKEEPING_D1_STAGING_ID` e `TIMEKEEPING_D1_PRODUCTION_ID`: variables do GitHub, não secrets.

Nunca registrar PIN, token de dispositivo, cookie, template, vetor, foto, score ou chave. A UI nunca recebe template/score.

## Fechamento mensal

1. Sincronizar Escala e resolver conflitos de identidade.
2. Carregar espelho, inconsistências e solicitações de correção.
3. Aprovar/recusar correções por usuário diferente do solicitante.
4. Informar justificativa e fechar o período.
5. Confirmar snapshot, checksum e auditoria.

Fechamento bloqueia novas batidas/correções no intervalo. Reabertura exige RH/Admin, justificativa e auditoria. Mudanças de regra posteriores não alteram snapshots fechados.

A trava `timekeeping_period_guards` é adquirida por data antes do cálculo e impede que uma batida concorra com o fechamento. O bloqueio de PIN é global por funcionário, inclusive quando as tentativas alternam entre dispositivos.

## Deploy e rollback

Executar `.github/workflows/deploy-timekeeping.yml` primeiro em `staging`. O workflow exporta e cifra um checkpoint D1, aplica migrations, configura secrets, publica Worker e gateway e faz smoke read-only. Produção exige o `staging_run_id` numérico de uma execução verde para o mesmo SHA e o environment protegido `production`.

Configure secrets e variables separadamente nos environments GitHub `staging` e `production`. O Pages environment `preview` usa `https://api-staging.skincos.com.br`; nunca compartilhe o upstream ou a chave HMAC de produção com preview. O smoke produtivo permanece somente leitura e não aceita opção para criar marcações.

Rollback de aplicação: publicar a versão anterior do Worker/gateway. Migrations são expansivas; não remover colunas/tabelas em incidente. Rollback de importação segue `docs/ponto-migration.md`. Backups e evidências ficam em `C:\CodexRuntime\operator\admin\skincos\timekeeping`, nunca no repositório.

## Incidentes

- Banco indisponível: readiness 503, bloquear marcações e orientar contingência auditada; não escrever JSON.
- Facial indisponível: diferenciar indisponibilidade técnica de não cadastrado/não reconhecido; permitir PIN auditado com rate limit.
- PIN bloqueado: aguardar `locked_until`; RH pode redefinir credencial, nunca consultar o PIN.
- Dispositivo comprometido: revogar cadastro, revisar auditoria pelo `deviceId` e emitir novo token mostrado uma vez.
- Divergência de cálculo: não editar evento; abrir correção, recalcular período aberto ou reabrir formalmente o fechado.
