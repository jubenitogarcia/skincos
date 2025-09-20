const express = require('express');
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const MessageService = require('../lib/message-service');
const ContactService = require('../lib/contact-service');
const HybridQueue = require('../lib/hybrid-queue');
const RateLimiter = require('../lib/rate-limiter');
const TemplateService = require('../lib/template-service');
const SegmentationService = require('../lib/segmentation-service');
const CampaignService = require('../lib/campaign-service');
const AuthMiddleware = require('../middleware/auth-middleware');

const router = express.Router();

// Initialize services
const messageService = new MessageService();
const contactService = new ContactService();
const hybridQueue = new HybridQueue();
const rateLimiter = new RateLimiter();
const templateService = new TemplateService();
const segmentationService = new SegmentationService();
const campaignService = new CampaignService();
const authMiddleware = new AuthMiddleware();

// Apply security middleware
router.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// Apply rate limiting to all enterprise API routes
router.use(authMiddleware.getApiRateLimit());

// Initialize hybrid queue on startup
console.log('🔧 Enterprise API initializing with Phase 4: Templates & Campaigns support...');
console.log('🔐 Enterprise API security middleware activated');

/**
 * POST /v1/messages - Send a message
 * Implements the complete pipeline: validation → normalization → persistence → queue
 * Requires authentication and messages:send permission
 */
router.post('/messages',
    authMiddleware.requireAuth(),
    authMiddleware.requirePermission('messages:send'),
    authMiddleware.enforceTenantIsolation(),
    async (req, res) => {
    try {
        const {
            to_number,
            message_type = 'text',
            content_text,
            media_url,
            media_type,
            media_filename,
            caption,
            location_latitude,
            location_longitude,
            location_description,
            tenant_id = req.auth.tenant_id, // Use authenticated user's tenant
            phone_number_id = 'default',
            priority = 5,
            scheduled_at,
            metadata = {}
        } = req.body;

        // Step 1: Validate payload
        if (!to_number) {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'to_number is required'
            });
        }

        if (!message_type) {
            return res.status(400).json({
                error: 'Validation failed', 
                details: 'message_type is required'
            });
        }

        // Step 2: Normalize and validate message
        const normalizedMessage = await messageService.validateAndNormalize({
            to_number,
            message_type,
            content_text,
            media_url,
            media_type,
            media_filename,
            caption,
            location_latitude,
            location_longitude,
            location_description,
            tenant_id,
            phone_number_id,
            priority,
            scheduled_at,
            metadata
        });

        // Step 3: Check rate limits
        const rateLimitCheck = await rateLimiter.checkRateLimit(
            tenant_id,
            message_type,
            phone_number_id,
            1
        );

        if (!rateLimitCheck.allowed) {
            return res.status(429).json({
                error: 'Rate limit exceeded',
                details: `Too many ${message_type} messages. Try again later.`,
                retry_after: rateLimitCheck.retryAfter,
                tokens_remaining: rateLimitCheck.tokensRemaining,
                reset_at: rateLimitCheck.resetAt
            });
        }

        // Step 4: Persist message (status=queued)
        const persistedMessage = await messageService.persistMessage(normalizedMessage);

        // Step 5: Push to queue (Hybrid: Redis or Memory with outbox)
        const queueResult = await hybridQueue.enqueueMessage(persistedMessage, {
            priority,
            scheduled_at
        });

        // Step 6: Return response with message ID and status
        res.status(201).json({
            success: true,
            message_id: persistedMessage.id,
            status: 'queued',
            to_number: persistedMessage.to_number_e164,
            message_type: persistedMessage.message_type,
            created_at: persistedMessage.created_at,
            queue_info: {
                queue_message_id: queueResult.queueMessageId,
                queue_type: queueResult.queueType || queueResult.queueMode,
                stream_name: queueResult.streamName
            },
            rate_limit: {
                tokens_remaining: rateLimitCheck.tokensRemaining,
                reset_at: rateLimitCheck.resetAt
            }
        });

    } catch (error) {
        console.error('Error in POST /v1/messages:', error);
        
        if (error.message.includes('Validation failed')) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.message.replace('Validation failed: ', '')
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to process message request'
        });
    }
});

/**
 * GET /v1/messages - List messages with filters
 * Supports filtering by date, status, type, contact, direction
 */
router.get('/messages', async (req, res) => {
    try {
        const {
            date_from,
            date_to,
            status,
            message_type,
            chat_id,
            tenant_id = 'default',
            limit = 50,
            offset = 0
        } = req.query;

        // Validate pagination
        const parsedLimit = Math.min(parseInt(limit) || 50, 100); // Max 100 per request
        const parsedOffset = Math.max(parseInt(offset) || 0, 0);

        const filters = {
            tenant_id,
            ...(status && { status }),
            ...(message_type && { message_type }),
            ...(chat_id && { chat_id }),
            ...(date_from && { date_from }),
            ...(date_to && { date_to })
        };

        const result = await messageService.getMessages(filters, {
            limit: parsedLimit,
            offset: parsedOffset
        });

        // Calculate pagination info
        const totalPages = Math.ceil(result.total / parsedLimit);
        const currentPage = Math.floor(parsedOffset / parsedLimit) + 1;

        res.json({
            success: true,
            messages: result.messages,
            pagination: {
                total: result.total,
                limit: parsedLimit,
                offset: parsedOffset,
                current_page: currentPage,
                total_pages: totalPages,
                has_next: currentPage < totalPages,
                has_prev: currentPage > 1
            },
            filters: filters
        });

    } catch (error) {
        console.error('Error in GET /v1/messages:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to retrieve messages'
        });
    }
});

/**
 * GET /v1/messages/{id} - Get message detail + metadata
 * Includes full status history and delivery attempts
 */
router.get('/messages/:id', async (req, res) => {
    try {
        const messageId = req.params.id;

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(messageId)) {
            return res.status(400).json({
                error: 'Invalid message ID format',
                details: 'Message ID must be a valid UUID'
            });
        }

        const message = await messageService.getMessageById(messageId);

        if (!message) {
            return res.status(404).json({
                error: 'Message not found',
                details: `No message found with ID: ${messageId}`
            });
        }

        // Get delivery attempts
        const deliveryAttemptsQuery = `
            SELECT attempt_number, status, error_message, error_type, retry_after, created_at
            FROM delivery_attempts 
            WHERE message_id = $1 
            ORDER BY attempt_number
        `;
        const deliveryResult = await messageService.pool.query(deliveryAttemptsQuery, [messageId]);

        res.json({
            success: true,
            message: {
                ...message,
                delivery_attempts: deliveryResult.rows,
                status_history: message.status_history || []
            }
        });

    } catch (error) {
        console.error('Error in GET /v1/messages/:id:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to retrieve message details'
        });
    }
});

/**
 * PUT /v1/messages/{id}/status - Manual status update (fallback)
 * Allows manual status updates for debugging or fallback scenarios
 */
router.put('/messages/:id/status', async (req, res) => {
    try {
        const messageId = req.params.id;
        const { status, reason, external_id } = req.body;

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(messageId)) {
            return res.status(400).json({
                error: 'Invalid message ID format'
            });
        }

        // Validate status
        const validStatuses = ['queued', 'sending', 'sent', 'delivered', 'read', 'failed'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                error: 'Invalid status',
                details: `Status must be one of: ${validStatuses.join(', ')}`
            });
        }

        // Check if message exists
        const existingMessage = await messageService.getMessageById(messageId);
        if (!existingMessage) {
            return res.status(404).json({
                error: 'Message not found'
            });
        }

        // Update status
        await messageService.updateMessageStatus(
            messageId,
            status,
            external_id,
            reason || `Manual status update via API`,
            { updated_via: 'api', timestamp: new Date().toISOString() }
        );

        res.json({
            success: true,
            message_id: messageId,
            old_status: existingMessage.status,
            new_status: status,
            updated_at: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in PUT /v1/messages/:id/status:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to update message status'
        });
    }
});

/**
 * POST /v1/messages/bulk - Bulk message sending
 * Supports sending multiple messages with batch processing
 */
router.post('/messages/bulk', async (req, res) => {
    try {
        const { messages, tenant_id = 'default', phone_number_id = 'default' } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'messages array is required and must not be empty'
            });
        }

        if (messages.length > 100) {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'Maximum 100 messages per bulk request'
            });
        }

        const results = [];
        const errors = [];

        // Process each message
        for (let i = 0; i < messages.length; i++) {
            try {
                const messageData = {
                    ...messages[i],
                    tenant_id: messages[i].tenant_id || tenant_id,
                    phone_number_id: messages[i].phone_number_id || phone_number_id
                };

                // Validate and normalize
                const normalizedMessage = await messageService.validateAndNormalize(messageData);

                // Check rate limits
                const rateLimitCheck = await rateLimiter.checkRateLimit(
                    normalizedMessage.tenant_id,
                    normalizedMessage.message_type,
                    normalizedMessage.phone_number_id,
                    1
                );

                if (!rateLimitCheck.allowed) {
                    errors.push({
                        index: i,
                        to_number: messageData.to_number,
                        error: 'Rate limit exceeded',
                        retry_after: rateLimitCheck.retryAfter
                    });
                    continue;
                }

                // Persist and queue
                const persistedMessage = await messageService.persistMessage(normalizedMessage);
                const queueResult = await hybridQueue.enqueueMessage(persistedMessage);

                results.push({
                    index: i,
                    message_id: persistedMessage.id,
                    status: 'queued',
                    to_number: persistedMessage.to_number_e164,
                    queue_message_id: queueResult.queueMessageId
                });

            } catch (error) {
                errors.push({
                    index: i,
                    to_number: messages[i]?.to_number || 'unknown',
                    error: error.message
                });
            }
        }

        res.status(201).json({
            success: true,
            total_requested: messages.length,
            total_queued: results.length,
            total_errors: errors.length,
            results: results,
            errors: errors
        });

    } catch (error) {
        console.error('Error in POST /v1/messages/bulk:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to process bulk message request'
        });
    }
});

/**
 * POST /v1/messages/schedule - Schedule message for future delivery
 * Schedules messages to be sent at a specific time
 */
router.post('/messages/schedule', async (req, res) => {
    try {
        const messageData = req.body;
        const { scheduled_at } = messageData;

        if (!scheduled_at) {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'scheduled_at is required for scheduled messages'
            });
        }

        const scheduledDate = new Date(scheduled_at);
        const now = new Date();

        if (scheduledDate <= now) {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'scheduled_at must be in the future'
            });
        }

        // Process like a normal message but with scheduled_at
        const normalizedMessage = await messageService.validateAndNormalize(messageData);
        const persistedMessage = await messageService.persistMessage(normalizedMessage);
        
        const queueResult = await hybridQueue.enqueueMessage(persistedMessage, {
            scheduled_at: scheduledDate.getTime(),
            priority: messageData.priority || 5
        });

        res.status(201).json({
            success: true,
            message_id: persistedMessage.id,
            status: 'queued',
            scheduled_at: scheduledDate.toISOString(),
            to_number: persistedMessage.to_number_e164,
            queue_info: queueResult
        });

    } catch (error) {
        console.error('Error in POST /v1/messages/schedule:', error);
        
        if (error.message.includes('Validation failed')) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.message.replace('Validation failed: ', '')
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to schedule message'
        });
    }
});

/**
 * GET /v1/queue/stats - Get queue statistics and health
 */
router.get('/queue/stats', async (req, res) => {
    try {
        const queueStats = hybridQueue.getQueueStats();
        
        // Get message status counts from database
        const statusQuery = `
            SELECT status, COUNT(*) as count 
            FROM messages 
            WHERE created_at > NOW() - INTERVAL '24 hours'
            GROUP BY status
        `;
        const statusResult = await messageService.pool.query(statusQuery);
        
        const statusCounts = {};
        statusResult.rows.forEach(row => {
            statusCounts[row.status] = parseInt(row.count);
        });

        res.json({
            success: true,
            queue: queueStats,
            message_counts_24h: statusCounts,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in GET /v1/queue/stats:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to retrieve queue statistics'
        });
    }
});

/**
 * GET /v1/health - System health check with queue mode status
 * Reports overall system health and queue operational mode
 */
router.get('/health', async (req, res) => {
    try {
        const startTime = Date.now();
        
        // Check hybrid queue status
        const queueMode = hybridQueue.getMode();
        const queueStats = hybridQueue.getQueueStats();
        
        // Test database connection
        let databaseStatus = 'unknown';
        let databaseLatency = 0;
        try {
            const dbStart = Date.now();
            await messageService.pool.query('SELECT 1');
            databaseLatency = Date.now() - dbStart;
            databaseStatus = 'healthy';
        } catch (error) {
            databaseStatus = 'unhealthy';
            console.error('Database health check failed:', error);
        }

        // Test outbox table access
        let outboxStatus = 'unknown';
        try {
            await messageService.pool.query('SELECT COUNT(*) FROM outbox_messages LIMIT 1');
            outboxStatus = 'healthy';
        } catch (error) {
            outboxStatus = 'unhealthy';
            console.error('Outbox table health check failed:', error);
        }

        // Get recent message processing stats
        let recentMessages = {};
        try {
            const recentQuery = `
                SELECT status, COUNT(*) as count 
                FROM messages 
                WHERE created_at > NOW() - INTERVAL '1 hour'
                GROUP BY status
            `;
            const recentResult = await messageService.pool.query(recentQuery);
            
            recentResult.rows.forEach(row => {
                recentMessages[row.status] = parseInt(row.count);
            });
        } catch (error) {
            console.error('Error getting recent message stats:', error);
        }

        // Determine overall health status
        let overallStatus = 'healthy';
        let issues = [];
        
        if (databaseStatus !== 'healthy') {
            overallStatus = 'critical';
            issues.push('Database connection failed');
        } else if (outboxStatus !== 'healthy') {
            overallStatus = 'degraded';
            issues.push('Outbox table inaccessible');
        } else if (!queueMode.redisAvailable && queueMode.current === 'memory') {
            overallStatus = 'degraded';
            issues.push('Redis unavailable - operating in memory fallback mode');
        }

        const responseTime = Date.now() - startTime;

        const healthResponse = {
            status: overallStatus,
            timestamp: new Date().toISOString(),
            response_time_ms: responseTime,
            version: '2.0.0',
            environment: process.env.NODE_ENV || 'development',
            uptime_seconds: process.uptime(),
            issues: issues,
            components: {
                database: {
                    status: databaseStatus,
                    latency_ms: databaseLatency,
                    connection_pool: {
                        total_connections: messageService.pool.totalCount || 0,
                        idle_connections: messageService.pool.idleCount || 0
                    }
                },
                outbox_table: {
                    status: outboxStatus
                },
                queue_system: {
                    status: queueMode.isReady ? 'healthy' : 'unhealthy',
                    operational_mode: queueMode.current,
                    redis_available: queueMode.redisAvailable,
                    memory_fallback_available: queueMode.memoryAvailable,
                    initialization_attempted: queueStats.initializationAttempted || false,
                    fallback_activations: queueStats.stats?.fallbackActivations || 0,
                    redis_connection_attempts: queueStats.stats?.redisConnectionAttempts || 0,
                    last_redis_error: queueStats.stats?.lastRedisError || null
                },
                message_processing: {
                    recent_1h: recentMessages,
                    queues: {
                        redis: {
                            available: queueStats.redis?.available || false,
                            messages_processed: queueStats.stats?.messagesProcessed?.redis || 0
                        },
                        memory: {
                            available: queueStats.memory?.available || false,
                            messages_in_memory: queueStats.memory?.totalInMemory || 0,
                            messages_processed: queueStats.stats?.messagesProcessed?.memory || 0
                        }
                    }
                }
            },
            recommendations: []
        };

        // Add recommendations based on status
        if (!queueMode.redisAvailable) {
            healthResponse.recommendations.push('Consider checking Redis connection configuration or starting Redis service');
        }
        
        if (databaseLatency > 1000) {
            healthResponse.recommendations.push('Database latency is high - consider checking database performance');
        }

        if (overallStatus === 'healthy') {
            healthResponse.recommendations.push('All systems operational');
        }

        // Set appropriate HTTP status code
        let httpStatus = 200;
        if (overallStatus === 'degraded') {
            httpStatus = 200; // Still operational but with warnings
        } else if (overallStatus === 'critical') {
            httpStatus = 503; // Service unavailable
        }

        res.status(httpStatus).json(healthResponse);

    } catch (error) {
        console.error('Error in GET /v1/health:', error);
        
        res.status(500).json({
            status: 'critical',
            timestamp: new Date().toISOString(),
            error: 'Health check failed',
            details: error.message,
            components: {
                database: { status: 'unknown' },
                queue_system: { status: 'unknown' },
                message_processing: { status: 'unknown' }
            }
        });
    }
});

// ===== CONTACT MANAGEMENT API ENDPOINTS =====

/**
 * GET /v1/contacts - List contacts with filtering and pagination
 * Supports filtering by tag, updated_from, lead_score, search, etc.
 */
router.get('/contacts', async (req, res) => {
    try {
        const {
            tenant_id = 'default',
            tag,
            updated_from,
            lead_score_min,
            lead_score_max,
            search_name,
            search_phone,
            is_blocked,
            limit = 50,
            offset = 0,
            sort_by = 'last_interaction_at',
            sort_order = 'DESC'
        } = req.query;

        // Validate pagination parameters
        const parsedLimit = Math.min(parseInt(limit) || 50, 100); // Max 100 per request
        const parsedOffset = Math.max(parseInt(offset) || 0, 0);

        // Validate sort parameters
        const validSortFields = ['created_at', 'updated_at', 'last_interaction_at', 'name', 'lead_score'];
        const validSortOrders = ['ASC', 'DESC'];
        
        const safeSortBy = validSortFields.includes(sort_by) ? sort_by : 'last_interaction_at';
        const safeSortOrder = validSortOrders.includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : 'DESC';

        // Build filters object
        const filters = {
            tenant_id,
            ...(tag && { tag }),
            ...(updated_from && { updated_from }),
            ...(lead_score_min && { lead_score_min: parseInt(lead_score_min) }),
            ...(lead_score_max && { lead_score_max: parseInt(lead_score_max) }),
            ...(search_name && { search_name }),
            ...(search_phone && { search_phone }),
            ...(is_blocked !== undefined && { is_blocked: is_blocked === 'true' })
        };

        const pagination = {
            limit: parsedLimit,
            offset: parsedOffset,
            sort_by: safeSortBy,
            sort_order: safeSortOrder
        };

        const result = await contactService.listContacts(filters, pagination);

        // Calculate pagination info
        const totalPages = Math.ceil(result.total / parsedLimit);
        const currentPage = Math.floor(parsedOffset / parsedLimit) + 1;

        res.json({
            success: true,
            contacts: result.contacts,
            pagination: {
                total: result.total,
                limit: parsedLimit,
                offset: parsedOffset,
                current_page: currentPage,
                total_pages: totalPages,
                has_next: currentPage < totalPages,
                has_prev: currentPage > 1
            },
            filters: filters
        });

    } catch (error) {
        console.error('Error in GET /v1/contacts:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to retrieve contacts'
        });
    }
});

/**
 * POST /v1/contacts - Create a new contact
 * Includes E.164 phone validation and auto-deduplication
 */
router.post('/contacts', async (req, res) => {
    try {
        const {
            phone_e164,
            name,
            email,
            custom_fields = {},
            lead_score = 0,
            is_blocked = false,
            external_id,
            tags = [],
            tenant_id = 'default'
        } = req.body;

        // Validate required fields
        if (!phone_e164) {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'phone_e164 is required'
            });
        }

        const contactData = {
            phone_e164,
            name,
            email,
            custom_fields,
            lead_score,
            is_blocked,
            external_id,
            tags,
            tenant_id
        };

        const contact = await contactService.createContact(contactData);

        res.status(201).json({
            success: true,
            contact: contact,
            message: 'Contact created successfully'
        });

    } catch (error) {
        console.error('Error in POST /v1/contacts:', error);
        
        if (error.message.includes('Validation failed')) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.message.replace('Validation failed: ', '')
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to create contact'
        });
    }
});

/**
 * GET /v1/contacts/{id} - Get contact details with interaction history
 * Returns complete contact information including tags and recent interactions
 */
router.get('/contacts/:id', async (req, res) => {
    try {
        const contactId = req.params.id;
        const { tenant_id = 'default', include_interactions = 'true' } = req.query;

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(contactId)) {
            return res.status(400).json({
                error: 'Invalid contact ID format',
                details: 'Contact ID must be a valid UUID'
            });
        }

        const contact = await contactService.getContactById(contactId, tenant_id);

        if (!contact) {
            return res.status(404).json({
                error: 'Contact not found',
                details: `No contact found with ID: ${contactId}`
            });
        }

        // Include interaction history if requested
        let interactionHistory = [];
        if (include_interactions === 'true') {
            interactionHistory = await contactService.getContactInteractionHistory(contactId, 50);
        }

        res.json({
            success: true,
            contact: {
                ...contact,
                interaction_history: interactionHistory
            }
        });

    } catch (error) {
        console.error('Error in GET /v1/contacts/:id:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to retrieve contact details'
        });
    }
});

/**
 * PUT /v1/contacts/{id} - Update contact with partial data
 * Supports updating any contact field while preserving existing data
 */
router.put('/contacts/:id', async (req, res) => {
    try {
        const contactId = req.params.id;
        const { tenant_id = 'default' } = req.query;
        const updateData = req.body;

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(contactId)) {
            return res.status(400).json({
                error: 'Invalid contact ID format',
                details: 'Contact ID must be a valid UUID'
            });
        }

        // Remove fields that shouldn't be updated via this endpoint
        delete updateData.id;
        delete updateData.tenant_id;
        delete updateData.created_at;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'At least one field must be provided for update'
            });
        }

        const updatedContact = await contactService.updateContact(contactId, updateData, tenant_id);

        if (!updatedContact) {
            return res.status(404).json({
                error: 'Contact not found',
                details: `No contact found with ID: ${contactId}`
            });
        }

        res.json({
            success: true,
            contact: updatedContact,
            message: 'Contact updated successfully'
        });

    } catch (error) {
        console.error('Error in PUT /v1/contacts/:id:', error);
        
        if (error.message.includes('Validation failed') || error.message.includes('Contact not found')) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.message.replace('Validation failed: ', '')
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to update contact'
        });
    }
});

/**
 * POST /v1/contacts/sync - Batch synchronization with external systems
 * Supports creating and updating multiple contacts in a single request
 */
router.post('/contacts/sync', async (req, res) => {
    try {
        const { contacts, tenant_id = 'default' } = req.body;

        if (!Array.isArray(contacts) || contacts.length === 0) {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'contacts array is required and must not be empty'
            });
        }

        if (contacts.length > 1000) {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'Maximum 1000 contacts per sync request'
            });
        }

        const syncResult = await contactService.batchSyncContacts(contacts, tenant_id);

        res.status(200).json({
            success: true,
            sync_summary: syncResult,
            message: `Processed ${syncResult.total_processed} contacts: ${syncResult.successful} successful, ${syncResult.failed} failed`
        });

    } catch (error) {
        console.error('Error in POST /v1/contacts/sync:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to process contact synchronization'
        });
    }
});

/**
 * POST /v1/contacts/{id}/tags - Add tags to contact
 * Supports adding single or multiple tags to a contact
 */
router.post('/contacts/:id/tags', async (req, res) => {
    try {
        const contactId = req.params.id;
        const { tenant_id = 'default' } = req.query;
        const { tags, tag } = req.body;

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(contactId)) {
            return res.status(400).json({
                error: 'Invalid contact ID format'
            });
        }

        // Support both single tag and array of tags
        let tagsToAdd = [];
        if (tag && typeof tag === 'string') {
            tagsToAdd = [tag];
        } else if (tags && Array.isArray(tags)) {
            tagsToAdd = tags;
        } else {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'Either "tag" (string) or "tags" (array) must be provided'
            });
        }

        // Verify contact exists
        const contact = await contactService.getContactById(contactId, tenant_id);
        if (!contact) {
            return res.status(404).json({
                error: 'Contact not found'
            });
        }

        const addedTags = [];
        const errors = [];

        // Add each tag
        for (const tagName of tagsToAdd) {
            try {
                // Use a client for transaction
                const client = await contactService.pool.connect();
                try {
                    await client.query('BEGIN');
                    const result = await contactService.addTagToContact(client, contactId, tagName, 'api');
                    await client.query('COMMIT');
                    if (result) {
                        addedTags.push(tagName);
                    }
                } catch (error) {
                    await client.query('ROLLBACK');
                    throw error;
                } finally {
                    client.release();
                }
            } catch (error) {
                errors.push({
                    tag: tagName,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            contact_id: contactId,
            added_tags: addedTags,
            errors: errors,
            message: `Added ${addedTags.length} tags${errors.length > 0 ? ` (${errors.length} errors)` : ''}`
        });

    } catch (error) {
        console.error('Error in POST /v1/contacts/:id/tags:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to add tags to contact'
        });
    }
});

/**
 * DELETE /v1/contacts/{id}/tags/{tag} - Remove specific tag from contact
 * Removes a single tag from the specified contact
 */
router.delete('/contacts/:id/tags/:tag', async (req, res) => {
    try {
        const contactId = req.params.id;
        const tagName = req.params.tag;
        const { tenant_id = 'default' } = req.query;

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(contactId)) {
            return res.status(400).json({
                error: 'Invalid contact ID format'
            });
        }

        if (!tagName || tagName.trim() === '') {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'Tag name is required'
            });
        }

        const removed = await contactService.removeTagFromContact(contactId, tagName, tenant_id);

        if (!removed) {
            return res.status(404).json({
                error: 'Tag not found',
                details: `Tag "${tagName}" not found on contact or contact does not exist`
            });
        }

        res.json({
            success: true,
            contact_id: contactId,
            removed_tag: tagName,
            message: `Tag "${tagName}" removed successfully`
        });

    } catch (error) {
        console.error('Error in DELETE /v1/contacts/:id/tags/:tag:', error);
        
        if (error.message.includes('Contact not found')) {
            return res.status(404).json({
                error: 'Contact not found'
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to remove tag from contact'
        });
    }
});

/**
 * GET /v1/contacts/statistics - Get contact statistics for dashboard
 * Returns comprehensive statistics about contacts for analytics
 */
router.get('/contacts/statistics', async (req, res) => {
    try {
        const { tenant_id = 'default' } = req.query;

        const stats = await contactService.getContactStatistics(tenant_id);

        res.json({
            success: true,
            tenant_id: tenant_id,
            statistics: {
                total_contacts: parseInt(stats.total_contacts) || 0,
                active_last_7_days: parseInt(stats.active_last_7_days) || 0,
                active_last_30_days: parseInt(stats.active_last_30_days) || 0,
                average_lead_score: parseFloat(stats.average_lead_score) || 0,
                high_quality_leads: parseInt(stats.high_quality_leads) || 0,
                blocked_contacts: parseInt(stats.blocked_contacts) || 0
            },
            generated_at: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in GET /v1/contacts/statistics:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to retrieve contact statistics'
        });
    }
});

// ============================================================================
// PHASE 4: TEMPLATES & CAMPAIGNS ENDPOINTS
// ============================================================================

/**
 * POST /v1/message_templates - Create a new message template
 */
router.post('/message_templates', async (req, res) => {
    try {
        const {
            name,
            category,
            language = 'en',
            body,
            header,
            footer,
            buttons = [],
            variables = [],
            tenant_id = 'default'
        } = req.body;

        const templateData = {
            name,
            category,
            language,
            body,
            header,
            footer,
            buttons,
            variables,
            tenant_id
        };

        const template = await templateService.createTemplate(templateData);

        res.status(201).json({
            success: true,
            template: template
        });

    } catch (error) {
        console.error('Error in POST /v1/message_templates:', error);
        
        if (error.message.includes('Template validation failed') || error.message.includes('already exists')) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.message
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to create template'
        });
    }
});

/**
 * GET /v1/message_templates - List message templates
 */
router.get('/message_templates', async (req, res) => {
    try {
        const {
            status,
            category,
            language,
            tenant_id = 'default',
            limit = 50,
            offset = 0
        } = req.query;

        const filters = {
            status,
            category,
            language,
            limit: parseInt(limit),
            offset: parseInt(offset)
        };

        const result = await templateService.getTemplates(tenant_id, filters);

        res.json({
            success: true,
            templates: result.templates,
            pagination: {
                total: result.total,
                limit: result.limit,
                offset: result.offset,
                has_next: (result.offset + result.limit) < result.total,
                has_prev: result.offset > 0
            }
        });

    } catch (error) {
        console.error('Error in GET /v1/message_templates:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to retrieve templates'
        });
    }
});

/**
 * GET /v1/message_templates/{id} - Get template by ID
 */
router.get('/message_templates/:id', async (req, res) => {
    try {
        const templateId = req.params.id;
        const { tenant_id = 'default' } = req.query;

        const template = await templateService.getTemplateById(templateId, tenant_id);

        if (!template) {
            return res.status(404).json({
                error: 'Template not found',
                details: `No template found with ID: ${templateId}`
            });
        }

        res.json({
            success: true,
            template: template
        });

    } catch (error) {
        console.error('Error in GET /v1/message_templates/:id:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to retrieve template'
        });
    }
});

/**
 * PUT /v1/message_templates/{id} - Update template (only pending templates)
 */
router.put('/message_templates/:id', async (req, res) => {
    try {
        const templateId = req.params.id;
        const { tenant_id = 'default' } = req.body;
        const updateData = { ...req.body };
        delete updateData.tenant_id;

        const updatedTemplate = await templateService.updateTemplate(templateId, updateData, tenant_id);

        res.json({
            success: true,
            template: updatedTemplate
        });

    } catch (error) {
        console.error('Error in PUT /v1/message_templates/:id:', error);
        
        if (error.message.includes('not found') || error.message.includes('Only pending')) {
            return res.status(400).json({
                error: 'Update failed',
                details: error.message
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to update template'
        });
    }
});

/**
 * POST /v1/message_templates/{id}/submit - Submit template for approval
 */
router.post('/message_templates/:id/submit', async (req, res) => {
    try {
        const templateId = req.params.id;
        const { tenant_id = 'default' } = req.body;

        const submittedTemplate = await templateService.submitForApproval(templateId, tenant_id);

        res.json({
            success: true,
            template: submittedTemplate,
            message: 'Template submitted for approval'
        });

    } catch (error) {
        console.error('Error in POST /v1/message_templates/:id/submit:', error);
        
        if (error.message.includes('not found') || error.message.includes('Only pending')) {
            return res.status(400).json({
                error: 'Submission failed',
                details: error.message
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to submit template for approval'
        });
    }
});

/**
 * POST /v1/segments - Create a new contact segment
 */
router.post('/segments', async (req, res) => {
    try {
        const {
            name,
            description,
            query,
            tenant_id = 'default'
        } = req.body;

        const segmentData = {
            name,
            description,
            query,
            tenant_id
        };

        const segment = await segmentationService.createSegment(segmentData);

        res.status(201).json({
            success: true,
            segment: segment
        });

    } catch (error) {
        console.error('Error in POST /v1/segments:', error);
        
        if (error.message.includes('validation failed') || error.message.includes('already exists')) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.message
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to create segment'
        });
    }
});

/**
 * GET /v1/segments - List contact segments
 */
router.get('/segments', async (req, res) => {
    try {
        const {
            is_active,
            tenant_id = 'default',
            limit = 50,
            offset = 0
        } = req.query;

        const filters = {
            is_active: is_active !== undefined ? is_active === 'true' : undefined,
            limit: parseInt(limit),
            offset: parseInt(offset)
        };

        const result = await segmentationService.getSegments(tenant_id, filters);

        res.json({
            success: true,
            segments: result.segments,
            pagination: {
                total: result.total,
                limit: result.limit,
                offset: result.offset,
                has_next: (result.offset + result.limit) < result.total,
                has_prev: result.offset > 0
            }
        });

    } catch (error) {
        console.error('Error in GET /v1/segments:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to retrieve segments'
        });
    }
});

/**
 * GET /v1/segments/{id} - Get segment by ID with sample contacts
 */
router.get('/segments/:id', async (req, res) => {
    try {
        const segmentId = req.params.id;
        const { tenant_id = 'default', include_contacts = 'false' } = req.query;

        const segment = await segmentationService.getSegmentById(segmentId, tenant_id);

        if (!segment) {
            return res.status(404).json({
                error: 'Segment not found',
                details: `No segment found with ID: ${segmentId}`
            });
        }

        let sampleContacts = [];
        if (include_contacts === 'true') {
            const contactsResult = await segmentationService.getSegmentContacts(
                segment.query,
                tenant_id,
                { limit: 10 }
            );
            sampleContacts = contactsResult.contacts;
        }

        res.json({
            success: true,
            segment: segment,
            sample_contacts: sampleContacts
        });

    } catch (error) {
        console.error('Error in GET /v1/segments/:id:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to retrieve segment'
        });
    }
});

/**
 * POST /v1/segments/test - Test segment query without creating
 */
router.post('/segments/test', async (req, res) => {
    try {
        const {
            query,
            tenant_id = 'default'
        } = req.body;

        if (!query) {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'Query is required'
            });
        }

        const result = await segmentationService.testQuery(query, tenant_id);

        res.json({
            success: true,
            test_result: result
        });

    } catch (error) {
        console.error('Error in POST /v1/segments/test:', error);
        
        if (error.message.includes('validation failed')) {
            return res.status(400).json({
                error: 'Query validation failed',
                details: error.message
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to test segment query'
        });
    }
});

/**
 * POST /v1/campaigns - Create a new campaign
 */
router.post('/campaigns', async (req, res) => {
    try {
        const {
            name,
            description,
            segment_id,
            template_id,
            schedule_at,
            template_variables = {},
            priority = 5,
            max_messages_per_minute = 10,
            tenant_id = 'default'
        } = req.body;

        const campaignData = {
            name,
            description,
            segment_id,
            template_id,
            schedule_at,
            template_variables,
            priority,
            max_messages_per_minute,
            tenant_id
        };

        const campaign = await campaignService.createCampaign(campaignData);

        res.status(201).json({
            success: true,
            campaign: campaign
        });

    } catch (error) {
        console.error('Error in POST /v1/campaigns:', error);
        
        if (error.message.includes('validation failed') || error.message.includes('not found') || error.message.includes('already exists')) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.message
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to create campaign'
        });
    }
});

/**
 * GET /v1/campaigns - List campaigns
 */
router.get('/campaigns', async (req, res) => {
    try {
        const {
            status,
            tenant_id = 'default',
            limit = 50,
            offset = 0
        } = req.query;

        const filters = {
            status,
            limit: parseInt(limit),
            offset: parseInt(offset)
        };

        const result = await campaignService.getCampaigns(tenant_id, filters);

        res.json({
            success: true,
            campaigns: result.campaigns,
            pagination: {
                total: result.total,
                limit: result.limit,
                offset: result.offset,
                has_next: (result.offset + result.limit) < result.total,
                has_prev: result.offset > 0
            }
        });

    } catch (error) {
        console.error('Error in GET /v1/campaigns:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to retrieve campaigns'
        });
    }
});

/**
 * GET /v1/campaigns/{id} - Get campaign by ID with detailed stats
 */
router.get('/campaigns/:id', async (req, res) => {
    try {
        const campaignId = req.params.id;
        const { tenant_id = 'default' } = req.query;

        const campaign = await campaignService.getCampaignById(campaignId, tenant_id);

        if (!campaign) {
            return res.status(404).json({
                error: 'Campaign not found',
                details: `No campaign found with ID: ${campaignId}`
            });
        }

        res.json({
            success: true,
            campaign: campaign
        });

    } catch (error) {
        console.error('Error in GET /v1/campaigns/:id:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to retrieve campaign'
        });
    }
});

/**
 * POST /v1/campaigns/{id}/start - Start a campaign
 */
router.post('/campaigns/:id/start', async (req, res) => {
    try {
        const campaignId = req.params.id;
        const { tenant_id = 'default' } = req.body;

        const campaign = await campaignService.startCampaign(campaignId, tenant_id);

        res.json({
            success: true,
            campaign: campaign,
            message: 'Campaign started successfully'
        });

    } catch (error) {
        console.error('Error in POST /v1/campaigns/:id/start:', error);
        
        if (error.message.includes('not found') || error.message.includes('Cannot start')) {
            return res.status(400).json({
                error: 'Start failed',
                details: error.message
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to start campaign'
        });
    }
});

/**
 * POST /v1/campaigns/{id}/pause - Pause a running campaign
 */
router.post('/campaigns/:id/pause', async (req, res) => {
    try {
        const campaignId = req.params.id;
        const { tenant_id = 'default' } = req.body;

        const campaign = await campaignService.pauseCampaign(campaignId, tenant_id);

        res.json({
            success: true,
            campaign: campaign,
            message: 'Campaign paused successfully'
        });

    } catch (error) {
        console.error('Error in POST /v1/campaigns/:id/pause:', error);
        
        if (error.message.includes('not found') || error.message.includes('Cannot pause')) {
            return res.status(400).json({
                error: 'Pause failed',
                details: error.message
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to pause campaign'
        });
    }
});

/**
 * POST /v1/campaigns/{id}/resume - Resume a paused campaign
 */
router.post('/campaigns/:id/resume', async (req, res) => {
    try {
        const campaignId = req.params.id;
        const { tenant_id = 'default' } = req.body;

        const campaign = await campaignService.resumeCampaign(campaignId, tenant_id);

        res.json({
            success: true,
            campaign: campaign,
            message: 'Campaign resumed successfully'
        });

    } catch (error) {
        console.error('Error in POST /v1/campaigns/:id/resume:', error);
        
        if (error.message.includes('not found') || error.message.includes('Cannot resume')) {
            return res.status(400).json({
                error: 'Resume failed',
                details: error.message
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            details: 'Failed to resume campaign'
        });
    }
});

module.exports = { 
    router, 
    hybridQueue, 
    messageService, 
    contactService, 
    rateLimiter,
    templateService,
    segmentationService, 
    campaignService
};