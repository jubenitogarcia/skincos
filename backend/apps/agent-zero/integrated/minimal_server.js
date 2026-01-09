const express = require('express');
const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
    console.log('Health check received');
    res.json({ status: 'healthy', service: 'Agent Zero API', port: 6801 });
});

app.post('/api/message', (req, res) => {
    console.log('Message received:', req.body);
    res.json({ 
        success: true, 
        response: 'Hello from Agent Zero! Your message was received.',
        echo: req.body
    });
});

app.get('*', (req, res) => {
    res.json({ error: 'Agent Zero API - Endpoint not found', path: req.path });
});

const server = app.listen(6801, '0.0.0.0', () => {
    console.log('✅ Minimal Agent Zero API server running on http://0.0.0.0:6801');
});

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    server.close();
    process.exit(0);
});
