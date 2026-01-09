# Actual Budget - Guia de Instalação e Uso

## 📋 Sobre o Actual Budget

Actual Budget é uma ferramenta de finanças pessoais gratuita e de código aberto. É local-first, o que significa que seus dados ficam no seu computador e você tem controle total sobre eles.

## ✅ Pré-requisitos

- Node.js versão 18 ou superior (você tem v24.8.0 ✓)
- Yarn (gerenciador de pacotes)

## 🚀 Como Iniciar

### Opção 1: Usar o script automático (RECOMENDADO)

```bash
cd backend/apps/actual-server
./start-actual-budget.sh
```

Este script irá:
- Verificar se todas as dependências estão instaladas
- Executar as migrações do banco de dados
- Iniciar o servidor automaticamente
- Mostrar a URL para acessar o aplicativo

### Opção 2: Iniciar manualmente

```bash
cd backend/apps/actual-server

# Instalar dependências (primeira vez)
yarn install

# Executar migrações do banco de dados
yarn db:migrate

# Iniciar o servidor
yarn start
```

## 🌐 Acessando o Aplicativo

Após iniciar o servidor, acesse no seu navegador:

```
http://localhost:5006
```

## 🔧 Configurações Personalizadas

Você pode personalizar o comportamento do servidor através de variáveis de ambiente:

```bash
# Mudar a porta (padrão: 5006)
export ACTUAL_PORT=3000

# Mudar o diretório de dados (padrão: ./server-files)
export ACTUAL_SERVER_FILES=/caminho/para/seus/dados

# Depois execute o script
./start-actual-budget.sh
```

## 📁 Estrutura de Arquivos

- `server-files/` - Diretório onde seus dados financeiros são armazenados
- `app.js` - Arquivo principal da aplicação
- `start-actual-budget.sh` - Script de inicialização automática

## 🛑 Como Parar o Servidor

Pressione `Ctrl+C` no terminal onde o servidor está rodando.

## 🔑 Primeiro Acesso

Na primeira vez que acessar o Actual Budget:

1. Acesse `http://localhost:5006`
2. Você será solicitado a criar uma senha para proteger seus dados
3. Crie seu primeiro orçamento e comece a gerenciar suas finanças!

## 📊 Recursos Principais

- ✅ Orçamento baseado em envelope (zero-based budgeting)
- ✅ Sincronização entre dispositivos (opcional)
- ✅ Importação de extratos bancários
- ✅ Relatórios e gráficos
- ✅ Metas de economia
- ✅ Rastreamento de investimentos
- ✅ Totalmente offline

## 🆘 Solução de Problemas

### Porta já em uso

Se a porta 5006 já estiver em uso, você pode mudar:

```bash
export ACTUAL_PORT=5007
./start-actual-budget.sh
```

### Resetar senha

Se você esquecer sua senha:

```bash
cd backend/apps/actual-server
yarn reset-password
```

### Limpar dados e começar do zero

**ATENÇÃO: Isso apagará todos os seus dados!**

```bash
cd backend/apps/actual-server
rm -rf server-files
./start-actual-budget.sh
```

## 📚 Documentação Oficial

- Site: https://actualbudget.org/
- Documentação: https://actualbudget.org/docs/
- GitHub: https://github.com/actualbudget/actual

## 🎉 Dicas de Uso

1. **Faça backup regularmente**: A pasta `server-files/` contém todos os seus dados
2. **Use categorias**: Organize suas despesas em categorias para melhor controle
3. **Reconcilie suas contas**: Compare seus registros com extratos bancários regularmente
4. **Configure metas**: Use metas de economia para objetivos de longo prazo

## 🔄 Atualizações

Para atualizar o Actual Budget para a versão mais recente:

```bash
cd backend/apps/actual-server
git pull origin master
yarn install
./start-actual-budget.sh
```

---

**Criado em:** 10 de outubro de 2025
**Localização:** `backend/apps/actual-server` (dentro do repo skincos)
