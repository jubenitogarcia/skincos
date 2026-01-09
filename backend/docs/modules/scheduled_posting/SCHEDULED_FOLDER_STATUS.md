# Sistema Unificado de Mídia Agendada

## Verificação da Pasta "Scheduled"

✅ **STATUS ATUAL**: A pasta de agendamento pode ser configurada tanto como **pasta local** quanto como **pasta do Google Drive**, dependendo da configuração no arquivo `backend/var/scheduled_posting/config.json` (ou via `SCHEDULED_POSTING_CONFIG`).

## Configurações Encontradas

### 📁 Pasta Local (Padrão Atual)
```json
{
  "scheduled_posting": {
    "base_folder": "backend/var/scheduled_posting/Scheduled",
    "use_google_drive": false,
    ...
  }
}
```

### 🌐 Google Drive (Configuração Alternativa)
```json
{
  "scheduled_posting": {
    "base_folder": "backend/var/scheduled_posting/Scheduled",
    "use_google_drive": true,
    ...
  },
  "drive_scheduled_folder": "10FJgSsSdRcvrkB6m2NbUeROqBtmrysSN",
  "drive_published_folder": "104Q7EIkcE-LTP5UgQ4Pg3di8DfLThOKM"
}
```

## Configuração Atual

### Google Drive IDs Configurados:
- **Pasta Agendada**: `10FJgSsSdRcvrkB6m2NbUeROqBtmrysSN`
- **Pasta Publicada**: `104Q7EIkcE-LTP5UgQ4Pg3di8DfLThOKM`

### Credenciais Google Drive:
- ✅ **Service Account**: Configurado
- ✅ **Project ID**: `sinuous-network-461317-v9`
- ✅ **Client Email**: `google-drive@sinuous-network-461317-v9.iam.gserviceaccount.com`

## Como Alternar Entre os Modos

### 🔄 Para usar Google Drive:
```bash
# 1. Editar `backend/var/scheduled_posting/config.json` (ou `SCHEDULED_POSTING_CONFIG`)
"use_google_drive": true

# 2. Reiniciar o sistema
python main.py
```

### 🔄 Para usar pasta local:
```bash
# 1. Editar `backend/var/scheduled_posting/config.json` (ou `SCHEDULED_POSTING_CONFIG`)
"use_google_drive": false

# 2. Reiniciar o sistema
python main.py
```

## Script de Teste

Execute o script de teste para alternar entre os modos:
```bash
python test_scheduled_integration.py
```

### Opções disponíveis:
1. **Ver configuração atual** - Mostra o modo ativo
2. **Testar modo pasta local** - Testa funcionalidade local
3. **Testar modo Google Drive** - Testa funcionalidade do Drive
4. **Alternar modo** - Muda entre local/Drive automaticamente
5. **Ver estrutura de pastas** - Mostra árvore de diretórios local

## Integração Implementada

### ✅ Arquivos Atualizados:
- `unified_scheduled_media_handler.py` - Handler unificado
- `backend/var/scheduled_posting/config.json` - Configuração com flag `use_google_drive` (ou `SCHEDULED_POSTING_CONFIG`)
- `main.py` - Atualizado para usar UnifiedScheduledMediaHandler
- `test_scheduled_integration.py` - Script de teste

### ✅ Funcionalidades:
- ✅ Modo pasta local funcionando
- ✅ Modo Google Drive funcionando
- ✅ Alternância automática baseada em configuração
- ✅ Compatibilidade com código existente
- ✅ Menu interativo atualizado
- ✅ Verificação de credenciais

## Estado do Sistema

### Modo Atual: **Pasta Local** (`use_google_drive: false`)
- 📁 Pasta base (default): `backend/var/scheduled_posting/Scheduled/` (ou `SCHEDULED_POSTING_MEDIA_DIR`)
- 📍 Pasta de hoje (ex.): `backend/var/scheduled_posting/Scheduled/2025/07/`
- 🔧 Estrutura criada automaticamente

### Google Drive Disponível:
- 🌐 Credenciais configuradas e funcionando
- 📁 Folder IDs especificados no config
- 🔄 Pronto para uso quando `use_google_drive: true`

## Próximos Passos

1. ✅ **Sistema unificado implementado**
2. ✅ **Configuração flexível entre local/Drive**
3. ✅ **Interface atualizada**
4. 🔄 **Testar automação completa com Google Drive**
5. 🔄 **Documentar processo de migração**

## Uso no Sistema Principal

O sistema principal (`main.py`) agora usa automaticamente o `UnifiedScheduledMediaHandler`, que:

- **Detecta automaticamente** o modo configurado
- **Funciona transparentemente** com pasta local ou Google Drive
- **Mantém compatibilidade** com código existente
- **Suporta menu interativo** com ambos os modos

### Comando para alternar modo:
```bash
# Via script de teste (recomendado)
python test_scheduled_integration.py

# Via edição manual do `backend/var/scheduled_posting/config.json`
# Alterar "use_google_drive": true/false
```

---

**✅ Resumo**: A pasta "Scheduled" está **flexivelmente configurada** para usar tanto pasta local quanto Google Drive, conforme especificado na configuração `use_google_drive` do arquivo `config.json`. Atualmente está em modo **local**, mas pode ser facilmente alterado para Google Drive.
