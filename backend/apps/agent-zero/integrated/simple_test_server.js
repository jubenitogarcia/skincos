const express = require('express');
const app = express();
const PORT = 6800;

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'ok', test: true });
});

app.post('/api/message', (req, res) => {
    res.json({ 
        success: true, 
        response: 'Test response from Agent Zero',
        body: req.body 
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Test server running on http://0.0.0.0:${PORT}`);
});
