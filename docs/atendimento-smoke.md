# Atendimento — Smoke Test

## Pré-condições
- Usuário **Admin** e usuário **Restrito** (somente uma permissão legada: ex. `whatsapp-n8n`).
- Acesso ao frontend CRM.

## Cenários

### 1) Acesso e visibilidade por permissão
1. Entrar com usuário **Restrito** com `allowedModules=["whatsapp-n8n"]`.
2. Abrir a aba **Atendimento**.
3. Verificar que **somente** a subaba `WhatsApp n8n` aparece.
4. Entrar com usuário **Admin**.
5. Verificar que todas as 5 subabas aparecem.

**Aceite**
- Restrito vê 1 subaba.
- Admin vê 5 subabas.

### 2) Deep‑link
1. Abrir URL com `?atendimento=whatsapp-n8n`.
2. Confirmar que a subaba `WhatsApp n8n` abre.
3. Recarregar a página e confirmar a mesma subaba.

**Aceite**
- Deep‑link abre a subaba correta.
- Recarregar mantém a subaba.

### 3) Persistência local
1. Selecionar a subaba `Harmonia`.
2. Fechar e reabrir o navegador.
3. Confirmar que `Harmonia` é a subaba ativa.

**Aceite**
- Subaba persistida via `localStorage`.

### 4) Omnichannel sem dados
1. Entrar na subaba `Omnichannel`.
2. Confirmar mensagem de estado vazio.

**Aceite**
- Não há métricas/insights fictícios.
- Mensagem “Sem atividades” visível.

### 5) Resiliência por subaba
1. Simular falha de import em um submódulo (ex.: renomear import localmente).
2. Verificar que apenas a subaba com erro mostra fallback.
3. Trocar para outra subaba e confirmar que funciona.

**Aceite**
- Erro isolado por subaba.
- Atendimento permanece navegável.
