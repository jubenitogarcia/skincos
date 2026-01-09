#!/usr/bin/env node
/**
 * SKINCOS AI - Instagram Module API Server
 * Node.js-based Instagram API server for integration with SKINCOS AI
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.INSTAGRAM_PORT || 3103;

// Middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP'
});
app.use('/api/', limiter);

// Load configuration
let config = {};
const defaultConfigLocalPath = path.join(__dirname, 'config', 'config.local.json');
const legacyConfigPath = path.join(__dirname, 'config', 'config.json');
const configCandidates = [
    process.env.INSTAGRAM_CONFIG,
    defaultConfigLocalPath,
    legacyConfigPath
].filter(Boolean);

let persistConfigPath = process.env.INSTAGRAM_CONFIG || defaultConfigLocalPath;

async function loadConfig() {
    for (const candidate of configCandidates) {
        try {
            const configData = await fs.readFile(candidate, 'utf8');
            config = JSON.parse(configData);
            if (process.env.INSTAGRAM_CONFIG) {
                persistConfigPath = process.env.INSTAGRAM_CONFIG;
            } else if (candidate === defaultConfigLocalPath) {
                persistConfigPath = defaultConfigLocalPath;
            } else {
                persistConfigPath = defaultConfigLocalPath;
            }
            console.log(`✅ Instagram module configuration loaded (${path.relative(__dirname, candidate)})`);
            return;
        } catch (error) {
            // keep trying next candidate
        }
    }

    console.error('❌ Failed to load configuration from any candidate; falling back to defaults');
    config = {
        accounts: [],
        osint: {
            enable_toutatis: false,
            enable_advanced_osint: true,
            output_format: "json"
        },
        automation: {
            max_likes_per_day: 100,
            max_follows_per_day: 50,
            delay_between_actions: 30,
            enable_smart_delays: true
        },
        api: {
            host: "0.0.0.0",
            port: 3003,
            development_mode: true
        }
    };
}

// Instagram module simulation (placeholder for when dependencies are available)
class InstagramModuleSimulator {
    constructor() {
        this.accounts = new Map();
        this.sessions = new Map();
        this.isInitialized = false;
    }

    async initialize() {
        this.isInitialized = true;
        console.log('🚀 Instagram Module Simulator initialized');
    }

    async addAccount(username, password, accountId = null) {
        const id = accountId || username;
        
        // Simulate account addition
        const account = {
            account_id: id,
            username: username,
            session_file: `sessions/${id}_session.json`,
            added_at: new Date().toISOString(),
            status: 'simulated',
            is_active: true
        };

        this.accounts.set(id, account);
        
        // Save to config
        config.accounts = config.accounts || [];
        config.accounts.push(account);
        await this.saveConfig();

        console.log(`✅ Account ${username} added successfully (simulated)`);
        return id;
    }

    async getAccounts() {
        return Array.from(this.accounts.values());
    }

    async osintInvestigate(username, deepAnalysis = true) {
        // Simulate OSINT investigation
        const result = {
            username: username,
            user_id: 'simulated_' + Math.random().toString(36).substr(2, 9),
            full_name: `Simulated User ${username}`,
            bio: 'This is a simulated OSINT result for development',
            followers_count: Math.floor(Math.random() * 10000),
            following_count: Math.floor(Math.random() * 1000),
            posts_count: Math.floor(Math.random() * 500),
            is_private: Math.random() > 0.5,
            is_verified: Math.random() > 0.8,
            timestamp: new Date().toISOString(),
            analysis_type: deepAnalysis ? 'deep' : 'basic',
            status: 'simulated'
        };

        // Save result
        const resultsDir = path.join(__dirname, 'background_results');
        await fs.mkdir(resultsDir, { recursive: true });
        
        const resultFile = path.join(resultsDir, `osint_${username}_${Date.now()}.json`);
        await fs.writeFile(resultFile, JSON.stringify(result, null, 2));

        return result;
    }

    async getAnalytics(accountId) {
        if (!this.accounts.has(accountId)) {
            throw new Error(`Account ${accountId} not found`);
        }

        return {
            username: this.accounts.get(accountId).username,
            followers_count: Math.floor(Math.random() * 10000),
            following_count: Math.floor(Math.random() * 1000),
            posts_count: Math.floor(Math.random() * 500),
            account_type: 'simulated',
            is_verified: false,
            recent_posts: {
                count: 10,
                total_likes: Math.floor(Math.random() * 5000),
                total_comments: Math.floor(Math.random() * 500),
                avg_likes: Math.floor(Math.random() * 500),
                avg_comments: Math.floor(Math.random() * 50)
            },
            timestamp: new Date().toISOString()
        };
    }

    async downloadContent(username, contentTypes = ['posts'], maxItems = 50) {
        // Simulate content download
        const downloaded = {
            posts: [],
            stories: [],
            highlights: []
        };

        for (const type of contentTypes) {
            const count = Math.min(maxItems, Math.floor(Math.random() * 20) + 1);
            for (let i = 0; i < count; i++) {
                downloaded[type].push(`${username}_${type}_${i + 1}_simulated.jpg`);
            }
        }

        return downloaded;
    }

    async automateEngagement(accountId, targetHashtags = ['photography'], maxLikes = 10, maxFollows = 5) {
        if (!this.accounts.has(accountId)) {
            throw new Error(`Account ${accountId} not found`);
        }

        // Simulate automation
        const stats = {
            likes_performed: Math.floor(Math.random() * maxLikes),
            follows_performed: Math.floor(Math.random() * maxFollows),
            errors: Math.floor(Math.random() * 2),
            target_hashtags: targetHashtags,
            timestamp: new Date().toISOString()
        };

        return stats;
    }

    async healthCheck() {
        return {
            status: 'healthy',
            mode: 'simulation',
            accounts_configured: this.accounts.size,
            active_sessions: this.accounts.size,
            config_loaded: Object.keys(config).length > 0,
            dependencies: {
                express: true,
                node: true,
                python_libs: false // Not available in current environment
            },
            timestamp: new Date().toISOString()
        };
    }

    async saveConfig() {
        try {
            await fs.mkdir(path.dirname(persistConfigPath), { recursive: true });
            await fs.writeFile(persistConfigPath, JSON.stringify(config, null, 2));
        } catch (error) {
            console.error('Failed to save config:', error.message);
        }
    }
}

// Initialize Instagram module
const instagram = new InstagramModuleSimulator();

// Authentication middleware (development mode)
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token && !config.api?.development_mode) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

// Routes

// Health check
app.get('/health', async (req, res) => {
    try {
        const health = await instagram.healthCheck();
        res.json(health);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Account management
app.post('/api/accounts', authMiddleware, async (req, res) => {
    try {
        const { username, password, account_id } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const accountId = await instagram.addAccount(username, password, account_id);
        
        res.json({
            success: true,
            message: 'Account added successfully',
            account_id: accountId
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/api/accounts', authMiddleware, async (req, res) => {
    try {
        const accounts = await instagram.getAccounts();
        res.json({
            success: true,
            accounts: accounts,
            total: accounts.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/accounts/:accountId/analytics', authMiddleware, async (req, res) => {
    try {
        const analytics = await instagram.getAnalytics(req.params.accountId);
        res.json({
            success: true,
            analytics: analytics
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// OSINT endpoints
app.post('/api/osint/investigate', authMiddleware, async (req, res) => {
    try {
        const { username, deep_analysis = true } = req.body;
        
        if (!username) {
            return res.status(400).json({ error: 'Username required' });
        }

        if (deep_analysis) {
            // Start background investigation
            instagram.osintInvestigate(username, true).catch(console.error);
            
            res.json({
                success: true,
                message: 'Deep OSINT investigation started in background',
                username: username,
                status: 'processing'
            });
        } else {
            // Quick investigation
            const result = await instagram.osintInvestigate(username, false);
            res.json({
                success: true,
                result: result
            });
        }
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Content download
app.post('/api/download', authMiddleware, async (req, res) => {
    try {
        const { username, content_types = ['posts'], max_items = 50 } = req.body;
        
        if (!username) {
            return res.status(400).json({ error: 'Username required' });
        }

        const result = await instagram.downloadContent(username, content_types, max_items);
        res.json({
            success: true,
            downloaded_files: result,
            total_files: Object.values(result).flat().length
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Automation
app.post('/api/automation', authMiddleware, async (req, res) => {
    try {
        const { account_id, target_hashtags = ['photography'], max_likes = 10, max_follows = 5 } = req.body;
        
        if (!account_id) {
            return res.status(400).json({ error: 'Account ID required' });
        }

        const stats = await instagram.automateEngagement(account_id, target_hashtags, max_likes, max_follows);
        res.json({
            success: true,
            automation_stats: stats
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Configuration
app.get('/api/config', authMiddleware, async (req, res) => {
    try {
        // Return config without sensitive data
        const safeConfig = { ...config };
        if (safeConfig.accounts) {
            safeConfig.accounts = safeConfig.accounts.map(acc => {
                const { password, ...safe } = acc;
                return safe;
            });
        }
        
        res.json({
            success: true,
            config: safeConfig
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Static files for admin interface
app.use('/admin', express.static(path.join(__dirname, 'interface')));

// Error handling
app.use((error, req, res, next) => {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
async function startServer() {
    try {
        await loadConfig();
        await instagram.initialize();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Instagram API Server running on http://0.0.0.0:${PORT}`);
            console.log(`📊 Health check: http://0.0.0.0:${PORT}/health`);
            console.log(`🎯 Admin interface: http://0.0.0.0:${PORT}/admin`);
            console.log(`⚙️  Mode: ${config.api?.development_mode ? 'Development' : 'Production'}`);
        });
    } catch (error) {
        console.error('❌ Failed to start Instagram API server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Instagram API server shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Instagram API server shutting down...');
    process.exit(0);
});

// Start the server
startServer();
