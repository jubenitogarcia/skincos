# Plano versionado: módulos progressivos, isolamento e continuidade

**Baseline:** 2026-07-23 13:35–13:45 BRT  
**Código auditado:** `origin/main` em `2151a49d` (PR #724)  
**Escopo:** auditoria somente leitura. Não foram alterados produção, segredos, bancos, workflows ou deploys.

## Objetivo e regra de decisão

Cada domínio deve ser habilitado por coorte, falhar de forma contida e poder ser promovido ou revertido sem indisponibilizar os demais.

Um módulo só avança quando possui:

1. persistência e migrações próprias ou explicitamente isoladas;
2. rota com autenticação, autorização e comportamento de falha definido;
3. UI protegida por flag, módulo e escopo;
4. staging, produção, smoke e rollback próprios;
5. observabilidade de domínio, versão e dependências.

Estados deste plano: **Operacional** (prova atual em produção), **Piloto restrito** (flag e grants explícitos), **Preparado/inativo** (bloqueio intencional) e **Não comprovado** (não tratar como pronto).

## Baseline operacional

### Runtime nativo

Os sete units finais estavam `active/running`, com `NRestarts=0`:

| Serviço | Responsabilidade | Isolamento atual |
| --- | --- | --- |
| `orb` | n8n/automação | estado PostgreSQL/n8n em `/var/lib/skincos-runtime/orb` |
| `orb-proxy` | proxy/contrato Orb | processo separado; mesma release de fonte |
| `messaging-whatsapp` | único engine WhatsApp suportado | build e estado próprios |
| `crm` | API CRM nativa | estado e log próprios |
| `booking` | integração EF/agenda | venv, navegador e artefatos próprios |
| `cloudflare-orb` | túnel do Orb | configuração privada fora do repo |
| `cloudflare-runtime` | túnel de CRM/Booking/WhatsApp | configuração privada fora do repo |

O runtime usa `/opt/skincos/current/source`; estado, segredos e logs vivem em `/var/lib/skincos-runtime`, `/etc/skincos` e `/var/log/skincos`. O backup Orb mais recente foi publicado em `C:\CodexRuntime\backups\orb\daily\20260723T062014Z`; `SkincosOrbBackup` teve `LastTaskResult=0` às 03:20 BRT.

**Limite de observabilidade:** a ACL do release impede que `admin` resolva o alvo do symlink. Os units confirmam caminho canônico e estado ativo, mas a auditoria não atesta o SHA do release nativo. A promoção precisa publicar manifesto não secreto com SHA e rollback.

### Rotas e superfícies públicas

| Superfície | Evidência | Estado |
| --- | --- | --- |
| `orb.skincos.com.br/healthz` | HTTP 200 | Operacional |
| `crm.skincos.com.br/` e `/health` | HTTP 200 | Operacional |
| `espacofacial.com/` | HTTP 200 | Operacional |
| `wa.skincos.com.br/health` | HTTP 200 | Operacional |
| `api.skincos.com.br/health` | HTTP 200 | Operacional |
| `/inventory/health` | HTTP 200; D1 configurado | Operacional |
| `/api/ponto/health` e `/readiness` | HTTP 200; banco disponível | Operacional |
| `escala-api.skincos.com.br/health` | HTTP 200 | Operacional |
| `/finance/overview` sem sessão | HTTP 401 `UNAUTHORIZED` | rota publicada e fechada para anônimos |

O gateway `api` é a fronteira pública para `/inventory/*`, `/finance/*` e `/api/ponto/*`. Ele mantém transporte, correlação e envelopes: Timekeeping é delegado ao Worker próprio; Finance exige sessão/CSRF e rate limit fail-closed; Inventory é handler próprio.

### Bancos e módulos

| Dono | Persistência | Estado |
| --- | --- | --- |
| Orb | PostgreSQL e storage nativo | operacional; backup com restore verificado |
| CRM, Booking, WhatsApp | estado nativo por serviço | operacional; fora do checkout |
| Gateway, Inventory e Finance | D1 `skincos-db` e `skincos-db-staging` | compartilhado; acoplamento principal |
| Timekeeping | D1 prod e staging próprios | isolado por domínio |
| Escala | D1 prod e staging próprios | isolado por domínio |
| Site | D1 `espacofacial-booking`, Escala e redirector `esfa.co` | operacional, mas pipeline agrupado |

Consulta remota somente leitura confirmou no D1 produtivo:

- migrações Finance `0001`–`0012` presentes;
- `module_enabled=true`;
- dois escopos de unidade ativos;
- um escopo pessoal inativo;
- duas concessões de acesso.

Assim, Finance está em **piloto restrito**, não em rollout global. A UI só o expõe após bootstrap que confirme flag, `allowedModules: finance` e grant de escopo.

| Módulo/domínio | Estado | Observação |
| --- | --- | --- |
| Insumos | Operacional | Worker/D1, CRM e permissões |
| Atendimento e Conversa | Operacional conforme autorização | CRM API + engine WhatsApp único |
| Ponto/Timekeeping | backend operacional | Worker/D1 isolado e rotas prontas; a lista online genérica não libera amplamente `ponto` |
| Escala | backend operacional | Worker/D1 próprio; ver P0 |
| Finance | Piloto restrito | flag, módulo e escopo explícitos; pessoal inativo |
| Meta Ads, Site Tracking, Caixa, Faturamento, Procedimentos, Instagram Studio, Unit Monitor e Meta Pages Review | Preparados/ocultos online | bloqueados por `moduleAvailability.ts` |
| Workflows clínicos Orb | Preparados/inativos | requerem OAuth/escopo Google Calendar, `GOOGLE_CALENDAR_ID` e janela segura |

## Deploys e acoplamentos

| Superfície | Promoção | Independência real | Acoplamento e rollback |
| --- | --- | --- | --- |
| Runtime nativo | archive Windows -> release Linux imutável -> links `current` | restart por unit | fonte comum; rollback reponta links e reinicia só o unit afetado |
| API + Inventory | Core Workers/reconcile | Não | job publica os dois e compartilham D1/DO/R2 |
| Finance | handler no API + UI no CRM Pages | Não | compartilha Worker e D1 core; UI no mesmo projeto Pages |
| Timekeeping | workflow próprio, staging antes de produção | Parcial | Worker/D1 próprios, mas binding do gateway e UI CRM |
| Escala | Worker/D1 próprios | Parcial | CRM Pages requer HMAC compartilhado |
| CRM Pages | workflow por paths | Parcial | UI e proxies de múltiplos domínios no mesmo projeto |
| CRM API nativa | lifecycle é a fonte de verdade | Parcial | deploy SSH desabilitado de propósito; não reativar endpoint HTTP legado |
| Website | OpenNext, legal hub, redirector, URLs D1 e sync de segredos | Não | blast radius sobre booking, tracking e redirects |

A PR #724 foi mergeada com CI, segurança, Timekeeping, CRM Pages e Core Workers verdes. Reconcilers e smokes agendados estavam verdes, salvo o P0 abaixo.

## Plano ordenado P0–P3

### P0 — restaurar o contrato autenticado CRM Pages -> Escala

**Dependências:** dono da chave HMAC e acesso controlado a GitHub/Cloudflare.  
**Risco:** o run `30023498404` falhou: `ESCALA_ACTOR_HMAC_KEY` não existe no ambiente **production** do Pages `skincos`. Health/E2E podem ficar verdes enquanto o caminho autenticado perde continuidade.  
**Mudança:** reconciliar pela rotina oficial, aplicar o redeploy Pages previsto e registrar run/versão. Não rotacionar sem plano que sincronize Worker e Pages.  
**Aceite:** sync verde; chave presente em production e preview; smoke autenticado e `Escala UI E2E` verdes; sem fallback vazio/local/em código.  
**Validação:** `cloudflare-pages-sync-escala.yml`, smoke de Escala e leitura de presença sem imprimir valor.  
**Rollback:** restaurar a versão registrada da chave nos dois lados e redeployar somente superfícies afetadas.

### P1 — concluir a fronteira Finance antes de ampliar a coorte

**Dependências:** P0, backup/rollback D1, dono financeiro piloto e aprovação explícita dos escopos.  
**Risco:** Finance divide `skincos-db` e release do gateway com Inventory; migração/regressão core pode atingir o piloto.  
**Mudança:** migrar Finance para D1 próprio em prod/staging, com binding, migrações, backup, reconciliação, deploy e rollback específicos. O gateway retém apenas auth, CSRF, correlação e rate limit.  
**Aceite:** Finance não usa `skincos-db`; sua migração/deploy/rollback não publica Inventory; testes de scope, idempotência, ledger e importação passam em staging; pessoal segue inativo.  
**Validação:** D1 staging, smoke autenticado de importação/UI com dados seguros, grants agregados e rollback provado.  
**Rollback:** `module_enabled=false`, revogar somente grant piloto se necessário e reverter binding/Worker; nunca apagar ledger/audit.

### P1 — tornar a release nativa auditável

**Dependências:** nenhuma de negócio; mudança pequena no lifecycle.  
**Risco:** runtime saudável não prova SHA ativo nem release de rollback.  
**Mudança:** manifesto não secreto, atômico e somente leitura com SHA, horário, units, release anterior, resultado de validate e backup elegível; expô-lo em `manage-native-runtime.sh status`.  
**Aceite:** operador correlaciona endpoint, unit, SHA e rollback sem ler `/etc/skincos`.  
**Validação:** promoção controlada, `systemctl show`, health local/público e leitura do manifesto.  
**Rollback:** manifesto anterior e repoint atômico; não duplicar código/estado no Windows.

### P2 — separar unidades de entrega com blast radius compartilhado

**Dependências:** fronteira Finance e contratos de API versionados.  
**Risco:** Core Workers e Website agrupam produtos distintos; CRM Pages contém proxies/UI de vários domínios.  
**Mudança:** em PRs independentes, separar API de Inventory; dar pipeline próprio a Finance; separar no Website Worker principal, legal hub, redirector/D1 e sync de segredos.  
**Aceite:** alteração de um domínio não publica outro; cada workflow expõe versão, smoke, skip e rollback.  
**Validação:** paths e dispatch em staging, deployment ID por superfície e simulação de falha de job isolada.  
**Rollback:** versão anterior somente da superfície afetada.

### P2 — formalizar capacidades do CRM

**Dependências:** P0 e contrato de flags consolidado.  
**Risco:** `App.tsx` concentra catálogo, flags e imports lazy; health de backend não equivale à UI disponível ao usuário.  
**Mudança:** manifesto tipado por módulo: owner, rota, flag, `allowedModules`, escopo, UI, smoke, dependências e estado. Migrar um módulo por vez.  
**Aceite:** navegação, gate de deploy e smoke derivam do mesmo registro; Ponto e Finance têm estado verificável.  
**Validação:** testes de acesso autorizado/negado, browser headless e contratos de API.  
**Rollback:** adaptador do catálogo antigo durante cada migração.

### P3 — institucionalizar continuidade

**Dependências:** P0/P1 concluídos e owners definidos.  
**Risco:** baseline envelhece e acoplamentos reaparecem por conveniência.  
**Mudança:** revisão trimestral que rejeite import direto entre domínios, D1 sem owner, rota fora do gateway, unit fora do lifecycle ou deploy sem smoke/rollback; game day semestral de Worker, Pages e unit nativo.  
**Aceite:** relatório de detecção/recuperação, versão restaurada e ação corretiva; inventário atualizado a cada release estrutural.  
**Validação:** staging e evidência privada de restore; produção apenas com janela aprovada.  
**Rollback:** exercícios não alteram dados produtivos.

## Ordem obrigatória

1. Fechar P0 e comprovar a cadeia autenticada de Escala.
2. Publicar evidência de SHA/rollback do runtime nativo.
3. Preparar D1 e pipeline Finance isolados em staging; provar migration e rollback.
4. Migrar Finance e ampliar coorte somente por unidade/grant explícito.
5. Separar Core Workers e etapas do Website em pipelines individuais.
6. Introduzir manifesto de capacidades CRM gradualmente.
7. Transformar controles em gates recorrentes e executar game days.

## Evidências desta auditoria

Em `2151a49d`, `npm run architecture:validate` e `npm run quality:security` passaram. Foram preservados os artefatos não rastreados do checkout compartilhado (`crm-local-gate-*.json` e `crm-local-smoke-artifacts/`); este documento foi criado em worktree isolado.

