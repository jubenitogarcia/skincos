# 💾 Sessão Persistente - Sprinta Automation

## ✨ O que mudou?

A automação agora possui **SESSÃO PERSISTENTE**! Isso significa que você **NÃO precisa fazer login toda vez** que executar o script! 🚀

## 🎯 Como funciona?

### 1️⃣ Perfil Persistente do Chrome

O script agora cria um perfil especial do Chrome em:
```
/Users/jubenitogarcia/Downloads/Sprinta/chrome_profile_sprinta/
```

Este perfil salva:
- ✅ Cookies de sessão
- ✅ Login ativo
- ✅ Configurações do navegador
- ✅ Cache

### 2️⃣ Verificação Automática de Login

Antes de tentar fazer login, o script:
1. 🔍 Abre a página do evento
2. 🔍 Verifica se há um botão de "Login/Entrar"
3. ✅ Se **NÃO** encontrar = já está logado → **pula o login**
4. 🔐 Se **encontrar** = não está logado → **faz o login**

## 📊 Comparação de Tempo

### SEM Sessão Persistente:
```
🔐 Login: ~10-15 segundos
📝 Processo de inscrição: ~30 segundos
⏱️  Total por participante: ~40-45 segundos
```

### COM Sessão Persistente (2ª execução em diante):
```
✅ Login: 0 segundos (pulado!)
📝 Processo de inscrição: ~30 segundos
⏱️  Total por participante: ~30 segundos
```

**Economia: ~25% mais rápido! ⚡**

## 🚀 Como usar?

### Execução normal (com sessão persistente):
```bash
python sprinta_automation.py
```

### Primeira vez:
- Vai fazer login normalmente
- Salva a sessão no perfil do Chrome
- Processa os participantes

### Próximas vezes:
- Detecta que já está logado
- **Pula o login completamente**
- Vai direto para o processamento

## ⚙️ Configurações

No final do arquivo `sprinta_automation.py`:

```python
if __name__ == "__main__":
    process_csv(
        "participants.csv",
        "checkout_urls.csv",
        debug_mode=True,              # Ver o navegador com pausas
        use_persistent_session=True   # Manter login (RECOMENDADO)
    )
```

### Opções:

| Parâmetro | Valor | Descrição |
|-----------|-------|-----------|
| `debug_mode` | `True` | Mostra o navegador com pausas |
| `debug_mode` | `False` | Execução rápida, sem pausas |
| `use_persistent_session` | `True` | **Mantém login** (recomendado) |
| `use_persistent_session` | `False` | Faz login toda vez |

## 🔄 Quando o login será necessário?

O script fará login novamente automaticamente se:
- ❌ A sessão expirou (geralmente após alguns dias)
- ❌ Você deletou a pasta `chrome_profile_sprinta/`
- ❌ Configurou `use_persistent_session=False`
- ❌ Mudou as credenciais de login

## 🗑️ Resetar sessão

Se quiser forçar um novo login, delete a pasta do perfil:

```bash
rm -rf chrome_profile_sprinta/
```

Na próxima execução, fará login novamente e criará um novo perfil.

## 📁 Estrutura de arquivos

```
Sprinta/
├── sprinta_automation.py       # Script principal
├── test_login_debug.py         # Teste de login
├── participants.csv            # Dados dos participantes
├── checkout_urls.csv           # URLs geradas
├── chrome_profile_sprinta/     # 💾 PERFIL PERSISTENTE (novo!)
│   ├── Default/
│   │   ├── Cookies
│   │   ├── Local Storage/
│   │   └── ...
│   └── ...
└── DEBUG_README.md             # Guia de debug
```

## 🎉 Benefícios

✅ **Economia de tempo** - Pula login nas próximas execuções
✅ **Menos requisições** - Reduz carga no servidor
✅ **Mais confiável** - Menos chances de erro no login
✅ **Facilidade de uso** - Funciona automaticamente
✅ **Flexível** - Pode desativar se necessário

## 🧪 Testar sessão persistente

Use o script de teste para verificar:

```bash
python test_login_debug.py
```

**1ª execução:** Fará login e salvará sessão
**2ª execução:** Detectará que já está logado! ✨

## 💡 Dicas

1. **Primeira execução do dia**: Execute uma vez para garantir que a sessão está ativa
2. **Múltiplos CSVs**: Processe vários arquivos sem precisar fazer login múltiplas vezes
3. **Depuração**: Se algo der errado, delete o perfil e deixe criar um novo
4. **Segurança**: O perfil fica local na sua máquina, não é compartilhado

## ⚠️ Observações

- O perfil do Chrome ocupa ~50-100MB de espaço
- Não commite a pasta `chrome_profile_sprinta/` no git (contém dados de sessão)
- A sessão do Sprinta pode expirar após alguns dias de inatividade
- Se mudar de computador, precisará fazer login novamente

---

**Desenvolvido com ❤️ para otimizar suas inscrições no Sprinta!**
