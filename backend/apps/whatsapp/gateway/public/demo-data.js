// Sample data loader for WhatsApp CRM Demo
function loadSampleData() {
    // Sample contacts
    const sampleContacts = [
        {
            id: 1,
            name: "Maria Santos",
            phone: "+55 11 91234-5678",
            email: "maria.santos@exemplo.com",
            tags: ["cliente", "vip"],
            notes: "Cliente há 2 anos, compras frequentes",
            createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            lastInteraction: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
            id: 2,
            name: "João Silva",
            phone: "+55 11 99876-5432",
            email: "joao.silva@empresa.com",
            tags: ["lead", "interessado"],
            notes: "Interessado em produtos premium",
            createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
            lastInteraction: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
            id: 3,
            name: "Ana Costa",
            phone: "+55 11 98765-4321",
            email: "ana.costa@outlook.com",
            tags: ["cliente", "fidelidade"],
            notes: "Programa de fidelidade ativo",
            createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            lastInteraction: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
        },
        {
            id: 4,
            name: "Carlos Oliveira",
            phone: "+55 11 97654-3210",
            email: "carlos@startup.com",
            tags: ["lead", "b2b"],
            notes: "Potencial cliente corporativo",
            createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            lastInteraction: null
        }
    ];

    // Sample messages
    const sampleMessages = [
        {
            id: 1,
            contact: "+55 11 91234-5678",
            content: "Olá Maria! Como você está? Temos uma nova promoção especial para você!",
            type: "sent",
            messageType: "text",
            timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
            status: "delivered"
        },
        {
            id: 2,
            contact: "+55 11 91234-5678",
            content: "Oi! Estou bem, obrigada! Que promoção é essa?",
            type: "received",
            messageType: "text",
            timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
            status: "read"
        },
        {
            id: 3,
            contact: "+55 11 99876-5432",
            content: "João, aqui estão as informações sobre nossos produtos premium que você solicitou.",
            type: "sent",
            messageType: "text",
            timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
            status: "delivered"
        },
        {
            id: 4,
            contact: "+55 11 98765-4321",
            content: "Ana, seu desconto VIP está ativo! Aproveite 20% off em toda a loja.",
            type: "sent",
            messageType: "text",
            timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            status: "read"
        },
        {
            id: 5,
            contact: "+55 11 97654-3210",
            content: "Carlos, obrigado pelo interesse! Vamos agendar uma demonstração?",
            type: "sent",
            messageType: "text",
            timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
            status: "sent"
        }
    ];

    // Sample templates
    const sampleTemplates = [
        {
            id: 1,
            name: "Boas-vindas",
            category: "marketing",
            content: "Olá {{nome}}! 🎉 Bem-vindo(a) à nossa loja! Estamos muito felizes em tê-lo(a) conosco. Se precisar de alguma coisa, é só chamar!",
            variables: ["nome"],
            createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
            usageCount: 15
        },
        {
            id: 2,
            name: "Promoção VIP",
            category: "marketing",
            content: "🌟 {{nome}}, você tem um desconto especial de {{desconto}}% em {{produto}}! Válido até {{data}}. Não perca!",
            variables: ["nome", "desconto", "produto", "data"],
            createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
            usageCount: 32
        },
        {
            id: 3,
            name: "Suporte Técnico",
            category: "support",
            content: "Olá {{nome}}! 🛠️ Recebemos sua solicitação de suporte sobre {{problema}}. Nossa equipe irá analisar e retornar em até 24h. Obrigado!",
            variables: ["nome", "problema"],
            createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
            usageCount: 8
        },
        {
            id: 4,
            name: "Follow-up Vendas",
            category: "sales",
            content: "Oi {{nome}}! 💼 Como você está? Gostaria de saber se ainda tem interesse em {{produto}}. Posso enviar mais informações?",
            variables: ["nome", "produto"],
            createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            usageCount: 12
        }
    ];

    // Sample campaigns
    const sampleCampaigns = [
        {
            id: 1,
            name: "Black Friday 2024",
            message: "🖤 BLACK FRIDAY chegou! Aproveite até 70% OFF em todos os produtos! Corra, é por tempo limitado! 🏃‍♀️💨",
            tags: ["cliente", "vip"],
            schedule: "",
            createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            status: "completed",
            sent: 127,
            total: 127
        },
        {
            id: 2,
            name: "Leads Nutrição",
            message: "Olá! 👋 Vimos que você tem interesse em nossos produtos. Que tal conhecer nossa linha completa? Temos novidades incríveis!",
            tags: ["lead", "interessado"],
            schedule: "",
            createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            status: "running",
            sent: 23,
            total: 45
        },
        {
            id: 3,
            name: "Programa Fidelidade",
            message: "🎁 Você acumulou pontos suficientes! Resgate agora seus prêmios exclusivos no nosso programa de fidelidade!",
            tags: ["fidelidade"],
            schedule: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            createdAt: new Date().toISOString(),
            status: "pending",
            sent: 0,
            total: 12
        }
    ];

    return {
        contacts: sampleContacts,
        messages: sampleMessages,
        templates: sampleTemplates,
        campaigns: sampleCampaigns
    };
}

// Function to populate CRM with sample data
function populateSampleData() {
    const sampleData = loadSampleData();
    
    // Store in localStorage
    localStorage.setItem('crm_contacts', JSON.stringify(sampleData.contacts));
    localStorage.setItem('crm_messages', JSON.stringify(sampleData.messages));
    localStorage.setItem('crm_templates', JSON.stringify(sampleData.templates));
    localStorage.setItem('crm_campaigns', JSON.stringify(sampleData.campaigns));
    
    console.log('✅ Sample data loaded successfully!');
    
    // Reload page to show data
    window.location.reload();
}

// Add demo button to load sample data
function addDemoButton() {
    if (document.getElementById('demo-button')) return;
    
    const header = document.querySelector('.header');
    if (header) {
        const demoButton = document.createElement('button');
        demoButton.id = 'demo-button';
        demoButton.innerHTML = '🎯 Carregar Dados Demo';
        demoButton.style.cssText = `
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: rgba(255,255,255,0.2);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
            padding: 0.5rem 1rem;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9rem;
            transition: background 0.3s;
        `;
        demoButton.onmouseover = () => demoButton.style.background = 'rgba(255,255,255,0.3)';
        demoButton.onmouseout = () => demoButton.style.background = 'rgba(255,255,255,0.2)';
        demoButton.onclick = populateSampleData;
        
        header.style.position = 'relative';
        header.appendChild(demoButton);
    }
}

// Auto-load demo button when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addDemoButton);
} else {
    addDemoButton();
}