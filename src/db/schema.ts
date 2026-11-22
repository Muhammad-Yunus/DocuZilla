import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  role: text('role').notNull().default('analyst'), // 'admin' | 'manager' | 'analyst' | 'auditor'
  department: text('department').notNull().default('Financial Audit'),
  title: text('title').notNull().default('Financial Analyst'),
  managerId: integer('manager_id'), // 1-level management hierarchy: who this user submits to
  canApprove: boolean('can_approve').notNull().default(false),
  avatarInitials: text('avatar_initials').notNull().default('DZ'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  department: text('department').notNull(),
  status: text('status').notNull().default('active'), // 'active' | 'audit' | 'closed'
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'set null' }),
  storageUsedBytes: integer('storage_used_bytes').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  rustfsBucket: text('rustfs_bucket').notNull(),
  rustfsKey: text('rustfs_key').notNull().unique(),
  sha256: text('sha256').notNull(),
  category: text('category').notNull().default('Financial Statement'),
  uploadedById: integer('uploaded_by_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  assignedApproverId: integer('assigned_approver_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  approvalStatus: text('approval_status').notNull().default('pending'), // 'draft' | 'pending' | 'approved' | 'rejected'
  approvalNote: text('approval_note'),
  approvedById: integer('approved_by_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  approvedAt: timestamp('approved_at'),
  discrepancyRate: text('discrepancy_rate').default('0.00%'),
  aiSummary: text('ai_summary'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const approvalEvents = pgTable('approval_events', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id')
    .references(() => documents.id, { onDelete: 'cascade' })
    .notNull(),
  actorId: integer('actor_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  action: text('action').notNull(), // 'uploaded' | 'submitted' | 'approved' | 'rejected' | 'reassigned' | 'ai_analyzed'
  comment: text('comment'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const aiConversations = pgTable('ai_conversations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  documentId: integer('document_id').references(() => documents.id, {
    onDelete: 'set null',
  }),
  role: text('role').notNull(), // 'user' | 'assistant'
  mode: text('mode').notNull().default('Document AI'),
  content: text('content').notNull(),
  attachmentName: text('attachment_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const analyticsSnapshots = pgTable('analytics_snapshots', {
  id: serial('id').primaryKey(),
  metricKey: text('metric_key').notNull().unique(),
  headlineValue: text('headline_value').notNull(),
  deltaDirection: text('delta_direction').notNull(),
  seriesJson: text('series_json').notNull(),
  subMetricsJson: text('sub_metrics_json'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type ApprovalEventRow = typeof approvalEvents.$inferSelect;
export type AiConversationRow = typeof aiConversations.$inferSelect;
export type AnalyticsSnapshotRow = typeof analyticsSnapshots.$inferSelect;
