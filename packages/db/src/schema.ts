import { sql } from 'drizzle-orm';
import { boolean, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const khal = pgSchema('khal');

export const plans = khal.table('plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  monthlyValueCents: integer('monthly_value_cents').notNull(),
  dataAllowanceGb: integer('data_allowance_gb').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const customers = khal.table('customers', {
  id: uuid('id').defaultRandom().primaryKey(),
  phone: text('phone').notNull().unique(),
  name: text('name').notNull(),
  plan: text('plan').notNull(),
  planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
  monthlyValue: integer('monthly_value_cents').notNull(),
  dataAllowanceGb: integer('data_allowance_gb').notNull(),
  dataUsedGb: integer('data_used_gb').notNull().default(0),
  address: text('address').notNull(),
  cep: text('cep'),
  numero: text('numero'),
  complemento: text('complemento'),
  status: text('status', { enum: ['active', 'suspended', 'cancelled', 'prospect'] }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const bills = khal.table('bills', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  referenceMonth: text('reference_month').notNull(),
  amountCents: integer('amount_cents').notNull(),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
  status: text('status', { enum: ['open', 'paid', 'overdue'] }).notNull().default('open'),
  pdfUrl: text('pdf_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tickets = khal.table('tickets', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  externalId: text('external_id'),
  title: text('title').notNull(),
  category: text('category').notNull(),
  priority: text('priority', { enum: ['low', 'medium', 'high', 'urgent'] }).notNull(),
  description: text('description').notNull(),
  status: text('status', { enum: ['open', 'in_progress', 'resolved', 'closed'] }).notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const conversations = khal.table('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  lastSentiment: text('last_sentiment', { enum: ['neutro', 'frustrado', 'satisfeito', 'urgente'] })
    .notNull()
    .default('neutro'),
  humanTakeoverAt: timestamp('human_takeover_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
});

export const messages = khal.table('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['customer', 'nova', 'tool', 'system'] }).notNull(),
  content: text('content').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const auditLog = khal.table('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  result: text('result', { enum: ['ok', 'error', 'cancelled'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const remindersSent = khal.table('reminders_sent', {
  id: uuid('id').defaultRandom().primaryKey(),
  billId: uuid('bill_id')
    .notNull()
    .references(() => bills.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ensureSchema = sql`CREATE SCHEMA IF NOT EXISTS khal`;
