/**
 * Shared utilities for WhatsApp monorepo
 */

const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');

/**
 * Format phone number to WhatsApp format
 * @param {string} phone - Phone number
 * @returns {string} Formatted phone number
 */
function formatPhoneNumber(phone) {
  if (!phone) return null;
  
  // Remove all non-numeric characters
  const cleaned = phone.replace(/\D/g, '');
  
  // Add @c.us suffix if not present
  return cleaned.includes('@') ? cleaned : `${cleaned}@c.us`;
}

/**
 * Validate message payload
 * @param {object} payload - Message payload
 * @returns {object} Validation result
 */
function validateMessagePayload(payload) {
  const schema = Joi.object({
    number: Joi.string().required(),
    message: Joi.string().required(),
    type: Joi.string().valid('text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact').default('text'),
    url: Joi.string().uri().when('type', {
      is: Joi.string().valid('image', 'video', 'audio', 'document', 'sticker'),
      then: Joi.required(),
      otherwise: Joi.optional()
    })
  });
  
  return schema.validate(payload);
}

/**
 * Generate unique message ID
 * @returns {string} Unique ID
 */
function generateMessageId() {
  return `msg_${uuidv4()}`;
}

/**
 * Sanitize filename for safe storage
 * @param {string} filename - Original filename
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(filename) {
  if (!filename) return 'unnamed_file';
  
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
}

/**
 * Calculate file size in human readable format
 * @param {number} bytes - File size in bytes
 * @returns {string} Human readable size
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
  formatPhoneNumber,
  validateMessagePayload,
  generateMessageId,
  sanitizeFilename,
  formatFileSize,
};