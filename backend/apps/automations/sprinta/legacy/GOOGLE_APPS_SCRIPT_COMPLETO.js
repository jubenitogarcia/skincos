/**
 * Google Apps Script para exportar submissões do formulário Wix para GitHub
 *
 * Este script adiciona automaticamente um ID único na coluna B e exporta
 * os dados para o repositório GitHub em formato CSV.
 *
 * IMPORTANTE: A coluna B (ID) é obrigatória para o webhook funcionar!
 */

// ============================================================================
// CONFIGURAÇÕES
// ============================================================================

const GITHUB_TOKEN = 'ghp_seu_token_aqui';  // Personal Access Token do GitHub
const GITHUB_OWNER = 'jubenitogarcia';      // Dono do repositório
const GITHUB_REPO = 'Sprinta-Scraper';      // Nome do repositório
const GITHUB_BRANCH = 'main';                // Branch
const FOLDER_PATH = 'inscricoes/';          // Pasta no repositório

// ============================================================================
// FUNÇÃO PRINCIPAL - EXECUTADA AO ENVIAR FORMULÁRIO
// ============================================================================

/**
 * Trigger automático quando uma nova linha é adicionada no Google Sheets
 * Configure em: Extensions → Apps Script → Triggers → Add Trigger
 */
function onFormSubmit(e) {
    try {
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
        const lastRow = sheet.getLastRow();

        Logger.log(`📝 Nova submissão detectada na linha ${lastRow}`);

        // ========================================================================
        // ETAPA 1: GERAR ID ÚNICO
        // ========================================================================

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
        const uuid = Utilities.getUuid().substring(0, 8);
        const submissionId = `inscricao_${timestamp}_id${uuid}_linha${lastRow}`;

        Logger.log(`🆔 ID gerado: ${submissionId}`);

        // ========================================================================
        // ETAPA 2: SALVAR ID NA COLUNA B
        // ========================================================================

        sheet.getRange(lastRow, 2).setValue(submissionId);
        Logger.log(`✅ ID salvo na coluna B (linha ${lastRow})`);

        // ========================================================================
        // ETAPA 3: LER DADOS DA LINHA
        // ========================================================================

        const data = {
            DATA: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
            ID: submissionId,
            NOME: sheet.getRange(lastRow, 3).getValue(),         // Coluna C
            SOBRENOME: sheet.getRange(lastRow, 4).getValue(),    // Coluna D
            EMAIL: sheet.getRange(lastRow, 5).getValue(),        // Coluna E
            TELEFONE: sheet.getRange(lastRow, 6).getValue(),     // Coluna F
            CPF: sheet.getRange(lastRow, 7).getValue(),          // Coluna G
            GENERO: sheet.getRange(lastRow, 8).getValue(),       // Coluna H
            CORRIDA: sheet.getRange(lastRow, 9).getValue(),      // Coluna I
            DATA_NASC: sheet.getRange(lastRow, 10).getValue(),   // Coluna J
            TAMANHO: sheet.getRange(lastRow, 11).getValue()      // Coluna K
        };

        Logger.log(`📊 Dados lidos: ${JSON.stringify(data)}`);

        // ========================================================================
        // ETAPA 4: CRIAR CSV
        // ========================================================================

        const csvContent = criarCSV(data);
        Logger.log(`📄 CSV criado (${csvContent.length} caracteres)`);

        // ========================================================================
        // ETAPA 5: ENVIAR PARA GITHUB
        // ========================================================================

        const fileName = `${FOLDER_PATH}inscricao_${submissionId}.csv`;
        const success = enviarParaGitHub(csvContent, fileName, submissionId);

        if (success) {
            Logger.log(`✅ Sucesso! Arquivo enviado: ${fileName}`);
            // Opcional: Marcar como processado na coluna L
            sheet.getRange(lastRow, 12).setValue('✅ Enviado');
        } else {
            Logger.log(`❌ Erro ao enviar para GitHub`);
            sheet.getRange(lastRow, 12).setValue('❌ Erro');
        }

    } catch (error) {
        Logger.log(`❌ ERRO: ${error.message}`);
        Logger.log(error.stack);
    }
}

// ============================================================================
// FUNÇÃO: CRIAR CSV
// ============================================================================

/**
 * Cria conteúdo CSV no formato esperado pela automação Python
 *
 * @param {Object} data - Dados do participante
 * @returns {string} Conteúdo CSV completo
 */
function criarCSV(data) {
    // Cabeçalho (IMPORTANTE: ordem deve corresponder aos valores!)
    const headers = [
        'DATA',
        'ID',
        'NOME',
        'SOBRENOME',
        'EMAIL',
        'TELEFONE',
        'CPF',
        'GENERO',
        'CORRIDA',
        'DATA_NASC',
        'TAMANHO'
    ];

    // Valores
    const values = [
        data.DATA,
        data.ID,
        data.NOME,
        data.SOBRENOME,
        data.EMAIL,
        limparTelefone(data.TELEFONE),      // Remove formatação
        limparCPF(data.CPF),                 // Remove formatação
        mapearGenero(data.GENERO),          // Masculino/Feminino → M/F
        data.CORRIDA || '5K',                // Padrão se vazio
        formatarDataNascimento(data.DATA_NASC),
        data.TAMANHO || 'G'                  // Padrão se vazio
    ];

    // Escapar vírgulas e aspas em valores
    const valoresEscapados = values.map(v => {
        const str = String(v || '');
        // Se contém vírgula ou aspas, envolver em aspas duplas
        if (str.includes(',') || str.includes('"')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    });

    // Montar CSV
    return headers.join(',') + '\n' + valoresEscapados.join(',');
}

// ============================================================================
// FUNÇÃO: ENVIAR PARA GITHUB
// ============================================================================

/**
 * Envia arquivo CSV para o GitHub usando a API REST
 *
 * @param {string} content - Conteúdo do arquivo CSV
 * @param {string} fileName - Nome/caminho do arquivo no repositório
 * @param {string} submissionId - ID da submissão (para mensagem de commit)
 * @returns {boolean} true se sucesso, false se erro
 */
function enviarParaGitHub(content, fileName, submissionId) {
    try {
        const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${fileName}`;

        // Codificar conteúdo em Base64
        const contentBase64 = Utilities.base64Encode(content);

        // Mensagem de commit
        const commitMessage = `Nova inscrição: ${submissionId}`;

        // Payload
        const payload = {
            message: commitMessage,
            content: contentBase64,
            branch: GITHUB_BRANCH
        };

        // Opções da requisição
        const options = {
            method: 'put',
            contentType: 'application/json',
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'GoogleAppsScript-Sprinta-Integration'
            },
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        };

        // Fazer requisição
        const response = UrlFetchApp.fetch(url, options);
        const responseCode = response.getResponseCode();

        Logger.log(`📡 GitHub API Response: ${responseCode}`);

        if (responseCode === 201) {
            Logger.log('✅ Arquivo criado com sucesso no GitHub');
            return true;
        } else if (responseCode === 200) {
            Logger.log('✅ Arquivo atualizado com sucesso no GitHub');
            return true;
        } else {
            Logger.log(`❌ Erro GitHub: ${response.getContentText()}`);
            return false;
        }

    } catch (error) {
        Logger.log(`❌ Erro ao enviar para GitHub: ${error.message}`);
        return false;
    }
}

// ============================================================================
// FUNÇÕES AUXILIARES - FORMATAÇÃO DE DADOS
// ============================================================================

/**
 * Remove formatação do telefone, mantendo apenas números
 * Exemplo: "(51) 99988-7766" → "51999887766"
 */
function limparTelefone(telefone) {
    return String(telefone || '').replace(/\D/g, '');
}

/**
 * Remove formatação do CPF, mantendo apenas números
 * Exemplo: "123.456.789-00" → "12345678900"
 */
function limparCPF(cpf) {
    return String(cpf || '').replace(/\D/g, '');
}

/**
 * Mapeia gênero para formato esperado pela automação
 * Masculino/masculino/M/male → M
 * Feminino/feminino/F/female → F
 */
function mapearGenero(genero) {
    const g = String(genero || '').toLowerCase().trim();

    if (g === 'masculino' || g === 'm' || g === 'male') {
        return 'Masculino';
    } else if (g === 'feminino' || g === 'f' || g === 'female') {
        return 'Feminino';
    }

    return genero; // Retorna original se não reconhecido
}

/**
 * Formata data de nascimento para DD/MM/AAAA
 */
function formatarDataNascimento(data) {
    if (!data) return '';

    // Se já está em formato de string
    if (typeof data === 'string') {
        return data;
    }

    // Se é objeto Date
    if (data instanceof Date) {
        const dia = String(data.getDate()).padStart(2, '0');
        const mes = String(data.getMonth() + 1).padStart(2, '0');
        const ano = data.getFullYear();
        return `${dia}/${mes}/${ano}`;
    }

    return String(data);
}

// ============================================================================
// FUNÇÃO DE TESTE (EXECUTAR MANUALMENTE)
// ============================================================================

/**
 * Função para testar o script manualmente
 * Configure os dados de teste abaixo e execute esta função
 */
function testarExportacao() {
    Logger.log('🧪 Iniciando teste de exportação...');

    // Dados de teste
    const dadosTeste = {
        DATA: '2025-10-05',
        ID: 'inscricao_teste_123',
        NOME: 'João',
        SOBRENOME: 'Silva',
        EMAIL: 'joao.silva@email.com',
        TELEFONE: '51999887766',
        CPF: '12345678900',
        GENERO: 'Masculino',
        CORRIDA: '5K',
        DATA_NASC: '15/03/1990',
        TAMANHO: 'G'
    };

    // Criar CSV
    const csv = criarCSV(dadosTeste);
    Logger.log('📄 CSV gerado:');
    Logger.log(csv);

    // Enviar para GitHub
    const fileName = `${FOLDER_PATH}teste_${new Date().getTime()}.csv`;
    const success = enviarParaGitHub(csv, fileName, dadosTeste.ID);

    if (success) {
        Logger.log('✅ Teste concluído com sucesso!');
    } else {
        Logger.log('❌ Teste falhou!');
    }
}

// ============================================================================
// INSTRUÇÕES DE CONFIGURAÇÃO
// ============================================================================

/**
 * COMO CONFIGURAR:
 *
 * 1. No Google Sheets:
 *    - Coluna A: DATA (gerada automaticamente)
 *    - Coluna B: ID (será preenchida por este script) ← IMPORTANTE!
 *    - Coluna C: NOME
 *    - Coluna D: SOBRENOME
 *    - Coluna E: EMAIL
 *    - Coluna F: TELEFONE
 *    - Coluna G: CPF
 *    - Coluna H: GENERO
 *    - Coluna I: CORRIDA
 *    - Coluna J: DATA_NASC
 *    - Coluna K: TAMANHO
 *    - Coluna L: STATUS (opcional, para marcar como enviado)
 *
 * 2. Criar GitHub Personal Access Token:
 *    - GitHub → Settings → Developer settings → Personal access tokens
 *    - Gerar token com permissão "repo"
 *    - Copiar e colar na variável GITHUB_TOKEN acima
 *
 * 3. Configurar Trigger no Apps Script:
 *    - Extensions → Apps Script
 *    - Triggers (ícone de relógio)
 *    - Add Trigger
 *    - Function: onFormSubmit
 *    - Event: On form submit
 *    - Save
 *
 * 4. Testar:
 *    - Execute a função testarExportacao() manualmente
 *    - Verifique os logs (View → Logs)
 *    - Confirme que o arquivo aparece no GitHub
 *
 * 5. Pronto!
 *    - Agora toda submissão do formulário será exportada automaticamente
 *    - Com ID único na coluna B
 *    - Pronta para processar pela automação Python
 */
