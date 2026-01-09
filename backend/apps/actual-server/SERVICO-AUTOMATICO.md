# 🚀 Actual Budget - Serviço de Inicialização Automática

## ✅ Status: INSTALADO E RODANDO

O Actual Budget agora está configurado para:
- ✅ Rodar automaticamente em segundo plano
- ✅ Iniciar quando você ligar o computador
- ✅ Reiniciar automaticamente se cair
- ✅ Manter logs de todas as operações

---

## 📋 Gerenciamento do Serviço

### 🎯 Menu Interativo (FORMA MAIS FÁCIL)

```bash
cd backend/apps/actual-server
./service-manager.sh
```

Este menu oferece:
1. Instalar serviço (inicialização automática)
2. Desinstalar serviço
3. Iniciar serviço
4. Parar serviço
5. Reiniciar serviço
6. Ver status do serviço
7. Ver logs (stdout)
8. Ver logs (stderr)
9. Limpar logs
10. Testar configuração
11. Abrir no navegador

---

## 🔧 Comandos Manuais do launchctl

### Verificar status
```bash
launchctl list | grep actualbudget
```

### Iniciar serviço
```bash
launchctl start com.actualbudget.server
```

### Parar serviço
```bash
launchctl stop com.actualbudget.server
```

### Descarregar serviço (parar e remover da inicialização)
```bash
launchctl unload ~/Library/LaunchAgents/com.actualbudget.server.plist
```

### Carregar serviço (adicionar à inicialização)
```bash
launchctl load ~/Library/LaunchAgents/com.actualbudget.server.plist
```

### Reiniciar serviço
```bash
launchctl stop com.actualbudget.server && launchctl start com.actualbudget.server
```

---

## 📊 Monitoramento

### Verificar se está rodando
```bash
lsof -Pi :5006 -sTCP:LISTEN
```

### Ver logs em tempo real (stdout)
```bash
tail -f backend/apps/actual-server/logs/actual-budget-stdout.log
```

### Ver logs em tempo real (stderr)
```bash
tail -f backend/apps/actual-server/logs/actual-budget-stderr.log
```

### Ver últimas 50 linhas dos logs
```bash
tail -n 50 backend/apps/actual-server/logs/actual-budget-stdout.log
```

---

## 🌐 Acessar o Aplicativo

O servidor está sempre rodando em:
```
http://localhost:5006
```

---

## 📁 Arquivos Importantes

| Arquivo | Localização | Descrição |
|---------|-------------|-----------|
| **Configuração do Serviço** | `~/Library/LaunchAgents/com.actualbudget.server.plist` | Arquivo de configuração do launchd |
| **Logs stdout** | `backend/apps/actual-server/logs/actual-budget-stdout.log` | Saída padrão do servidor |
| **Logs stderr** | `backend/apps/actual-server/logs/actual-budget-stderr.log` | Erros do servidor |
| **Dados** | `backend/apps/actual-server/server-files/` | Seus dados financeiros |
| **Script de Gerenciamento** | `backend/apps/actual-server/service-manager.sh` | Menu interativo |

---

## 🔄 Configuração do Serviço

O serviço está configurado para:

- **Inicialização automática**: ✅ Sim (ao fazer login)
- **Manter rodando**: ✅ Sim (reinicia se cair)
- **Porta**: 5006
- **Delay de inicialização**: 10 segundos (aguarda rede)
- **Throttle de reinicialização**: 30 segundos

### Variáveis de Ambiente Configuradas:
- `NODE_ENV=production`
- `ACTUAL_PORT=5006`
- `ACTUAL_HOSTNAME=0.0.0.0`

---

## 🛠️ Solução de Problemas

### Serviço não inicia

1. Verificar logs de erro:
```bash
cat backend/apps/actual-server/logs/actual-budget-stderr.log
```

2. Testar configuração:
```bash
cd backend/apps/actual-server
./service-manager.sh
# Escolher opção 10 (Testar configuração)
```

3. Reiniciar serviço:
```bash
launchctl unload ~/Library/LaunchAgents/com.actualbudget.server.plist
launchctl load ~/Library/LaunchAgents/com.actualbudget.server.plist
```

### Porta já em uso

Se a porta 5006 já estiver em uso, você pode:

1. Editar o arquivo plist:
```bash
nano ~/Library/LaunchAgents/com.actualbudget.server.plist
```

2. Alterar a linha:
```xml
<key>ACTUAL_PORT</key>
<string>5006</string>
```

3. Recarregar o serviço:
```bash
launchctl unload ~/Library/LaunchAgents/com.actualbudget.server.plist
launchctl load ~/Library/LaunchAgents/com.actualbudget.server.plist
```

### Ver processos relacionados

```bash
ps aux | grep actual
ps aux | grep node
```

### Matar processos manualmente (último recurso)

```bash
# Encontrar o PID
lsof -Pi :5006 -sTCP:LISTEN -t

# Matar o processo (substitua PID pelo número)
kill -9 PID
```

---

## 🔒 Segurança

- O serviço roda com suas permissões de usuário
- Os dados ficam em `backend/apps/actual-server/server-files/` (padrão)
- Faça backups regulares usando o `service-manager.sh`

---

## 📦 Backup e Restauração

### Backup Manual
```bash
cd backend/apps/actual-server
tar -czf ~/Automation/actual-backup-$(date +%Y%m%d).tar.gz server-files/
```

### Restaurar Backup
```bash
cd backend/apps/actual-server
launchctl stop com.actualbudget.server
tar -xzf ~/Automation/actual-backup-YYYYMMDD.tar.gz
launchctl start com.actualbudget.server
```

---

## 🔄 Atualização

Para atualizar o Actual Budget:

```bash
# Parar o serviço
launchctl stop com.actualbudget.server

# Atualizar código
cd backend/apps/actual-server
git pull origin master
yarn install

# Iniciar o serviço
launchctl start com.actualbudget.server
```

Ou use o menu interativo (opção 8 do manage-actual-budget.sh).

---

## 🗑️ Desinstalar Completamente

```bash
# 1. Descarregar serviço
launchctl unload ~/Library/LaunchAgents/com.actualbudget.server.plist

# 2. Remover arquivo plist
rm ~/Library/LaunchAgents/com.actualbudget.server.plist

# 3. (Opcional) Remover dados locais (mantém o código no monorepo)
rm -rf backend/var/actual-server backend/apps/actual-server/server-files backend/apps/actual-server/user-files backend/apps/actual-server/logs
```

Ou use o script de gerenciamento:
```bash
cd backend/apps/actual-server
./service-manager.sh
# Escolher opção 2 (Desinstalar serviço)
```

---

## 💡 Dicas

1. **Use o menu interativo**: É a forma mais fácil de gerenciar tudo
2. **Monitore os logs**: Ajuda a identificar problemas rapidamente
3. **Faça backups regulares**: Seus dados financeiros são importantes
4. **Teste após atualizações**: Sempre verifique se está funcionando após atualizar

---

## ✨ Recursos Automáticos

- ✅ Inicia automaticamente ao ligar o computador
- ✅ Reinicia se o processo cair
- ✅ Aguarda rede estar disponível antes de iniciar
- ✅ Logs automáticos de todas as operações
- ✅ Gerenciamento fácil via menu interativo

---

**Status Atual**: 🟢 RODANDO
**URL**: http://localhost:5006
**Última atualização**: 10 de outubro de 2025

---

Para qualquer dúvida, execute:
```bash
cd backend/apps/actual-server
./service-manager.sh
```
