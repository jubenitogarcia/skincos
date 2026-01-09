const express = require('express');
const app = express();

app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'Agent Zero', timestamp: new Date().toISOString() });
});

app.post('/api/message', (req, res) => {
    const { message } = req.body;
    res.json({
        success: true,
        response: `✅ Proxy funcionando! Mensagem recebida: "${message}"`,
        timestamp: new Date().toISOString()
    });
});

app.listen(6801, '0.0.0.0', () => {
    console.log('Agent Zero API running on port 6801');
});
