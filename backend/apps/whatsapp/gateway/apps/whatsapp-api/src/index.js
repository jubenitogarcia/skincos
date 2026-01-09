/**
 * WhatsApp API Entry Point
 * Main module for the WhatsApp integration API
 */

const Client = require('./Client');
const { LegacySessionAuth, LocalAuth, NoAuth } = require('./authStrategies');
const { DefaultOptions, WAState, MessageTypes } = require('./util/Constants');

// Structures
const Chat = require('./structures/Chat');
const Contact = require('./structures/Contact');
const Message = require('./structures/Message');
const MessageMedia = require('./structures/MessageMedia');
const Location = require('./structures/Location');
const GroupChat = require('./structures/GroupChat');
const PrivateChat = require('./structures/PrivateChat');

// Utilities
const Util = require('./util/Util');

module.exports = {
    // Main client
    Client,
    
    // Authentication strategies
    LegacySessionAuth,
    LocalAuth,
    NoAuth,
    
    // Constants
    DefaultOptions,
    WAState,
    MessageTypes,
    
    // Structures
    Chat,
    Contact, 
    Message,
    MessageMedia,
    Location,
    GroupChat,
    PrivateChat,
    
    // Utilities
    Util
};