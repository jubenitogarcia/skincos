const { expect } = require('chai');
const path = require('path');
const fs = require('fs');

describe('WhatsApp API Tests', function() {
    describe('Basic API Tests', function() {
        it('should have src directory', function() {
            const srcPath = path.join(__dirname, '..', 'src');
            expect(fs.existsSync(srcPath)).to.be.true;
        });

        it('should have package.json with correct name', function() {
            const packagePath = path.join(__dirname, '..', 'package.json');
            const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            expect(packageData.name).to.equal('@whatsapp-monorepo/whatsapp-api');
        });

        it('should load test helper successfully', function() {
            const helperPath = path.join(__dirname, 'helper.js');
            expect(fs.existsSync(helperPath)).to.be.true;
            
            // Try to require the helper without errors
            expect(() => require('./helper')).to.not.throw();
        });
    });

    describe('Mock and Test Utilities', function() {
        it('should have mock utilities available', function() {
            // Test that our mock utilities can be required
            const mockUtils = require('./mocks/index');
            expect(mockUtils).to.be.an('object');
            expect(mockUtils.createMockClient).to.be.a('function');
            expect(mockUtils.createMockMessage).to.be.a('function');
        });

        it('should create mock client with default options', function() {
            const mockUtils = require('./mocks/index');
            const mockClient = mockUtils.createMockClient();
            
            expect(mockClient).to.be.an('object');
            expect(mockClient.info).to.be.an('object');
            expect(mockClient.info.wid).to.be.an('object');
        });

        it('should create mock message with required properties', function() {
            const mockUtils = require('./mocks/index');
            const mockMessage = mockUtils.createMockMessage({
                body: 'Test message',
                from: '1234567890@c.us'
            });
            
            expect(mockMessage).to.be.an('object');
            expect(mockMessage.body).to.equal('Test message');
            expect(mockMessage.from).to.equal('1234567890@c.us');
            expect(mockMessage.id).to.be.an('object');
        });
    });
});