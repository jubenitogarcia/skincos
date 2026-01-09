# Remover segredos do repositório e migrar para GitHub Secrets

O arquivo `.env` está presente no repositório com credenciais sensíveis de Cloudinary expostas. Execute os passos:

- Remover `.env` do repositório e adicionar ao `.gitignore`.
- Purgar o histórico do git para remover qualquer vestígio do arquivo.
- Revogar as credenciais atuais e cadastrar novas no Cloudinary.
- Migrar variáveis sensíveis para GitHub Secrets.
- Criar `.env.example` com estrutura esperada.
- Atualizar README explicando como configurar ambiente local de forma segura.
