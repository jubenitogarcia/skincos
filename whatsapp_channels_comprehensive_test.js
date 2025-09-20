#!/usr/bin/env node

/**
 * Comprehensive WhatsApp Channels Testing Framework
 * Tests all 9 channels (1-9) with complete lifecycle and failure scenarios
 * 
 * Flow: start → QR → status → stop → restart for each channel
 * Includes failure scenario testing and detailed evidence collection
 */

import fs from 'fs/promises';
import path from 'path';

// Configuration
const BASE_URL = 'http://localhost:8099';
const CHANNELS = Array.from({ length: 9 }, (_, i) => i + 1); // Channels 1-9
const CHANNEL_TO_PORT_MAP = {
    1: 3001, 2: 3002, 3: 3003, 4: 3004, 5: 3005,
    6: 3006, 7: 3007, 8: 3008, 9: 3009
};

// Test Results Storage
const testResults = {
    timestamp: new Date().toISOString(),
    environment: BASE_URL,
    summary: {},
    channels: {},
    failures: [],
    recommendations: []
};

// Utility Functions
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    console.log(logEntry);
    
    if (data) {
        console.log('Data:', JSON.stringify(data, null, 2));
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Enhanced HTTP client with robust error handling and detailed logging
async function apiRequest(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const startTime = Date.now();
    
    try {
        log('info', `API Request: ${options.method || 'GET'} ${endpoint}`);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...options.headers
            },
            ...options
        });
        
        const responseTime = Date.now() - startTime;
        const responseData = response.headers.get('content-type')?.includes('application/json') 
            ? await response.json() 
            : await response.text();
        
        const result = {
            success: response.ok,
            status: response.status,
            statusText: response.statusText,
            responseTime,
            data: responseData,
            headers: Object.fromEntries(response.headers.entries())
        };
        
        if (response.ok) {
            log('info', `✅ API Success: ${response.status} in ${responseTime}ms`);
        } else {
            log('error', `❌ API Error: ${response.status} ${response.statusText} in ${responseTime}ms`, responseData);
        }
        
        return result;
    } catch (error) {
        const responseTime = Date.now() - startTime;
        log('error', `🔥 API Exception after ${responseTime}ms:`, error.message);
        return {
            success: false,
            status: 0,
            statusText: 'Network Error',
            responseTime,
            error: error.message,
            data: null
        };
    }
}

// Orchestrator Status and Health Check
async function checkOrchestratorHealth() {
    log('info', '🏥 Checking WhatsApp Orchestrator health...');
    
    const healthCheck = await apiRequest('/health');
    const statusCheck = await apiRequest('/api/wa-orchestrator/status');
    
    testResults.orchestratorHealth = {
        health: healthCheck,
        status: statusCheck
    };
    
    if (!healthCheck.success || !statusCheck.success) {
        log('error', '💥 Orchestrator health check failed');
        return false;
    }
    
    log('info', '✅ Orchestrator is healthy and ready for testing');
    return true;
}

// Core Channel Testing Functions
async function startChannel(channel) {
    log('info', `🚀 Starting channel ${channel}...`);
    
    const result = await apiRequest(`/api/wa-orchestrator/channels/${channel}/start`, {
        method: 'POST',
        body: JSON.stringify({ name: `Test-Channel-${channel}` })
    });
    
    if (result.success && result.data?.success) {
        log('info', `✅ Channel ${channel} start request successful`);
        // Wait a bit for process initialization
        await sleep(3000);
        return result;
    } else {
        log('error', `❌ Failed to start channel ${channel}`, result);
        return result;
    }
}

async function getChannelQR(channel) {
    log('info', `📱 Getting QR code for channel ${channel}...`);
    
    const result = await apiRequest(`/api/wa-orchestrator/channels/${channel}/qr`);
    
    if (result.success && result.data?.qr) {
        log('info', `✅ QR code retrieved for channel ${channel} (${result.data.qr.length} chars)`);
        return result;
    } else if (result.success && result.data?.status === 'qr_pending') {
        log('info', `⏳ QR pending for channel ${channel}, will retry...`);
        await sleep(2000);
        return await getChannelQR(channel); // Retry once
    } else {
        log('error', `❌ Failed to get QR for channel ${channel}`, result);
        return result;
    }
}

async function getChannelStatus(channel) {
    log('info', `📊 Getting status for channel ${channel}...`);
    
    const result = await apiRequest(`/api/wa-orchestrator/channels/${channel}`);
    
    if (result.success) {
        const status = result.data?.status || 'unknown';
        log('info', `📋 Channel ${channel} status: ${status}`);
        return result;
    } else {
        log('error', `❌ Failed to get status for channel ${channel}`, result);
        return result;
    }
}

async function stopChannel(channel) {
    log('info', `🛑 Stopping channel ${channel}...`);
    
    const result = await apiRequest(`/api/wa-orchestrator/channels/${channel}/stop`, {
        method: 'POST'
    });
    
    if (result.success && result.data?.success) {
        log('info', `✅ Channel ${channel} stopped successfully`);
        await sleep(2000); // Wait for cleanup
        return result;
    } else {
        log('error', `❌ Failed to stop channel ${channel}`, result);
        return result;
    }
}

async function restartChannel(channel) {
    log('info', `🔄 Restarting channel ${channel}...`);
    
    const result = await apiRequest(`/api/wa-orchestrator/channels/${channel}/restart`, {
        method: 'POST'
    });
    
    if (result.success && result.data?.success) {
        log('info', `✅ Channel ${channel} restart initiated`);
        await sleep(3000); // Wait for restart process
        return result;
    } else {
        log('error', `❌ Failed to restart channel ${channel}`, result);
        return result;
    }
}

// Complete Channel Test Flow
async function testChannelFlow(channel) {
    log('info', `\n🧪 ============ Testing Channel ${channel} (Port ${CHANNEL_TO_PORT_MAP[channel]}) ============`);
    
    const channelResults = {
        channel,
        port: CHANNEL_TO_PORT_MAP[channel],
        tests: {},
        errors: [],
        startTime: Date.now(),
        success: true
    };
    
    try {
        // Step 1: Start Channel
        log('info', `\n📍 Step 1: Starting Channel ${channel}`);
        channelResults.tests.start = await startChannel(channel);
        if (!channelResults.tests.start.success) {
            throw new Error('Failed to start channel');
        }
        
        // Step 2: Get QR Code
        log('info', `\n📍 Step 2: Getting QR Code for Channel ${channel}`);
        channelResults.tests.qr = await getChannelQR(channel);
        // QR might not be immediately available, so we don't fail here
        
        // Step 3: Monitor Status
        log('info', `\n📍 Step 3: Monitoring Status for Channel ${channel}`);
        channelResults.tests.status = await getChannelStatus(channel);
        
        // Step 4: Stop Channel
        log('info', `\n📍 Step 4: Stopping Channel ${channel}`);
        channelResults.tests.stop = await stopChannel(channel);
        if (!channelResults.tests.stop.success) {
            channelResults.errors.push('Failed to stop channel properly');
        }
        
        // Step 5: Restart Channel
        log('info', `\n📍 Step 5: Restarting Channel ${channel}`);
        channelResults.tests.restart = await restartChannel(channel);
        if (!channelResults.tests.restart.success) {
            channelResults.errors.push('Failed to restart channel');
        }
        
        // Final status check after restart
        log('info', `\n📍 Step 6: Final Status Check for Channel ${channel}`);
        await sleep(2000);
        channelResults.tests.finalStatus = await getChannelStatus(channel);
        
        // Final cleanup - stop the channel
        log('info', `\n📍 Cleanup: Stopping Channel ${channel} after tests`);
        const cleanup = await stopChannel(channel);
        channelResults.tests.cleanup = cleanup;
        
    } catch (error) {
        log('error', `❌ Channel ${channel} test failed:`, error.message);
        channelResults.success = false;
        channelResults.errors.push(error.message);
        
        // Try to stop the channel even if tests failed
        try {
            await stopChannel(channel);
        } catch (cleanupError) {
            log('error', `Failed to cleanup channel ${channel}:`, cleanupError.message);
        }
    }
    
    channelResults.endTime = Date.now();
    channelResults.totalTime = channelResults.endTime - channelResults.startTime;
    
    log('info', `\n📊 Channel ${channel} test completed in ${channelResults.totalTime}ms`);
    log('info', `Success: ${channelResults.success ? '✅' : '❌'}`);
    if (channelResults.errors.length > 0) {
        log('info', `Errors: ${channelResults.errors.join(', ')}`);
    }
    
    return channelResults;
}

// Failure Scenario Testing
async function testFailureScenarios() {
    log('info', '\n🧪 ============ Testing Failure Scenarios ============');
    
    const failureTests = {
        portOccupied: null,
        invalidChannel: null,
        qrTimeout: null,
        doubleStart: null
    };
    
    try {
        // Test invalid channel numbers
        log('info', '\n📍 Testing invalid channel numbers...');
        const invalidChannels = [0, 10, -1, 999];
        for (const invalidChannel of invalidChannels) {
            const result = await apiRequest(`/api/wa-orchestrator/channels/${invalidChannel}/start`, {
                method: 'POST'
            });
            if (!failureTests.invalidChannel) failureTests.invalidChannel = [];
            failureTests.invalidChannel.push({
                channel: invalidChannel,
                result: result
            });
        }
        
        // Test double start (start channel twice)
        log('info', '\n📍 Testing double start scenario...');
        const testChannel = 1;
        const firstStart = await startChannel(testChannel);
        await sleep(1000);
        const secondStart = await startChannel(testChannel);
        failureTests.doubleStart = {
            firstStart,
            secondStart
        };
        // Cleanup
        await stopChannel(testChannel);
        
    } catch (error) {
        log('error', 'Error in failure scenario testing:', error.message);
    }
    
    return failureTests;
}

// Generate comprehensive test report
async function generateTestReport() {
    const report = {
        ...testResults,
        summary: {
            totalChannels: Object.keys(testResults.channels).length,
            successfulChannels: Object.values(testResults.channels).filter(c => c.success).length,
            failedChannels: Object.values(testResults.channels).filter(c => !c.success).length,
            totalTestTime: Math.max(...Object.values(testResults.channels).map(c => c.totalTime || 0)),
            avgResponseTime: Object.values(testResults.channels)
                .flatMap(c => Object.values(c.tests))
                .filter(t => t?.responseTime)
                .reduce((sum, t, _, arr) => sum + t.responseTime / arr.length, 0)
        }
    };
    
    // Generate recommendations
    if (report.summary.failedChannels > 0) {
        report.recommendations.push('Some channels failed - check error logs and retry failed operations');
    }
    
    if (report.summary.avgResponseTime > 5000) {
        report.recommendations.push('High average response time detected - consider optimizing API performance');
    }
    
    if (report.summary.successfulChannels === 9) {
        report.recommendations.push('All channels tested successfully - system is ready for production use');
    }
    
    // Save detailed report
    const reportPath = `whatsapp_channels_test_report_${Date.now()}.json`;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    // Generate summary report
    const summaryReport = `
# WhatsApp Channels Comprehensive Test Report
Generated: ${report.timestamp}
Environment: ${report.environment}

## Summary
- **Total Channels Tested**: ${report.summary.totalChannels}/9
- **Successful Channels**: ${report.summary.successfulChannels}
- **Failed Channels**: ${report.summary.failedChannels}
- **Average Response Time**: ${Math.round(report.summary.avgResponseTime)}ms

## Channel Results
${Object.entries(report.channels).map(([channel, result]) => 
    `### Channel ${channel} (Port ${result.port})
- **Status**: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}
- **Test Time**: ${result.totalTime}ms
- **Errors**: ${result.errors.length > 0 ? result.errors.join(', ') : 'None'}

**Test Results:**
${Object.entries(result.tests).map(([test, data]) => 
    `  - ${test}: ${data?.success ? '✅' : '❌'} (${data?.responseTime || 0}ms)`
).join('\n')}
`).join('\n')}

## Failure Scenarios
${Object.entries(report.failureTests || {}).map(([test, result]) => 
    `- **${test}**: ${result ? '✅ Tested' : '⏭️ Skipped'}`
).join('\n')}

## Recommendations
${report.recommendations.map(rec => `- ${rec}`).join('\n')}

## Detailed Results
Full detailed results saved to: ${reportPath}
`;
    
    const summaryPath = `whatsapp_channels_test_summary_${Date.now()}.md`;
    await fs.writeFile(summaryPath, summaryReport);
    
    log('info', '\n📊 ============ TEST REPORT GENERATED ============');
    log('info', `📁 Detailed Report: ${reportPath}`);
    log('info', `📋 Summary Report: ${summaryPath}`);
    
    return { report, summaryReport, reportPath, summaryPath };
}

// Main test execution
async function runComprehensiveTests() {
    console.log('\n🚀 ============ WhatsApp Channels Comprehensive Test Suite ============\n');
    log('info', 'Starting comprehensive testing of all 9 WhatsApp channels...');
    
    const overallStartTime = Date.now();
    
    try {
        // Health check first
        const isHealthy = await checkOrchestratorHealth();
        if (!isHealthy) {
            throw new Error('Orchestrator health check failed - cannot proceed with tests');
        }
        
        // Test all channels sequentially to avoid conflicts
        for (const channel of CHANNELS) {
            log('info', `\n⏩ Testing Channel ${channel}/${CHANNELS.length}...`);
            testResults.channels[channel] = await testChannelFlow(channel);
            
            // Brief pause between channels to avoid overwhelming the system
            await sleep(1000);
        }
        
        // Test failure scenarios
        log('info', '\n⏩ Testing failure scenarios...');
        testResults.failureTests = await testFailureScenarios();
        
        // Generate and display report
        const reportData = await generateTestReport();
        
        console.log('\n📊 ============ TEST EXECUTION COMPLETED ============');
        console.log(reportData.summaryReport);
        
        const overallTime = Date.now() - overallStartTime;
        log('info', `🏁 All tests completed in ${overallTime}ms`);
        
        process.exit(0);
        
    } catch (error) {
        log('error', '💥 Critical error during testing:', error.message);
        console.error(error);
        process.exit(1);
    }
}

// Execute tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runComprehensiveTests();
}

export {
    runComprehensiveTests,
    testChannelFlow,
    checkOrchestratorHealth,
    generateTestReport
};