const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Sistema de Criptografia para License Keys e Dados Sensíveis
 * 
 * Implementa criptografia AES-256-GCM para proteger:
 * - License keys
 * - Configurações sensíveis
 * - Dados de sessão
 * - Outros dados confidenciais
 */

// ========== CONFIGURAÇÕES DE CRIPTOGRAFIA ==========

const ENCRYPTION_CONFIG = {
    algorithm: 'aes-256-gcm',
    keyLength: 32, // 256 bits
    ivLength: 16,  // 128 bits
    tagLength: 16, // 128 bits
    saltLength: 32, // 256 bits
    iterations: 100000 // PBKDF2 iterations
};

// Chave mestra - persistente e consistente
function getMasterKey() {
    const MASTER_KEY_FILE = path.join(__dirname, '..', '.master-key');
    
    // Tentar variável de ambiente primeiro
    if (process.env.ENCRYPTION_MASTER_KEY) {
        return process.env.ENCRYPTION_MASTER_KEY;
    }
    
    // Tentar arquivo de chave persistente
    if (fs.existsSync(MASTER_KEY_FILE)) {
        try {
            return fs.readFileSync(MASTER_KEY_FILE, 'utf8').trim();
        } catch (error) {
            console.warn('⚠️ Failed to read master key file, generating new one');
        }
    }
    
    // Gerar nova chave e salvar
    const newKey = crypto.randomBytes(ENCRYPTION_CONFIG.keyLength).toString('hex');
    try {
        fs.writeFileSync(MASTER_KEY_FILE, newKey, { mode: 0o600 }); // Permissões restritivas
        console.log('🔑 Generated new persistent master key');
        return newKey;
    } catch (error) {
        console.error('❌ Failed to save master key, using temporary key');
        return newKey;
    }
}

const MASTER_KEY = getMasterKey();

/**
 * Deriva uma chave a partir da chave mestra e um salt
 */
function deriveKey(masterKey, salt) {
    // Ensure masterKey is a buffer for proper key derivation
    const keyBuffer = typeof masterKey === 'string' ? Buffer.from(masterKey, 'hex') : masterKey;
    const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(salt, 'hex');
    
    return crypto.pbkdf2Sync(
        keyBuffer, 
        saltBuffer, 
        ENCRYPTION_CONFIG.iterations, 
        ENCRYPTION_CONFIG.keyLength, 
        'sha256'
    );
}

/**
 * Criptografa dados usando AES-256-GCM
 */
function encrypt(plaintext, customKey = null) {
    try {
        // Gerar salt e IV aleatórios
        const salt = crypto.randomBytes(ENCRYPTION_CONFIG.saltLength);
        const iv = crypto.randomBytes(ENCRYPTION_CONFIG.ivLength);
        
        // Derivar chave
        const key = customKey || deriveKey(MASTER_KEY, salt);
        
        // Criar cipher usando API moderna (Cipheriv para GCM)
        const cipher = crypto.createCipheriv(ENCRYPTION_CONFIG.algorithm, key, iv);
        cipher.setAAD(salt); // Adicionar salt como dados autenticados
        
        // Criptografar
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        // Obter tag de autenticação
        const tag = cipher.getAuthTag();
        
        // Combinar tudo em um formato estruturado
        const result = {
            encrypted,
            salt: salt.toString('hex'),
            iv: iv.toString('hex'),
            tag: tag.toString('hex'),
            algorithm: ENCRYPTION_CONFIG.algorithm
        };
        
        return {
            success: true,
            data: Buffer.from(JSON.stringify(result)).toString('base64')
        };
        
    } catch (error) {
        console.error('❌ Encryption error:', error.message);
        return {
            success: false,
            error: 'Encryption failed'
        };
    }
}

/**
 * Descriptografa dados usando AES-256-GCM
 */
function decrypt(encryptedData, customKey = null) {
    try {
        // Fallback para dados em texto simples (migração)
        if (typeof encryptedData === 'string' && !encryptedData.startsWith('eyJ')) {
            // Se não é base64, pode ser texto simples
            return {
                success: true,
                data: encryptedData,
                isPlaintext: true
            };
        }
        
        // Parse do formato estruturado com fallback
        let parsed;
        try {
            parsed = JSON.parse(Buffer.from(encryptedData, 'base64').toString('utf8'));
        } catch (parseError) {
            console.warn('⚠️ Failed to parse encrypted data, trying as plaintext');
            // Tentar como texto simples
            try {
                parsed = JSON.parse(encryptedData);
                return {
                    success: true,
                    data: encryptedData,
                    isPlaintext: true
                };
            } catch (plaintextError) {
                throw new Error('Invalid encrypted data format');
            }
        }
        
        const { encrypted, salt, iv, tag, algorithm } = parsed;
        
        // Verificar se os campos necessários existem
        if (!encrypted || !salt || !iv || !tag || !algorithm) {
            throw new Error('Missing required encryption fields');
        }
        
        // Verificar algoritmo
        if (algorithm !== ENCRYPTION_CONFIG.algorithm) {
            throw new Error('Unsupported encryption algorithm');
        }
        
        // Derivar chave
        const key = customKey || deriveKey(MASTER_KEY, Buffer.from(salt, 'hex'));
        
        // Criar decipher usando API moderna (Decipheriv para GCM)
        const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(iv, 'hex'));
        decipher.setAAD(Buffer.from(salt, 'hex'));
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        
        // Descriptografar
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return {
            success: true,
            data: decrypted
        };
        
    } catch (error) {
        console.error('❌ Decryption error:', error.message);
        return {
            success: false,
            error: 'Decryption failed',
            details: error.message
        };
    }
}

/**
 * Criptografa uma license key
 */
function encryptLicenseKey(licenseKey, metadata = {}) {
    const licenseData = {
        key: licenseKey,
        metadata,
        timestamp: new Date().toISOString(),
        version: '1.0'
    };
    
    return encrypt(JSON.stringify(licenseData));
}

/**
 * Descriptografa uma license key
 */
function decryptLicenseKey(encryptedLicenseKey) {
    const result = decrypt(encryptedLicenseKey);
    
    if (!result.success) {
        return result;
    }
    
    try {
        const licenseData = JSON.parse(result.data);
        return {
            success: true,
            licenseKey: licenseData.key,
            metadata: licenseData.metadata || {},
            timestamp: licenseData.timestamp,
            version: licenseData.version
        };
    } catch (error) {
        return {
            success: false,
            error: 'Invalid license key format'
        };
    }
}

/**
 * Criptografa configurações sensíveis
 */
function encryptConfig(config) {
    return encrypt(JSON.stringify(config));
}

/**
 * Descriptografa configurações sensíveis
 */
function decryptConfig(encryptedConfig) {
    const result = decrypt(encryptedConfig);
    
    if (!result.success) {
        return result;
    }
    
    try {
        return {
            success: true,
            config: JSON.parse(result.data)
        };
    } catch (error) {
        return {
            success: false,
            error: 'Invalid config format'
        };
    }
}

/**
 * Salva dados criptografados em arquivo
 */
function saveEncryptedFile(filePath, data) {
    try {
        const encryptResult = encrypt(JSON.stringify(data));
        
        if (!encryptResult.success) {
            return encryptResult;
        }
        
        // Criar diretório se não existir
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(filePath, encryptResult.data);
        
        return { success: true };
    } catch (error) {
        console.error('❌ Error saving encrypted file:', error.message);
        return {
            success: false,
            error: 'Failed to save encrypted file'
        };
    }
}

/**
 * Carrega dados criptografados de arquivo
 */
function loadEncryptedFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return {
                success: false,
                error: 'File not found'
            };
        }
        
        const encryptedData = fs.readFileSync(filePath, 'utf8');
        const decryptResult = decrypt(encryptedData);
        
        if (!decryptResult.success) {
            return decryptResult;
        }
        
        return {
            success: true,
            data: JSON.parse(decryptResult.data)
        };
    } catch (error) {
        console.error('❌ Error loading encrypted file:', error.message);
        return {
            success: false,
            error: 'Failed to load encrypted file'
        };
    }
}

/**
 * Gera hash seguro para senhas
 */
function hashPassword(password, salt = null) {
    try {
        const passwordSalt = salt || crypto.randomBytes(ENCRYPTION_CONFIG.saltLength);
        const hash = crypto.pbkdf2Sync(
            password,
            passwordSalt,
            ENCRYPTION_CONFIG.iterations,
            ENCRYPTION_CONFIG.keyLength,
            'sha256'
        );
        
        return {
            success: true,
            hash: hash.toString('hex'),
            salt: passwordSalt.toString('hex')
        };
    } catch (error) {
        console.error('❌ Password hashing error:', error.message);
        return {
            success: false,
            error: 'Password hashing failed'
        };
    }
}

/**
 * Verifica senha contra hash
 */
function verifyPassword(password, hash, salt) {
    try {
        const hashResult = hashPassword(password, Buffer.from(salt, 'hex'));
        
        if (!hashResult.success) {
            return { success: false, error: 'Hash generation failed' };
        }
        
        return {
            success: true,
            valid: crypto.timingSafeEqual(
                Buffer.from(hashResult.hash, 'hex'),
                Buffer.from(hash, 'hex')
            )
        };
    } catch (error) {
        console.error('❌ Password verification error:', error.message);
        return {
            success: false,
            error: 'Password verification failed'
        };
    }
}

/**
 * Gera chave de criptografia segura
 */
function generateEncryptionKey() {
    return crypto.randomBytes(ENCRYPTION_CONFIG.keyLength).toString('hex');
}

/**
 * Gera salt aleatório
 */
function generateSalt() {
    return crypto.randomBytes(ENCRYPTION_CONFIG.saltLength).toString('hex');
}

/**
 * Migrate old plaintext or corrupted configurations to new encrypted format
 */
function migrateConfiguration(oldData) {
    try {
        // If it's a string, try to parse as JSON
        let config = typeof oldData === 'string' ? JSON.parse(oldData) : oldData;
        
        // Check if it needs migration (lacks encryption markers)
        if (!config.version || config.version < '2.0') {
            console.log('🔄 Migrating configuration to encrypted format v2.0...');
            
            // Ensure proper structure
            if (!config.licenses) config.licenses = [];
            if (!config.activeChannels) config.activeChannels = [];
            
            // Mark as migrated
            config.version = '2.0';
            config.migrated = true;
            config.migratedAt = new Date().toISOString();
            
            return {
                success: true,
                config: config,
                migrated: true
            };
        }
        
        return {
            success: true,
            config: config,
            migrated: false
        };
    } catch (error) {
        console.error('❌ Migration error:', error.message);
        return {
            success: false,
            error: 'Configuration migration failed',
            details: error.message
        };
    }
}

/**
 * Validate and repair encrypted configuration
 */
function validateAndRepairConfig(configPath) {
    try {
        if (!fs.existsSync(configPath)) {
            return { success: false, error: 'Configuration file not found' };
        }
        
        const rawData = fs.readFileSync(configPath, 'utf8');
        
        // Try to load as encrypted first
        const encryptedResult = decrypt(rawData);
        
        if (encryptedResult.success) {
            const config = JSON.parse(encryptedResult.data);
            console.log('✅ Encrypted configuration is valid');
            return { success: true, config: config, encrypted: true };
        }
        
        // Try as plaintext and migrate
        console.log('⚠️ Encrypted loading failed, attempting migration...');
        const migrationResult = migrateConfiguration(rawData);
        
        if (migrationResult.success) {
            // Save migrated config in encrypted format
            const saveResult = saveEncryptedFile(configPath, migrationResult.config);
            if (saveResult.success) {
                console.log('✅ Configuration migrated and saved successfully');
                return {
                    success: true,
                    config: migrationResult.config,
                    migrated: true,
                    encrypted: true
                };
            }
        }
        
        return {
            success: false,
            error: 'Configuration validation and repair failed'
        };
        
    } catch (error) {
        console.error('❌ Config validation error:', error.message);
        return {
            success: false,
            error: 'Configuration validation failed',
            details: error.message
        };
    }
}

/**
 * Test encryption/decryption functionality
 */
function testEncryptionSystem() {
    console.log('🧪 Testing encryption system...');
    
    const testData = {
        message: 'Test encryption data',
        timestamp: new Date().toISOString(),
        numbers: [1, 2, 3, 4, 5],
        nested: {
            value: 'nested test',
            array: ['a', 'b', 'c']
        }
    };
    
    try {
        // Test basic encryption/decryption
        const encryptResult = encrypt(JSON.stringify(testData));
        if (!encryptResult.success) {
            return { success: false, error: 'Encryption test failed', details: encryptResult.error };
        }
        
        const decryptResult = decrypt(encryptResult.data);
        if (!decryptResult.success) {
            return { success: false, error: 'Decryption test failed', details: decryptResult.error };
        }
        
        const decryptedData = JSON.parse(decryptResult.data);
        
        // Verify data integrity
        if (JSON.stringify(testData) !== JSON.stringify(decryptedData)) {
            return { success: false, error: 'Data integrity check failed' };
        }
        
        // Test license key encryption
        const licenseResult = encryptLicenseKey('TEST_LICENSE_123', { type: 'test' });
        if (!licenseResult.success) {
            return { success: false, error: 'License encryption test failed' };
        }
        
        const licenseDecryptResult = decryptLicenseKey(licenseResult.data);
        if (!licenseDecryptResult.success || licenseDecryptResult.licenseKey !== 'TEST_LICENSE_123') {
            return { success: false, error: 'License decryption test failed' };
        }
        
        console.log('✅ Encryption system test passed');
        return { 
            success: true,
            tests: [
                'Basic encryption/decryption',
                'Data integrity verification',
                'License key encryption',
                'License key decryption'
            ]
        };
        
    } catch (error) {
        console.error('❌ Encryption test error:', error.message);
        return {
            success: false,
            error: 'Encryption system test failed',
            details: error.message
        };
    }
}

/**
 * Middleware para verificar integridade de dados
 */
function createIntegrityCheckMiddleware() {
    return (req, res, next) => {
        // Para requests com body, verificar integridade se necessário
        if (req.body && req.headers['x-integrity-check']) {
            const expectedHash = req.headers['x-integrity-check'];
            const bodyString = JSON.stringify(req.body);
            const actualHash = crypto.createHash('sha256').update(bodyString).digest('hex');
            
            if (expectedHash !== actualHash) {
                return res.status(400).json({
                    success: false,
                    error: 'Data integrity check failed',
                    code: 'INTEGRITY_CHECK_FAILED'
                });
            }
        }
        
        next();
    };
}

module.exports = {
    // Funções principais de criptografia
    encrypt,
    decrypt,
    
    // Funções específicas para license keys
    encryptLicenseKey,
    decryptLicenseKey,
    
    // Funções para configurações
    encryptConfig,
    decryptConfig,
    
    // Funções para arquivos
    saveEncryptedFile,
    loadEncryptedFile,
    
    // Funções para senhas
    hashPassword,
    verifyPassword,
    
    // Utilitários
    generateEncryptionKey,
    generateSalt,
    deriveKey,
    
    // Migration and validation functions
    migrateConfiguration,
    validateAndRepairConfig,
    testEncryptionSystem,
    
    // Middleware
    createIntegrityCheckMiddleware,
    
    // Configurações
    ENCRYPTION_CONFIG
};