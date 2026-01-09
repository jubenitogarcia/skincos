# 📋 Novo Formato de CSV - Google Sheets Integration

## 🆕 Formato Atualizado (A partir de Outubro 2025)

A automação agora suporta **dois formatos de CSV**:

### Formato 1: Novo (Google Sheets) - RECOMENDADO

**Colunas (A-K):**

| Col | Campo | Exemplo | Descrição |
|-----|-------|---------|-----------|
| A | DATA | 2025-10-04 | Data da inscrição |
| B | ID | inscricao_001 | ID único da submissão (para webhook) |
| C | NOME | João | Primeiro nome |
| D | SOBRENOME | Silva | Sobrenome/Último nome |
| E | EMAIL | joao@email.com | Email do participante |
| F | TELEFONE | 51999887766 | Telefone (apenas números) |
| G | CPF | 12345678900 | CPF (11 dígitos) |
| H | GENERO | Masculino | Gênero (Masculino/Feminino/M/F) |
| I | CORRIDA | 5K | Modalidade/Equipe |
| J | DATA_NASC | 15/03/1990 | Data de nascimento (DD/MM/AAAA) |
| K | TAMANHO | G | Tamanho da camiseta (PP/P/M/G/GG/XG) |

**Exemplo de arquivo CSV:**
```csv
DATA,ID,NOME,SOBRENOME,EMAIL,TELEFONE,CPF,GENERO,CORRIDA,DATA_NASC,TAMANHO
2025-10-04,inscricao_001,João,Silva,joao@email.com,51999887766,12345678900,Masculino,5K,15/03/1990,G
2025-10-04,inscricao_002,Maria,Santos,maria@email.com,51988776655,98765432100,Feminino,10K,20/08/1992,M
```

### Formato 2: Antigo (Compatibilidade)

**Colunas:**
- name, email, phone, cpf, bday, gender, shirt_size, team

**Exemplo:**
```csv
name;email;phone;cpf;bday;gender;shirt_size;team
João Silva;joao@email.com;51999887766;12345678900;15/03/1990;m;G;Equipe A
```

---

## 🔄 Detecção Automática de Formato

A automação detecta **automaticamente** qual formato está sendo usado:

```python
# Detecta presença de colunas do novo formato
is_new_format = 'NOME' in row or 'ID' in row

if is_new_format:
    # Processa formato novo
    nome_completo = f"{row['NOME']} {row['SOBRENOME']}"
else:
    # Processa formato antigo
    nome_completo = row['name']
```

---

## 🗺️ Mapeamento de Campos

### Novo Formato → Sistema Sprinta

| Campo CSV | Campo Interno | Transformação |
|-----------|---------------|---------------|
| NOME + SOBRENOME | name | Concatena: "NOME SOBRENOME" |
| EMAIL | email | Direto |
| TELEFONE | phone | Direto |
| CPF | cpf | Direto (adiciona zeros à esquerda se necessário) |
| DATA_NASC | bday | Direto (formato DD/MM/AAAA) |
| GENERO | gender | Mapeia: Masculino→m, Feminino→f |
| TAMANHO | shirt_size | Direto |
| CORRIDA | team | Direto (usado como nome da equipe) |
| ID | submission_id | Usado para webhook Wix |

### Mapeamento de Gênero

| Valor no CSV | Valor Interno | Aceito |
|--------------|---------------|--------|
| Masculino | m | ✅ |
| masculino | m | ✅ |
| M | m | ✅ |
| male | m | ✅ |
| Feminino | f | ✅ |
| feminino | f | ✅ |
| F | f | ✅ |
| female | f | ✅ |

---

## 📊 Exemplo Completo do Novo Formato

```csv
DATA,ID,NOME,SOBRENOME,EMAIL,TELEFONE,CPF,GENERO,CORRIDA,DATA_NASC,TAMANHO
2025-10-04,inscricao_12345,João,Silva,joao.silva@email.com,51999887766,12345678900,Masculino,5K - Recreativa,15/03/1990,G
2025-10-04,inscricao_12346,Maria,Santos,maria.santos@email.com,51988776655,98765432100,Feminino,10K - Competitiva,20/08/1992,M
2025-10-04,inscricao_12347,Pedro,Oliveira,pedro@email.com,51977665544,11122233344,M,5K - Recreativa,10/05/1985,GG
2025-10-04,inscricao_12348,Ana,Costa,ana.costa@email.com,51966554433,55566677788,F,Meia Maratona,25/12/1988,P
```

---

## 🧪 Testar Novo Formato

### 1. Criar CSV de Teste

Use o arquivo de exemplo fornecido: `participants_novo_formato.csv`

### 2. Executar Automação

```bash
python sprinta_automation.py participants_novo_formato.csv
```

### 3. Verificar Logs

A automação mostrará:

```
📋 PROCESSANDO PARTICIPANTE 1: João Silva
📧 ID: inscricao_001 | Email: joao.silva@email.com
======================================================================
```

---

## 🔗 Integração com Google Sheets

### Fluxo Completo

```
Google Sheets → Export CSV → GitHub → Actions → Automação → Webhook Wix
```

1. **Formulário Wix** preenche Google Sheets
2. **Google Apps Script** exporta linha como CSV
3. **GitHub API** cria arquivo em `inscricoes/`
4. **GitHub Actions** detecta novo arquivo
5. **Automação** processa com novo formato
6. **Webhook** notifica Wix com resultado

### Código Google Apps Script (Exemplo)

```javascript
// Exportar linha do Google Sheets como CSV
function exportarComoCSV(linha) {
  const headers = ['DATA', 'ID', 'NOME', 'SOBRENOME', 'EMAIL',
                   'TELEFONE', 'CPF', 'GENERO', 'CORRIDA',
                   'DATA_NASC', 'TAMANHO'];

  const dados = [
    linha[0],  // DATA
    linha[1],  // ID
    linha[2],  // NOME
    linha[3],  // SOBRENOME
    linha[4],  // EMAIL
    linha[5],  // TELEFONE
    linha[6],  // CPF
    linha[7],  // GENERO
    linha[8],  // CORRIDA
    linha[9],  // DATA_NASC
    linha[10]  // TAMANHO
  ];

  const csv = headers.join(',') + '\n' + dados.join(',');
  return csv;
}
```

---

## ✅ Validação de Dados

A automação valida automaticamente:

- ✅ **Nome**: Concatena NOME + SOBRENOME (não pode estar vazio)
- ✅ **Email**: Formato válido
- ✅ **Telefone**: Apenas números (11 dígitos)
- ✅ **CPF**: 11 dígitos (adiciona zeros à esquerda se necessário)
- ✅ **Data Nascimento**: Formato DD/MM/AAAA
- ✅ **Gênero**: Mapeado para m/f automaticamente
- ✅ **Tamanho**: Padrão "G" se não fornecido

---

## 🆚 Comparação de Formatos

| Aspecto | Formato Novo | Formato Antigo |
|---------|--------------|----------------|
| **Separador** | `,` (vírgula) | `;` (ponto e vírgula) |
| **Nome** | Dividido (NOME + SOBRENOME) | Completo (name) |
| **ID Submissão** | ✅ Incluído | ❌ Não tem |
| **Data Inscrição** | ✅ Incluída | ❌ Não tem |
| **Webhook** | ✅ Usa ID | ⚠️ Usa nome do arquivo |
| **Google Sheets** | ✅ Compatível | ❌ Manual |

---

## 📝 Notas Importantes

### 1. Ordem das Colunas

A ordem das colunas **não importa** se usar cabeçalhos. A automação lê por **nome da coluna**.

### 2. Campos Opcionais

- `CORRIDA`: Padrão "Espaço Facial" se vazio
- `TAMANHO`: Padrão "G" se vazio
- `DATA`: Usado apenas para logs

### 3. Campos Obrigatórios

- NOME
- EMAIL
- TELEFONE
- CPF
- DATA_NASC
- GENERO

### 4. Delimitador

- Novo formato: **vírgula** (`,`)
- Formato antigo: **ponto e vírgula** (`;`)
- A automação detecta automaticamente

---

## 🚀 Exemplo de Uso

### Comando

```bash
python sprinta_automation.py inscricoes/inscricao_20251004_123456.csv \
  --webhook-url "https://manage.wix.com/_api/webhook-trigger/..." \
  --submission-id "inscricao_20251004_123456"
```

### Saída Esperada

```
📋 PROCESSANDO PARTICIPANTE 1: João Silva
📧 ID: inscricao_12345 | Email: joao.silva@email.com
======================================================================
🌐 Acessou a página do evento para joao.silva@email.com.
✅ Primeiro clique em 'Enroll a friend' realizado.
✅ Segundo clique em 'Enroll a friend' realizado.
⏸️  [DEBUG] Preenchendo dados pessoais...
✅ Dados pessoais preenchidos
...
🎉 Checkout gerado para joao.silva@email.com: https://checkout.sprinta.com.br/...
```

---

## 📚 Documentação Relacionada

- 📖 [README.md](README.md) - Documentação principal
- 📖 [GUIA_APLICACAO_CUPOM.md](GUIA_APLICACAO_CUPOM.md) - Aplicação de cupom
- 📖 [NOVA_ARQUITETURA_WEBHOOK.md](NOVA_ARQUITETURA_WEBHOOK.md) - Arquitetura webhook

---

**🎯 Status:** ✅ Implementado e testado
**📅 Data:** 4 de Outubro de 2025
**🔄 Versão:** 2.1 - Suporte a Google Sheets
