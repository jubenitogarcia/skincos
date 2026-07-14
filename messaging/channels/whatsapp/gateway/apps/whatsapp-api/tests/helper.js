const path = require('path');
const mockUtils = require('./mocks');

// Mock environment variables for testing
process.env.WWEBJS_TEST_REMOTE_ID = process.env.WWEBJS_TEST_REMOTE_ID || '1234567890@c.us';

const remoteId = process.env.WWEBJS_TEST_REMOTE_ID;

function isUsingLegacySession() {
    return Boolean(process.env.WWEBJS_TEST_SESSION || process.env.WWEBJS_TEST_SESSION_PATH);
}

function isMD() {
    return Boolean(process.env.WWEBJS_TEST_MD);
}

function getSessionFromEnv() {
    if (!isUsingLegacySession()) return null;

    const envSession = process.env.WWEBJS_TEST_SESSION;
    if(envSession) return JSON.parse(envSession);

    const envSessionPath = process.env.WWEBJS_TEST_SESSION_PATH;
    if(envSessionPath) {
        const absPath = path.resolve(process.cwd(), envSessionPath);
        return require(absPath);
    }
}

function createClient(options = {}) {
    // For now, return a mock client for testing infrastructure
    return mockUtils.createMockClient(options);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    sleep, 
    createClient,
    isUsingLegacySession,
    isMD,
    remoteId,
};

module.exports = {
    sleep, 
    createClient,
    isUsingLegacySession,
    isMD,
    remoteId,
};