# Multi‑Instâncias WhatsApp (Portas Reservadas 3001–3009)

Este projeto reserva estritamente as portas **3001 até 3009** para até **9 instâncias locais** do gateway WhatsApp. Nenhum outro serviço deve escutar nessas portas.

## Visão Geral

| Instância | Porta | Sessão (auth path)           | Log              | PID File                 |
|-----------|-------|------------------------------|------------------|--------------------------|
| 1         | 3001  | .wwebjs_auth_local_1         | local_1.out      | .local_instance_1.pid    |
| 2         | 3002  | .wwebjs_auth_local_2         | local_2.out      | .local_instance_2.pid    |
| 3         | 3003  | .wwebjs_auth_local_3         | local_3.out      | .local_instance_3.pid    |
| 4         | 3004  | .wwebjs_auth_local_4         | local_4.out      | .local_instance_4.pid    |
| 5         | 3005  | .wwebjs_auth_local_5         | local_5.out      | .local_instance_5.pid    |
| 6         | 3006  | .wwebjs_auth_local_6         | local_6.out      | .local_instance_6.pid    |
| 7         | 3007  | .wwebjs_auth_local_7         | local_7.out      | .local_instance_7.pid    |
| 8         | 3008  | .wwebjs_auth_local_8         | local_8.out      | .local_instance_8.pid    |
| 9         | 3009  | .wwebjs_auth_local_9         | local_9.out      | .local_instance_9.pid    |

Todos os processos devem falhar imediatamente se a porta reservada estiver ocupada por algo diferente do gateway (nenhum fallback automático). Isso garante previsibilidade para o CRM.

## Script Principal

Use `./manage-instances.sh` para gerenciar todas as instâncias:

```
./manage-instances.sh start <N|all>
./manage-instances.sh stop <N|all>
./manage-instances.sh restart <N|all>
./manage-instances.sh status
./manage-instances.sh logs <N>
./manage-instances.sh tail <N>
./manage-instances.sh clean   # Remove sessões e pids (1..9)
```

Exemplos:

```
./manage-instances.sh start 1      # Inicia instância 1 (3001)
./manage-instances.sh start all    # Inicia 1..9
./manage-instances.sh status       # Mostra estado de cada instância
./manage-instances.sh stop 3       # Para instância 3
./manage-instances.sh clean        # Para tudo e apaga credenciais locais
```

## Script Legado de Segunda Instância

`start_second_instance.sh` permanece apenas por compatibilidade antiga e **sempre** inicia na porta 3002. Prefira o script unificado.

## QR Code e Status

Para cada instância: `http://localhost:<PORTA>/qr.html` e `http://localhost:<PORTA>/status`.

## Integração Frontend / CRM

O frontend deve permitir seleção de instância ou leitura de uma lista configurável (ex: variável de ambiente `VITE_WHATSAPP_INSTANCES=3001,3002,3003`). Fallback fixo em apenas 3001 não é mais suficiente para monitoramento multi-conta.

Sugestão de estratégia:

1. Definir variável `VITE_WHATSAPP_GATEWAY_PORTS=3001,3002,3003`.
2. No carregamento do painel, criar lista de bases: `ports.split(',').map(p => \
	({ port: p, base: \
	`${window.location.protocol}//${window.location.hostname}:${p}` }))`.
3. Permitir trocar instância via dropdown; manter instância selecionada em `localStorage`.
4. Abrir conexões SSE por instância ou somente quando ativa.

## Boas Práticas

* Nunca reutilize as portas 3001–3009 para API do CRM ou outros serviços.
* Antes de subir ambiente, rode `lsof -nP -iTCP:3001-3009 -sTCP:LISTEN` para garantir limpeza.
* Caso uma instância não precise mais existir, use `stop` e depois `clean` para remover sessão.
* Para resetar uma instância específica, apague apenas o diretório `.wwebjs_auth_local_N` correspondente (instância parada) e reinicie.

## Troubleshooting Rápido

| Sintoma | Causa Provável | Ação |
|---------|----------------|------|
| Porta em uso ao iniciar | Processo zumbi antigo | `lsof -nP -iTCP:300X`, matar PID e reiniciar |
| QR não aparece | Cache corrompido de sessão | Parar instância, remover diretório de auth e iniciar novamente |
| Mensagens não enviam | Sessão não conectada após login | Verificar `/status` e refazer scan do QR |
| Fallback antigo mudava porta | Script legacy usava busca dinâmica | Atualize para `manage-instances.sh` |

## Próximos Passos (Roadmap)

* Dropdown de seleção de instância no painel.
* Monitoramento consolidado (métricas agregadas de todas as instâncias).
* Health-check periódica e auto-restart opcional.
* Integração de fila de envio em massa distribuída por instância.

---

Documento gerado automaticamente para padronizar operação multi-instâncias.
