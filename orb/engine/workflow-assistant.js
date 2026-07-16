#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const http = require('http');
const runtimePaths = require('./scripts/lib/runtime-paths');

const DB_PATH = process.env.N8N_DB_PATH || runtimePaths.dbPath;
const ENV_FILE = process.env.N8N_ENV_FILE || runtimePaths.envFile;
const N8N_API = 'http://localhost:5678';
const GLOBAL_FLATTED_PATH = '/opt/homebrew/lib/node_modules/n8n/node_modules/flatted';

function readEnvValue(filePath, key) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const line = content
            .split(/\r?\n/)
            .find((entry) => entry.startsWith(`${key}=`));
        return line ? line.slice(key.length + 1).trim() : '';
    } catch {
        return '';
    }
}

class WorkflowAssistant {
    constructor() {
        const dbType = process.env.DB_TYPE || readEnvValue(ENV_FILE, 'DB_TYPE');
        const allowLegacySqliteMode =
            process.env.N8N_WORKFLOW_ASSISTANT_ALLOW_SQLITE_SNAPSHOT === '1';

        if (dbType === 'postgresdb' && !allowLegacySqliteMode) {
            console.error('❌ O workflow-assistant deste módulo é compatível apenas com snapshots SQLite.');
            console.error('💡 O runtime live compartilhado do orb usa PostgreSQL e não deve ser editado por este helper.');
            console.error('💡 Use o browser do n8n para a versão canônica live, ou rode com N8N_WORKFLOW_ASSISTANT_ALLOW_SQLITE_SNAPSHOT=1 apenas em contexto histórico/offline.');
            process.exit(1);
        }

        if (!fs.existsSync(DB_PATH)) {
            console.error(`❌ Banco de dados n8n não encontrado em: ${DB_PATH}`);
            console.error(`💡 Certifique-se de que o n8n já foi executado ao menos uma vez.`);
            process.exit(1);
        }

        this.db = new Database(DB_PATH);
    }

    getFlattedParser() {
        try {
            return require('flatted').parse;
        } catch {
            try {
                return require(GLOBAL_FLATTED_PATH).parse;
            } catch {
                throw new Error('Não foi possível carregar o parser flatted. Instale com "npm i flatted".');
            }
        }
    }

    safeParseJson(value, fallback) {
        if (!value) return fallback;
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }

    // Testa se n8n está rodando
    async isN8nRunning() {
        return new Promise((resolve) => {
            const req = http.get(`${N8N_API}/healthz`, (res) => {
                resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.setTimeout(2000, () => {
                req.destroy();
                resolve(false);
            });
        });
    }

    // Lista workflows
    async listWorkflows() {
        const isRunning = await this.isN8nRunning();

        if (isRunning) {
            console.log('🌐 n8n está rodando em http://localhost:5678\n');
        } else {
            console.log('⚠️  n8n parece estar offline (trabalhando direto no banco)\n');
        }

        const workflows = this.db.prepare(`
      SELECT id, name, active, createdAt, updatedAt
      FROM workflow_entity
      ORDER BY updatedAt DESC
    `).all();

        if (workflows.length === 0) {
            console.log('📭 Nenhum workflow encontrado.');
            console.log('💡 Crie workflows pelo browser em http://localhost:5678\n');
            return [];
        }

        console.log('📋 Workflows disponíveis:\n');
        console.log('─'.repeat(80));

        workflows.forEach(wf => {
            const status = wf.active ? '🟢 Ativo  ' : '🔴 Inativo';
            const date = new Date(wf.updatedAt).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            console.log(`${status} │ ID: ${String(wf.id).padStart(3, ' ')} │ ${wf.name || '(Sem nome)'}`);
            console.log(`           │ 📅 Atualizado: ${date}`);
            console.log('─'.repeat(80));
        });

        console.log(`\n📊 Total: ${workflows.length} workflow(s)\n`);

        return workflows;
    }

    // Mostra workflow detalhado
    async getWorkflow(id) {
        const result = this.db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(id);

        if (!result) {
            console.log(`❌ Workflow ${id} não encontrado\n`);
            console.log('💡 Use "node workflow-assistant.js list" para ver workflows disponíveis\n');
            return null;
        }

        // n8n agora armazena dados em colunas separadas
        const workflow = {
            id: result.id,
            name: result.name,
            active: result.active,
            nodes: result.nodes ? JSON.parse(result.nodes) : [],
            connections: result.connections ? JSON.parse(result.connections) : {},
            settings: result.settings ? JSON.parse(result.settings) : {},
            staticData: result.staticData ? JSON.parse(result.staticData) : null,
            pinData: result.pinData ? JSON.parse(result.pinData) : {},
            versionId: result.versionId,
            meta: result.meta ? JSON.parse(result.meta) : null,
        };

        console.log('\n' + '═'.repeat(80));
        console.log(`📄 WORKFLOW: ${workflow.name || 'Sem nome'}`);
        console.log('═'.repeat(80));
        console.log(`🆔 ID:        ${id}`);
        console.log(`${workflow.active ? '✅' : '❌'} Status:    ${workflow.active ? 'Ativo' : 'Inativo'}`);
        console.log(`🔗 Nodes:     ${workflow.nodes?.length || 0}`);
        console.log(`🔌 Conexões:  ${Object.keys(workflow.connections || {}).length}`);
        console.log(`📅 Criado:    ${new Date(result.createdAt).toLocaleString('pt-BR')}`);
        console.log(`📅 Atualizado: ${new Date(result.updatedAt).toLocaleString('pt-BR')}`);
        console.log('═'.repeat(80)); if (workflow.nodes?.length > 0) {
            console.log('\n📦 ESTRUTURA DOS NODES:\n');

            workflow.nodes.forEach((node, idx) => {
                const icon = this.getNodeIcon(node.type);
                const number = String(idx + 1).padStart(2, ' ');

                console.log(`${icon} ${number}. ${node.name}`);
                console.log(`      Tipo: ${node.type}`);

                if (node.position) {
                    console.log(`      📍 Posição: [${node.position[0]}, ${node.position[1]}]`);
                }

                if (node.parameters && Object.keys(node.parameters).length > 0) {
                    const paramCount = Object.keys(node.parameters).length;
                    const paramPreview = Object.keys(node.parameters).slice(0, 3).join(', ');
                    console.log(`      ⚙️  Parâmetros (${paramCount}): ${paramPreview}${paramCount > 3 ? '...' : ''}`);
                }

                if (node.credentials) {
                    console.log(`      🔑 Credenciais: ${Object.keys(node.credentials).join(', ')}`);
                }

                console.log('');
            });
        }

        // Mostra conexões de forma visual
        if (workflow.connections && Object.keys(workflow.connections).length > 0) {
            console.log('🔗 FLUXO DE CONEXÕES:\n');

            Object.entries(workflow.connections).forEach(([source, outputs]) => {
                Object.entries(outputs).forEach(([outputType, connections]) => {
                    connections.forEach((connArray) => {
                        connArray.forEach(conn => {
                            console.log(`   ${source} ──→ ${conn.node}`);
                        });
                    });
                });
            });
            console.log('');
        }

        const isRunning = await this.isN8nRunning();

        if (isRunning) {
            console.log(`🌐 Abrir no browser: ${N8N_API}/workflow/${id}\n`);
        } else {
            console.log('💡 Para o runtime compartilhado, prefira os comandos service:* e o browser do n8n.');
            console.log('💡 Para operar o runtime nativo, use: npm run service:status\n');
        }

        return { dbRow: result, workflow };
    }

    // Ícones por tipo de node
    getNodeIcon(nodeType) {
        const icons = {
            'n8n-nodes-base.httpRequest': '🌐',
            'n8n-nodes-base.webhook': '🪝',
            'n8n-nodes-base.code': '💻',
            'n8n-nodes-base.function': '⚡',
            'n8n-nodes-base.set': '📝',
            'n8n-nodes-base.if': '🔀',
            'n8n-nodes-base.switch': '🔀',
            'n8n-nodes-base.merge': '🔄',
            'n8n-nodes-base.splitInBatches': '✂️',
            'n8n-nodes-base.executeWorkflow': '🔁',
            'n8n-nodes-base.slack': '💬',
            'n8n-nodes-base.discord': '🎮',
            'n8n-nodes-base.telegram': '✈️',
            'n8n-nodes-base.whatsApp': '📱',
            'n8n-nodes-base.gmail': '📧',
            'n8n-nodes-base.googleSheets': '📊',
            'n8n-nodes-base.postgres': '🐘',
            'n8n-nodes-base.mysql': '🐬',
            'n8n-nodes-base.mongodb': '🍃',
            'n8n-nodes-base.redis': '🔴',
            'n8n-nodes-base.schedule': '⏰',
            'n8n-nodes-base.cron': '⏰',
            'n8n-nodes-base.wait': '⏳',
            'n8n-nodes-base.start': '▶️',
            'n8n-nodes-base.error': '❌',
        };
        return icons[nodeType] || '📦';
    }

    // Exporta workflow para arquivo JSON
    async exportWorkflow(id, outputPath) {
        const data = await this.getWorkflow(id);
        if (!data) return false;

        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`📁 Diretório criado: ${dir}\n`);
        }

        // Exporta em formato compatível com n8n (para reimportar via interface)
        const exportData = {
            name: data.workflow.name,
            nodes: data.workflow.nodes,
            connections: data.workflow.connections,
            active: data.workflow.active,
            settings: data.workflow.settings,
            staticData: data.workflow.staticData,
            pinData: data.workflow.pinData,
            meta: data.workflow.meta,
        };

        fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));

        const fileSize = fs.statSync(outputPath).size;
        const fileSizeKB = (fileSize / 1024).toFixed(2);

        console.log('\n✅ WORKFLOW EXPORTADO COM SUCESSO!\n');
        console.log(`📄 Arquivo: ${outputPath}`);
        console.log(`📏 Tamanho: ${fileSizeKB} KB`);
        console.log(`🔗 Nodes: ${data.workflow.nodes?.length || 0}`);
        console.log('');
        console.log('📝 Próximos passos:');
        console.log(`   1. Edite o arquivo JSON no VS Code`);
        console.log(`   2. Reimporte com: node workflow-assistant.js import ${id} ${outputPath}`);
        console.log(`   3. Recarregue o browser (F5) para ver as mudanças\n`);

        return true;
    }

    getExecutionRecord(workflowId, executionSelector = 'latest') {
        if (!workflowId) {
            throw new Error('workflowId é obrigatório para exportar execução.');
        }

        if (executionSelector === 'latest') {
            return this.db.prepare(`
        SELECT id, workflowId, mode, status, startedAt, stoppedAt, createdAt, finished, retryOf
        FROM execution_entity
        WHERE workflowId = ?
        ORDER BY id DESC
        LIMIT 1
      `).get(workflowId);
        }

        return this.db.prepare(`
      SELECT id, workflowId, mode, status, startedAt, stoppedAt, createdAt, finished, retryOf
      FROM execution_entity
      WHERE id = ? AND workflowId = ?
      LIMIT 1
    `).get(executionSelector, workflowId);
    }

    summarizeRunData(runData = {}) {
        const summary = [];

        for (const [nodeName, runs] of Object.entries(runData || {})) {
            const runArray = Array.isArray(runs) ? runs : [];
            const lastRun = runArray[runArray.length - 1] || {};
            const main = ((lastRun.data || {}).main || []);
            const outputCount = Array.isArray(main[0]) ? main[0].length : 0;

            summary.push({
                nodeName,
                executions: runArray.length,
                executionStatus: lastRun.executionStatus || '',
                executionTimeMs: Number(lastRun.executionTime || 0),
                outputCount,
            });
        }

        return summary;
    }

    async exportDebugBundle(workflowId, executionSelector = 'latest', outputPath) {
        const workflowRow = this.db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(workflowId);

        if (!workflowRow) {
            console.log(`❌ Workflow ${workflowId} não encontrado\n`);
            return false;
        }

        const executionRecord = this.getExecutionRecord(workflowId, executionSelector);

        if (!executionRecord) {
            const suffix = executionSelector === 'latest'
                ? 'mais recente'
                : `com id ${executionSelector}`;
            console.log(`❌ Nenhuma execução ${suffix} foi encontrada para o workflow ${workflowId}\n`);
            return false;
        }

        const executionDataRow = this.db.prepare(`
      SELECT data
      FROM execution_data
      WHERE executionId = ?
      LIMIT 1
    `).get(executionRecord.id);

        if (!executionDataRow?.data) {
            console.log(`❌ Não há dados de execução salvos para executionId ${executionRecord.id}\n`);
            return false;
        }

        const parseFlatted = this.getFlattedParser();
        const executionPayload = parseFlatted(executionDataRow.data);
        const resultData = executionPayload?.resultData || {};
        const runData = resultData.runData || {};

        const workflowExport = {
            id: workflowRow.id,
            name: workflowRow.name,
            active: workflowRow.active,
            nodes: this.safeParseJson(workflowRow.nodes, []),
            connections: this.safeParseJson(workflowRow.connections, {}),
            settings: this.safeParseJson(workflowRow.settings, {}),
            staticData: this.safeParseJson(workflowRow.staticData, null),
            pinData: this.safeParseJson(workflowRow.pinData, {}),
            meta: this.safeParseJson(workflowRow.meta, null),
            versionId: workflowRow.versionId,
            updatedAt: workflowRow.updatedAt,
        };

        const resolvedOutputPath = outputPath || path.join(
            process.cwd(),
            'workflows',
            'executions',
            `workflow-${workflowId}.execution-${executionRecord.id}.bundle.json`,
        );

        const outDir = path.dirname(resolvedOutputPath);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        const bundle = {
            generatedAt: new Date().toISOString(),
            source: {
                dbPath: DB_PATH,
                apiBaseUrl: N8N_API,
            },
            workflow: workflowExport,
            execution: {
                id: executionRecord.id,
                workflowId: executionRecord.workflowId,
                status: executionRecord.status,
                mode: executionRecord.mode,
                startedAt: executionRecord.startedAt,
                stoppedAt: executionRecord.stoppedAt,
                createdAt: executionRecord.createdAt,
                finished: executionRecord.finished,
                retryOf: executionRecord.retryOf,
                lastNodeExecuted: resultData.lastNodeExecuted || '',
                error: resultData.error || null,
                pinData: resultData.pinData || {},
                runDataSummary: this.summarizeRunData(runData),
                runData,
            },
            notes: {
                containsSensitiveData: true,
                purpose: 'Bundle para análise de execução em IA com dados reais.',
            },
        };

        fs.writeFileSync(resolvedOutputPath, JSON.stringify(bundle, null, 2));

        const fileSizeKB = (fs.statSync(resolvedOutputPath).size / 1024).toFixed(2);

        console.log('\n✅ BUNDLE DE EXECUÇÃO EXPORTADO COM SUCESSO!\n');
        console.log(`📄 Arquivo: ${resolvedOutputPath}`);
        console.log(`🆔 Workflow ID: ${workflowId}`);
        console.log(`🧪 Execution ID: ${executionRecord.id}`);
        console.log(`📏 Tamanho: ${fileSizeKB} KB`);
        console.log('');
        console.log('⚠️  Este arquivo pode conter dados sensíveis (payloads reais e pinData).');
        console.log('💡 Use este JSON para pedir análise/melhoria de execução para a IA.\n');

        return true;
    }

    // Importa workflow de arquivo JSON
    importWorkflow(id, inputPath) {
        if (!fs.existsSync(inputPath)) {
            console.log(`❌ Arquivo não encontrado: ${inputPath}\n`);
            return false;
        }

        let workflowData;
        try {
            const fileContent = fs.readFileSync(inputPath, 'utf8');
            workflowData = JSON.parse(fileContent);
        } catch (error) {
            console.log(`❌ Erro ao ler JSON: ${error.message}\n`);
            console.log('💡 Verifique se o arquivo está em formato JSON válido\n');
            return false;
        }

        // Validação básica
        if (!workflowData.nodes || !Array.isArray(workflowData.nodes)) {
            console.log('❌ JSON inválido: propriedade "nodes" não encontrada ou não é um array\n');
            return false;
        }

        const now = new Date().toISOString();

        try {
            const stmt = this.db.prepare(`
        UPDATE workflow_entity
        SET
          name = ?,
          nodes = ?,
          connections = ?,
          settings = ?,
          staticData = ?,
          pinData = ?,
          meta = ?,
          updatedAt = ?
        WHERE id = ?
      `);

            const result = stmt.run(
                workflowData.name || 'Unnamed',
                JSON.stringify(workflowData.nodes || []),
                JSON.stringify(workflowData.connections || {}),
                JSON.stringify(workflowData.settings || {}),
                JSON.stringify(workflowData.staticData || null),
                JSON.stringify(workflowData.pinData || {}),
                JSON.stringify(workflowData.meta || null),
                now,
                id
            );

            if (result.changes > 0) {
                console.log('\n✅ WORKFLOW ATUALIZADO COM SUCESSO!\n');
                console.log(`🆔 Workflow ID: ${id}`);
                console.log(`📄 Arquivo fonte: ${inputPath}`);
                console.log(`🔗 Nodes: ${workflowData.nodes.length}`);
                console.log(`📅 Atualizado: ${new Date(now).toLocaleString('pt-BR')}`);
                console.log('');
                console.log('🔄 Próximos passos:');
                console.log(`   1. Recarregue o browser (F5)`);
                console.log(`   2. Abra: ${N8N_API}/workflow/${id}\n`);
                return true;
            } else {
                console.log(`❌ Falha ao atualizar workflow ${id}\n`);
                console.log('💡 Verifique se o ID do workflow está correto\n');
                return false;
            }
        } catch (error) {
            console.log(`❌ Erro ao atualizar banco de dados: ${error.message}\n`);
            return false;
        }
    }

    close() {
        this.db.close();
    }
}

// CLI
async function main() {
    const assistant = new WorkflowAssistant();
    const args = process.argv.slice(2);
    const command = args[0];

    try {
        switch (command) {
            case 'list':
            case 'ls':
                await assistant.listWorkflows();
                break;

            case 'show':
            case 'view':
            case 'get':
                if (!args[1]) {
                    console.log('❌ ID do workflow não especificado\n');
                    console.log('💡 Uso: node workflow-assistant.js show <workflow_id>\n');
                    console.log('Exemplo: node workflow-assistant.js show WGXr4vYkv9UoJ8zc\n');
                    process.exit(1);
                }
                await assistant.getWorkflow(args[1]);
                break;

            case 'export':
                if (!args[1] || !args[2]) {
                    console.log('❌ Parâmetros insuficientes\n');
                    console.log('💡 Uso: node workflow-assistant.js export <workflow_id> <output_file>\n');
                    console.log('Exemplo: node workflow-assistant.js export WGXr4vYkv9UoJ8zc workflows/livia.json\n');
                    process.exit(1);
                }
                await assistant.exportWorkflow(args[1], args[2]);
                break;

            case 'import':
                if (!args[1] || !args[2]) {
                    console.log('❌ Parâmetros insuficientes\n');
                    console.log('💡 Uso: node workflow-assistant.js import <workflow_id> <input_file>\n');
                    console.log('Exemplo: node workflow-assistant.js import WGXr4vYkv9UoJ8zc workflows/livia.json\n');
                    process.exit(1);
                }
                await assistant.importWorkflow(args[1], args[2]);
                break;

            case 'debug-bundle':
            case 'bundle':
                if (!args[1]) {
                    console.log('❌ Workflow ID não especificado\n');
                    console.log('💡 Uso: node workflow-assistant.js debug-bundle <workflow_id> [execution_id|latest] [output_file]\n');
                    console.log('Exemplo: node workflow-assistant.js debug-bundle ub8H3fnYh2cNIF8K latest workflows/executions/meta-ads.bundle.json\n');
                    process.exit(1);
                }
                await assistant.exportDebugBundle(args[1], args[2] || 'latest', args[3]);
                break;

            case 'help':
            case '--help':
            case '-h':
                console.log('\n🤖 n8n Workflow Assistant - Ajuda\n');
                console.log('═'.repeat(80));
                console.log('\n📚 COMANDOS DISPONÍVEIS:\n');
                console.log('  list, ls                       Lista todos os workflows');
                console.log('  show <id>                      Mostra detalhes de um workflow');
                console.log('  export <id> <file>             Exporta workflow para JSON');
                console.log('  import <id> <file>             Importa workflow de JSON');
                console.log('  debug-bundle <wf> [exec] [out] Exporta bundle completo da execução para IA');
                console.log('  help                           Mostra esta ajuda');
                console.log('\n💡 EXEMPLOS:\n');
                console.log('  node workflow-assistant.js list');
                console.log('  node workflow-assistant.js show WGXr4vYkv9UoJ8zc');
                console.log('  node workflow-assistant.js export WGXr4vYkv9UoJ8zc workflows/livia.json');
                console.log('  node workflow-assistant.js import WGXr4vYkv9UoJ8zc workflows/livia.json');
                console.log('  node workflow-assistant.js debug-bundle ub8H3fnYh2cNIF8K latest workflows/executions/meta-ads.bundle.json');
                console.log('\n🎯 ATALHOS VIA NPM:\n');
                console.log('  npm run list');
                console.log('  npm run show -- WGXr4vYkv9UoJ8zc');
                console.log('  npm run export -- WGXr4vYkv9UoJ8zc workflows/livia.json');
                console.log('  npm run import -- WGXr4vYkv9UoJ8zc workflows/livia.json');
                console.log('\n📖 WORKFLOW RECOMENDADO:\n');
                console.log('  1. Liste workflows: npm run list');
                console.log('  2. Exporte para editar: npm run export -- <id> workflows/nome.json');
                console.log('  3. Edite o JSON no VS Code');
                console.log('  4. Reimporte: npm run import -- <id> workflows/nome.json');
                console.log('  5. Recarregue o browser (F5)');
                console.log('\n═'.repeat(80));
                console.log('');
                break;

            default:
                if (!command) {
                    console.log('\n❌ Nenhum comando especificado\n');
                } else {
                    console.log(`\n❌ Comando desconhecido: ${command}\n`);
                }
                console.log('💡 Use "node workflow-assistant.js help" para ver os comandos disponíveis\n');
                process.exit(1);
        }
    } catch (error) {
        console.error(`\n❌ Erro: ${error.message}\n`);
        process.exit(1);
    } finally {
        assistant.close();
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = WorkflowAssistant;
