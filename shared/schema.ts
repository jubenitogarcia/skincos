import { 
  pgTable, 
  text, 
  timestamp, 
  integer, 
  jsonb, 
  real, 
  boolean,
  index,
  primaryKey,
  uuid,
  varchar
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

// === TENANTS TABLE ===
export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// === CONTACTS TABLE ===
export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  externalId: text('external_id'), // For external system integration
  phoneE164: varchar('phone_e164', { length: 20 }).notNull(), // E.164 format: +5511999999999
  name: text('name'),
  email: text('email'),
  customFields: jsonb('custom_fields').notNull().default({}),
  leadScore: integer('lead_score').default(0), // 0-100 scoring system
  isBlocked: boolean('is_blocked').default(false),
  profilePictureUrl: text('profile_picture_url'),
  lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
  inboundCount: integer('inbound_count').default(0),
  outboundCount: integer('outbound_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  phoneE164Index: index('idx_contacts_phone_e164').on(table.phoneE164),
  tenantIdIndex: index('idx_contacts_tenant_id').on(table.tenantId),
  lastInteractionIndex: index('idx_contacts_last_interaction').on(table.tenantId, table.lastInteractionAt),
  externalIdIndex: index('idx_contacts_external_id').on(table.externalId),
  leadScoreIndex: index('idx_contacts_lead_score').on(table.leadScore),
  uniquePhoneTenant: index('idx_contacts_unique_phone_tenant').on(table.tenantId, table.phoneE164),
}));

// === CONTACT TAGS TABLE (Many-to-Many relationship) ===
export const contactTags = pgTable('contact_tags', {
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  tagName: varchar('tag_name', { length: 100 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by').default('system') // Track who added the tag
}, (table) => ({
  pk: primaryKey({ columns: [table.contactId, table.tagName] }),
  tagNameIndex: index('idx_contact_tags_tag_name').on(table.tagName),
  contactIdIndex: index('idx_contact_tags_contact_id').on(table.contactId),
}));

// === MESSAGES TABLE (Enhanced for CRM integration) ===
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  externalId: text('external_id'), // WhatsApp message ID
  phoneNumberId: text('phone_number_id').notNull().default('default'),
  chatId: text('chat_id').notNull(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  fromNumber: text('from_number'),
  toNumber: text('to_number').notNull(),
  toNumberE164: varchar('to_number_e164', { length: 20 }).notNull(),
  direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull().default('outbound'),
  messageType: text('message_type', { 
    enum: ['text', 'image', 'video', 'audio', 'document', 'location', 'contact', 'sticker'] 
  }).notNull(),
  contentText: text('content_text'),
  mediaUrl: text('media_url'),
  mediaType: text('media_type'),
  mediaFilename: text('media_filename'),
  caption: text('caption'),
  locationLatitude: real('location_latitude'),
  locationLongitude: real('location_longitude'),
  locationDescription: text('location_description'),
  status: text('status', { 
    enum: ['queued', 'sending', 'sent', 'delivered', 'read', 'failed'] 
  }).notNull().default('queued'),
  priority: integer('priority').default(5), // 1-10 priority system
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  failureReason: text('failure_reason'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdIndex: index('idx_messages_tenant_id').on(table.tenantId),
  contactIdIndex: index('idx_messages_contact_id').on(table.contactId),
  statusIndex: index('idx_messages_status').on(table.status),
  createdAtIndex: index('idx_messages_created_at').on(table.createdAt),
  phoneNumberIdIndex: index('idx_messages_phone_number_id').on(table.phoneNumberId),
  toNumberE164Index: index('idx_messages_to_number_e164').on(table.toNumberE164),
  scheduledAtIndex: index('idx_messages_scheduled_at').on(table.scheduledAt),
}));

// === DELIVERY ATTEMPTS TABLE ===
export const deliveryAttempts = pgTable('delivery_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  attemptNumber: integer('attempt_number').notNull(),
  status: text('status', { enum: ['sending', 'sent', 'failed'] }).notNull(),
  errorMessage: text('error_message'),
  errorType: text('error_type'),
  retryAfter: integer('retry_after'), // seconds
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  messageIdIndex: index('idx_delivery_attempts_message_id').on(table.messageId),
}));

// === OUTBOX MESSAGES TABLE (For hybrid queue fallback) ===
export const outboxMessages = pgTable('outbox_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').notNull(),
  status: text('status', { enum: ['pending', 'processing', 'completed', 'failed'] }).notNull().default('pending'),
  priority: integer('priority').default(5),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  failureCount: integer('failure_count').default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  statusIndex: index('idx_outbox_messages_status').on(table.status),
  scheduledAtIndex: index('idx_outbox_messages_scheduled_at').on(table.scheduledAt),
  priorityIndex: index('idx_outbox_messages_priority').on(table.priority),
}));

// === CONTACT INTERACTIONS TABLE (For detailed interaction history) ===
export const contactInteractions = pgTable('contact_interactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
  interactionType: text('interaction_type', { 
    enum: ['message_sent', 'message_received', 'message_read', 'profile_updated', 'tag_added', 'tag_removed'] 
  }).notNull(),
  details: jsonb('details').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  contactIdIndex: index('idx_contact_interactions_contact_id').on(table.contactId),
  typeIndex: index('idx_contact_interactions_type').on(table.interactionType),
  createdAtIndex: index('idx_contact_interactions_created_at').on(table.createdAt),
}));

// === MESSAGE TEMPLATES TABLE ===
export const messageTemplates = pgTable('message_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  category: text('category', { enum: ['marketing', 'utility', 'authentication'] }).notNull(),
  language: varchar('language', { length: 10 }).notNull().default('en'),
  body: text('body').notNull(), // Main message content with {{1}}, {{2}} placeholders
  header: text('header'), // Optional header text
  footer: text('footer'), // Optional footer text
  buttons: jsonb('buttons').notNull().default([]), // Array of button objects
  variables: jsonb('variables').notNull().default([]), // Array of variable definitions
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
  version: integer('version').notNull().default(1),
  rejectionReason: text('rejection_reason'), // Why template was rejected
  externalId: text('external_id'), // WhatsApp template ID when approved
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdIndex: index('idx_message_templates_tenant_id').on(table.tenantId),
  categoryIndex: index('idx_message_templates_category').on(table.category),
  statusIndex: index('idx_message_templates_status').on(table.status),
  nameIndex: index('idx_message_templates_name').on(table.name),
  uniqueNameTenant: index('idx_message_templates_unique_name_tenant').on(table.tenantId, table.name),
}));

// === SEGMENTS TABLE ===
export const segments = pgTable('segments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  query: jsonb('query').notNull(), // Query DSL object
  sizeCache: integer('size_cache').default(0), // Cached count of contacts matching
  lastComputedAt: timestamp('last_computed_at', { withTimezone: true }),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdIndex: index('idx_segments_tenant_id').on(table.tenantId),
  nameIndex: index('idx_segments_name').on(table.name),
  activeIndex: index('idx_segments_active').on(table.isActive),
  uniqueNameTenant: index('idx_segments_unique_name_tenant').on(table.tenantId, table.name),
}));

// === CAMPAIGNS TABLE ===
export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId: uuid('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  templateId: uuid('template_id').notNull().references(() => messageTemplates.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  status: text('status', { 
    enum: ['draft', 'scheduled', 'running', 'paused', 'completed', 'failed', 'cancelled'] 
  }).notNull().default('draft'),
  scheduleAt: timestamp('schedule_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  pausedAt: timestamp('paused_at', { withTimezone: true }),
  templateVariables: jsonb('template_variables').notNull().default({}), // Variable values for template
  stats: jsonb('stats').notNull().default({}), // Campaign performance metrics
  priority: integer('priority').default(5), // 1-10 priority system
  maxMessagesPerMinute: integer('max_messages_per_minute').default(10), // Rate limiting
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  tenantIdIndex: index('idx_campaigns_tenant_id').on(table.tenantId),
  segmentIdIndex: index('idx_campaigns_segment_id').on(table.segmentId),
  templateIdIndex: index('idx_campaigns_template_id').on(table.templateId),
  statusIndex: index('idx_campaigns_status').on(table.status),
  scheduleAtIndex: index('idx_campaigns_schedule_at').on(table.scheduleAt),
  startedAtIndex: index('idx_campaigns_started_at').on(table.startedAt),
}));

// === ZOD SCHEMAS FOR VALIDATION ===

// Contact schemas
export const insertContactSchema = createInsertSchema(contacts, {
  phoneE164: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid E.164 phone number format'),
  email: z.string().email().optional().or(z.literal('')),
  leadScore: z.number().min(0).max(100).optional(),
  customFields: z.record(z.string(), z.any()).optional(),
});

export const selectContactSchema = createSelectSchema(contacts);

export const updateContactSchema = insertContactSchema.partial().omit({ 
  id: true, 
  tenantId: true, 
  createdAt: true 
});

// Contact tag schemas
export const insertContactTagSchema = createInsertSchema(contactTags, {
  tagName: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, 'Tag name can only contain letters, numbers, underscore and dash'),
});

export const selectContactTagSchema = createSelectSchema(contactTags);

// Message schemas
export const insertMessageSchema = createInsertSchema(messages, {
  toNumberE164: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid E.164 phone number format'),
  priority: z.number().min(1).max(10).optional(),
  locationLatitude: z.number().min(-90).max(90).optional(),
  locationLongitude: z.number().min(-180).max(180).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const selectMessageSchema = createSelectSchema(messages);

// Message template schemas
export const insertMessageTemplateSchema = createInsertSchema(messageTemplates, {
  name: z.string().min(1).max(100),
  category: z.enum(['marketing', 'utility', 'authentication']),
  language: z.string().length(2).optional(), // ISO language code
  body: z.string().min(1).max(1024), // WhatsApp limit
  header: z.string().max(60).optional(), // WhatsApp limit
  footer: z.string().max(60).optional(), // WhatsApp limit
  buttons: z.array(z.object({
    type: z.enum(['quick_reply', 'url', 'phone_number']),
    text: z.string().min(1).max(25),
    url: z.string().url().optional(),
    phone_number: z.string().optional()
  })).optional(),
  variables: z.array(z.object({
    name: z.string(),
    description: z.string(),
    example: z.string()
  })).optional(),
});

export const selectMessageTemplateSchema = createSelectSchema(messageTemplates);

// Segment schemas  
export const insertSegmentSchema = createInsertSchema(segments, {
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  query: z.object({
    filters: z.array(z.object({
      field: z.enum(['tags', 'lastInteractionAt', 'leadScore', 'name', 'email', 'customFields']),
      op: z.enum(['contains', '>=', '<=', '=', '!=', 'in']),
      value: z.union([z.string(), z.number(), z.array(z.string())])
    })),
    logic: z.enum(['AND', 'OR']).default('AND')
  })
});

export const selectSegmentSchema = createSelectSchema(segments);

// Campaign schemas
export const insertCampaignSchema = createInsertSchema(campaigns, {
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  scheduleAt: z.string().datetime().optional(),
  templateVariables: z.record(z.string(), z.string()).optional(),
  priority: z.number().min(1).max(10).optional(),
  maxMessagesPerMinute: z.number().min(1).max(100).optional(),
});

export const selectCampaignSchema = createSelectSchema(campaigns);

// === TYPE EXPORTS ===
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type ContactTag = typeof contactTags.$inferSelect;
export type NewContactTag = typeof contactTags.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type ContactInteraction = typeof contactInteractions.$inferSelect;
export type NewContactInteraction = typeof contactInteractions.$inferInsert;
export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;
export type Segment = typeof segments.$inferSelect;
export type NewSegment = typeof segments.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

// === RELATIONSHIPS ===
// These will be used for joins and queries
export const contactsRelations = {
  tags: contactTags,
  messages: messages,
  interactions: contactInteractions,
};

export const messagesRelations = {
  contact: contacts,
  deliveryAttempts: deliveryAttempts,
};

export const templatesRelations = {
  campaigns: campaigns,
};

export const segmentsRelations = {
  campaigns: campaigns,
};

export const campaignsRelations = {
  segment: segments,
  template: messageTemplates,
};