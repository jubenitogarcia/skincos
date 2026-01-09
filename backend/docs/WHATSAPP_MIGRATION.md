# Configuração da API WhatsApp

## Substituição do Umbler

A automação de gráficos/vendas (Sales Chart Messenger) foi migrada do Umbler para WhatsApp API. Esta mudança permite maior flexibilidade e controle sobre o envio de mensagens.

## Configuração Necessária

### 1. Configurar a API WhatsApp no config.json

Edite o arquivo `config.json` e configure a seção `whatsapp_config`:

```json
{
  "whatsapp_config": {
    "api_url": "https://sua-instancia-whatsapp.com/api",
    "api_key": "SUA_CHAVE_API_AQUI",
    "instance_id": "SEU_ID_INSTANCIA_AQUI"
  },
  "global": {
    "test_phone_number": "+555195103563",
    "production_phone_number": "+5551999999999"
  }
}
```

### 2. Endpoints da API

O sistema espera que sua instância WhatsApp API tenha os seguintes endpoints:

- `POST /send-message` - Envio de mensagens de texto
- `POST /send-media` - Envio de mídia com legenda
- `GET /status` - Verificação de status da instância

### 3. Formato das Requisições

#### Envio de Mensagem de Texto
```json
{
  "phone": "+555195103563",
  "message": "Sua mensagem aqui",
  "instance_id": "id_da_instancia"
}
```

#### Envio de Mídia
```json
{
  "phone": "+555195103563",
  "media_url": "https://exemplo.com/imagem.png",
  "caption": "Legenda da imagem",
  "instance_id": "id_da_instancia"
}
```

### 4. Headers Esperados

```
Authorization: Bearer SUA_CHAVE_API_AQUI
Content-Type: application/json
```

## Teste da Configuração

Após configurar, teste o sistema com:

```bash
python test_whatsapp.py +555195103563 "Mensagem de teste"
```

## Mudanças Principais

1. **Removida dependência do Umbler** - Toda pasta `umbler/` pode ser removida
2. **Nova pasta `whatsapp/`** - Contém a nova integração
3. **Configuração atualizada** - `whatsapp_config` substitui `umbler_config`
4. **Números de telefone** - Sistema agora trabalha diretamente com números
5. **Mídia simplificada** - Uso de URLs públicas em vez de upload para plataforma

## Benefícios da Migração

- ✅ Maior controle sobre a API
- ✅ Flexibilidade na escolha da instância WhatsApp
- ✅ Envio direto para números de telefone
- ✅ Sistema mais modular e independente
- ✅ Logs mais claros e específicos
