const express = require('express');
const { WhatsAppAPIClient } = require('./cliente_api');

// Servidor que simula um sistema externo
const app = express();
app.use(express.json());

const PORT = 3002;
const api = new WhatsAppAPIClient('http://localhost:3001');

// Simular um sistema de e-commerce
let pedidos = [];
let proximoId = 1;

console.log('🏪 Sistema E-commerce Simulado');
console.log('===============================');

// ========================================
// ENDPOINTS DO SISTEMA EXTERNO
// ========================================

// Criar novo pedido
app.post('/pedidos', async (req, res) => {
    try {
        const { cliente, produtos, total } = req.body;

        const pedido = {
            id: proximoId++,
            cliente,
            produtos,
            total,
            status: 'pendente',
            timestamp: new Date()
        };

        pedidos.push(pedido);

        // Notificar via WhatsApp
        try {
            const mensagem = `🛒 *Novo Pedido Recebido!*\n\n` +
                `📋 Pedido: #${pedido.id}\n` +
                `👤 Cliente: ${cliente.nome}\n` +
                `📱 Telefone: ${cliente.telefone}\n` +
                `💰 Total: R$ ${total.toFixed(2)}\n` +
                `📦 Produtos: ${produtos.length} itens\n\n` +
                `✅ Status: ${pedido.status.toUpperCase()}`;

            // Enviar para o cliente
            await api.sendMessage(cliente.whatsapp, mensagem);

            // Enviar para admin/loja (altere o número)
            await api.sendMessage(
                '5511999999999', // Número do admin da loja
                `🔔 *Admin: Novo Pedido #${pedido.id}*\n\n${mensagem}`
            );

            console.log(`✅ Pedido #${pedido.id} criado e notificado via WhatsApp`);

        } catch (whatsappError) {
            console.log(`⚠️ Pedido criado mas erro no WhatsApp: ${whatsappError.message}`);
        }

        res.json({
            success: true,
            pedido,
            message: 'Pedido criado com sucesso'
        });

    } catch (error) {
        console.error('❌ Erro ao criar pedido:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao criar pedido'
        });
    }
});

// Atualizar status do pedido
app.put('/pedidos/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, observacao } = req.body;

        const pedido = pedidos.find(p => p.id === parseInt(id));

        if (!pedido) {
            return res.status(404).json({
                success: false,
                message: 'Pedido não encontrado'
            });
        }

        const statusAnterior = pedido.status;
        pedido.status = status;

        // Mensagens por status
        const mensagensPorStatus = {
            'confirmado': '✅ Seu pedido foi confirmado e está sendo preparado!',
            'em_preparacao': '👨‍🍳 Seu pedido está sendo preparado com carinho!',
            'saiu_entrega': '🚚 Seu pedido saiu para entrega! Em breve estará aí!',
            'entregue': '🎉 Pedido entregue com sucesso! Obrigado pela preferência!',
            'cancelado': '❌ Pedido cancelado. Entre em contato para mais informações.'
        };

        const mensagemCliente = `📋 *Atualização do Pedido #${id}*\n\n` +
            `📦 Status: ${status.toUpperCase()}\n` +
            `💬 ${mensagensPorStatus[status] || 'Status atualizado.'}\n` +
            (observacao ? `\n📝 Observação: ${observacao}` : '');

        // Notificar cliente via WhatsApp
        try {
            await api.sendMessage(pedido.cliente.whatsapp, mensagemCliente);
            console.log(`✅ Cliente notificado sobre mudança de status: ${statusAnterior} → ${status}`);
        } catch (whatsappError) {
            console.log(`⚠️ Erro ao notificar cliente: ${whatsappError.message}`);
        }

        res.json({
            success: true,
            pedido,
            message: 'Status atualizado com sucesso'
        });

    } catch (error) {
        console.error('❌ Erro ao atualizar status:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao atualizar status'
        });
    }
});

// Listar pedidos
app.get('/pedidos', (req, res) => {
    res.json({
        success: true,
        pedidos,
        total: pedidos.length
    });
});

// Webhook de exemplo - sistema de backup
app.post('/webhook/backup', async (req, res) => {
    try {
        const { status, servidor, timestamp, detalhes } = req.body;

        const emoji = status === 'sucesso' ? '✅' : '❌';
        const mensagem = `${emoji} *Backup ${status.toUpperCase()}*\n\n` +
            `🖥️ Servidor: ${servidor}\n` +
            `🕐 Horário: ${new Date(timestamp).toLocaleString('pt-BR')}\n` +
            (detalhes ? `📋 Detalhes: ${detalhes}` : '');

        // Enviar para admin de TI (altere o número)
        await api.sendMessage('5511999999999', mensagem);

        console.log(`📊 Backup ${status} notificado via WhatsApp`);

        res.json({
            success: true,
            message: 'Webhook de backup processado'
        });

    } catch (error) {
        console.error('❌ Erro no webhook backup:', error);
        res.status(500).json({
            success: false,
            message: 'Erro no webhook'
        });
    }
});

// Dashboard simples
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Sistema E-commerce</title>
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                .container { max-width: 1000px; margin: 0 auto; }
                .card { background: #f9f9f9; padding: 20px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #007bff; }
                .pedido { background: #e9ecef; padding: 15px; margin: 10px 0; border-radius: 5px; }
                .status { font-weight: bold; padding: 5px 10px; border-radius: 3px; color: white; }
                .pendente { background-color: #ffc107; }
                .confirmado { background-color: #28a745; }
                .entregue { background-color: #007bff; }
                .cancelado { background-color: #dc3545; }
                pre { background: #333; color: #fff; padding: 10px; border-radius: 3px; overflow-x: auto; }
                button { background: #007bff; color: white; border: none; padding: 10px 15px; border-radius: 3px; cursor: pointer; margin: 5px; }
                button:hover { background: #0056b3; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🏪 Sistema E-commerce com WhatsApp</h1>
                <p>Sistema simulado integrado com WhatsApp Bot API</p>

                <div class="card">
                    <h2>📊 Estatísticas</h2>
                    <p><strong>Total de Pedidos:</strong> ${pedidos.length}</p>
                    <p><strong>Pedidos Pendentes:</strong> ${pedidos.filter(p => p.status === 'pendente').length}</p>
                    <p><strong>Pedidos Entregues:</strong> ${pedidos.filter(p => p.status === 'entregue').length}</p>
                </div>

                <div class="card">
                    <h2>🛒 Últimos Pedidos</h2>
                    ${pedidos.slice(-5).reverse().map(pedido => `
                        <div class="pedido">
                            <strong>Pedido #${pedido.id}</strong> - ${pedido.cliente.nome}
                            <br>Total: R$ ${pedido.total.toFixed(2)}
                            <br>Status: <span class="status ${pedido.status}">${pedido.status.toUpperCase()}</span>
                            <br><small>${new Date(pedido.timestamp).toLocaleString('pt-BR')}</small>
                        </div>
                    `).join('')}
                </div>

                <div class="card">
                    <h2>🔧 Testar API</h2>

                    <h3>Criar Pedido de Teste</h3>
                    <button onclick="criarPedidoTeste()">Criar Pedido</button>

                    <h3>Simular Backup</h3>
                    <button onclick="simularBackupSucesso()">Backup Sucesso</button>
                    <button onclick="simularBackupFalha()">Backup Falha</button>

                    <h3>Exemplos de Uso (cURL)</h3>
                    <h4>Criar Pedido:</h4>
                    <pre>curl -X POST http://localhost:${PORT}/pedidos \\
  -H "Content-Type: application/json" \\
  -d '{
    "cliente": {
      "nome": "João Silva",
      "telefone": "(11) 99999-9999",
      "whatsapp": "5511999999999"
    },
    "produtos": [
      {"nome": "Pizza Margherita", "preco": 35.90},
      {"nome": "Refrigerante", "preco": 8.50}
    ],
    "total": 44.40
  }'</pre>

                    <h4>Atualizar Status:</h4>
                    <pre>curl -X PUT http://localhost:${PORT}/pedidos/1/status \\
  -H "Content-Type: application/json" \\
  -d '{
    "status": "entregue",
    "observacao": "Entregue às 18:30"
  }'</pre>
                </div>
            </div>

            <script>
                function criarPedidoTeste() {
                    const pedido = {
                        cliente: {
                            nome: "Cliente Teste " + Math.floor(Math.random() * 100),
                            telefone: "(11) 99999-9999",
                            whatsapp: "5511999999999"
                        },
                        produtos: [
                            {nome: "Produto Teste", preco: Math.random() * 50 + 10}
                        ],
                        total: Math.random() * 50 + 10
                    };

                    fetch('/pedidos', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(pedido)
                    })
                    .then(response => response.json())
                    .then(data => {
                        alert('Pedido criado: #' + data.pedido.id);
                        location.reload();
                    })
                    .catch(error => alert('Erro: ' + error));
                }

                function simularBackupSucesso() {
                    fetch('/webhook/backup', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            status: 'sucesso',
                            servidor: 'web-01',
                            timestamp: new Date().toISOString(),
                            detalhes: 'Backup completo realizado'
                        })
                    })
                    .then(() => alert('Backup sucesso simulado!'))
                    .catch(error => alert('Erro: ' + error));
                }

                function simularBackupFalha() {
                    fetch('/webhook/backup', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            status: 'falha',
                            servidor: 'web-01',
                            timestamp: new Date().toISOString(),
                            detalhes: 'Erro de disco cheio'
                        })
                    })
                    .then(() => alert('Backup falha simulado!'))
                    .catch(error => alert('Erro: ' + error));
                }
            </script>
        </body>
        </html>
    `);
});

// ========================================
// INICIALIZAÇÃO
// ========================================

app.listen(PORT, () => {
    console.log(`🌐 Sistema E-commerce rodando em: http://localhost:${PORT}`);
    console.log('📱 Integração WhatsApp ativa');
    console.log('');
    console.log('🧪 Para testar:');
    console.log(`   1. Acesse: http://localhost:${PORT}`);
    console.log('   2. Certifique-se que o bot está rodando (bot_com_api.js)');
    console.log('   3. Clique em "Criar Pedido" para testar');
    console.log('');
});

// Testar conexão com bot na inicialização
setTimeout(async () => {
    try {
        const status = await api.getStatus();
        if (status.status === 'ready') {
            console.log('✅ Conexão com WhatsApp Bot confirmada!');

            // Enviar mensagem de teste (descomente se quiser)
            /*
            await api.sendMessage(
                '5511999999999', // Altere para seu número
                '🏪 Sistema E-commerce conectado ao WhatsApp!\n\nTudo funcionando perfeitamente!'
            );
            */
        } else {
            console.log('⚠️ Bot ainda não está pronto. Status:', status.status);
        }
    } catch (error) {
        console.log('❌ Erro ao conectar com bot WhatsApp:', error.message);
        console.log('💡 Certifique-se de que o bot_com_api.js está rodando');
    }
}, 2000);
