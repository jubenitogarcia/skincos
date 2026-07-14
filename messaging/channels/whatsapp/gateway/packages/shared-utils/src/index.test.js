const { expect } = require('chai');
const sharedUtils = require('./index');

describe('Shared Utils', function() {
    describe('Package Loading', function() {
        it('should load the package without errors', function() {
            expect(sharedUtils).to.be.an('object');
        });

        it('should export expected utilities', function() {
            expect(sharedUtils).to.have.property('formatPhoneNumber');
            expect(sharedUtils).to.have.property('validateMessagePayload'); 
            expect(sharedUtils).to.have.property('generateMessageId');
            expect(sharedUtils).to.have.property('sanitizeFilename');
            expect(sharedUtils).to.have.property('formatFileSize');
        });
    });

    describe('Phone Number Utilities', function() {
        it('should format phone numbers', function() {
            const formatted = sharedUtils.formatPhoneNumber('1234567890');
            expect(formatted).to.equal('1234567890@c.us');
        });

        it('should handle already formatted numbers', function() {
            const formatted = sharedUtils.formatPhoneNumber('1234567890@c.us');
            expect(formatted).to.equal('1234567890@c.us');
        });

        it('should handle null input', function() {
            const formatted = sharedUtils.formatPhoneNumber(null);
            expect(formatted).to.be.null;
        });
    });

    describe('ID Generation', function() {
        it('should generate unique message IDs', function() {
            const id1 = sharedUtils.generateMessageId();
            const id2 = sharedUtils.generateMessageId();
            
            expect(id1).to.be.a('string');
            expect(id2).to.be.a('string');
            expect(id1).to.not.equal(id2);
            expect(id1).to.include('msg_');
        });
    });

    describe('Message Validation', function() {
        it('should validate valid message payloads', function() {
            const validMessage = { 
                number: '1234567890', 
                message: 'test message',
                type: 'text'
            };
            
            const result = sharedUtils.validateMessagePayload(validMessage);
            expect(result.error).to.be.undefined;
        });

        it('should reject invalid message payloads', function() {
            const invalidMessage = { 
                message: 'test message'
                // missing required number field
            };
            
            const result = sharedUtils.validateMessagePayload(invalidMessage);
            expect(result.error).to.not.be.undefined;
        });
    });

    describe('File Utilities', function() {
        it('should sanitize filenames', function() {
            const result = sharedUtils.sanitizeFilename('test file!@#.txt');
            expect(result).to.equal('test_file_.txt');
        });

        it('should format file sizes', function() {
            expect(sharedUtils.formatFileSize(0)).to.equal('0 Bytes');
            expect(sharedUtils.formatFileSize(1024)).to.equal('1 KB');
            expect(sharedUtils.formatFileSize(1048576)).to.equal('1 MB');
        });
    });
});