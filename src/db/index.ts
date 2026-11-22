import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';

function getSplitDbConfig(): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
} | null {
  const host = process.env.PGHOST?.trim();
  const user = process.env.PGUSER?.trim();
  const password = process.env.PGPASSWORD;
  const database = process.env.PGDATABASE?.trim() || 'postgres';
  const port = Number(process.env.PGPORT?.trim() || '5432');

  if (host && user && password && Number.isFinite(port)) {
    return { host, port, database, user, password };
  }
  return null;
}

let pool: Pool | null = null;
let dbInstance: NodePgDatabase<typeof schema> | null = null;
let dbConnected = false;

export async function initDatabase(): Promise<{
  connected: boolean;
  db: NodePgDatabase<typeof schema> | null;
  pool: Pool | null;
  error?: string;
}> {
  if (dbInstance && dbConnected) {
    return { connected: true, db: dbInstance, pool };
  }

  const dbConfig = getSplitDbConfig();
  if (!dbConfig) {
    return {
      connected: false,
      db: null,
      pool: null,
      error: 'PGHOST, PGUSER, PGPASSWORD, PGDATABASE, or PGPORT not configured in environment.',
    };
  }

  try {
    pool = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      ssl: process.env.PGSSLMODE?.trim().toLowerCase() === 'disable' ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });

    await pool.query('SELECT 1');
    dbInstance = drizzle(pool, { schema });
    dbConnected = true;

    await ensureTables(pool);
    return { connected: true, db: dbInstance, pool };
  } catch (err) {
    dbConnected = false;
    const message = err instanceof Error ? err.message : 'Unknown database connection error';
    console.warn('[DocuZilla DB] Falling back to transient in-memory store:', message);
    if (pool) {
      await pool.end().catch(() => {});
      pool = null;
    }
    dbInstance = null;
    return { connected: false, db: null, pool: null, error: message };
  }
}

async function ensureTables(pgPool: Pool): Promise<void> {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'analyst',
      department TEXT NOT NULL DEFAULT 'Financial Audit',
      title TEXT NOT NULL DEFAULT 'Financial Analyst',
      manager_id INTEGER,
      can_approve BOOLEAN NOT NULL DEFAULT FALSE,
      avatar_initials TEXT NOT NULL DEFAULT 'DZ',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      department TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      storage_used_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      rustfs_bucket TEXT NOT NULL,
      rustfs_key TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Financial Statement',
      uploaded_by_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_approver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approval_status TEXT NOT NULL DEFAULT 'pending',
      approval_note TEXT,
      approved_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_at TIMESTAMP,
      discrepancy_rate TEXT DEFAULT '0.00%',
      ai_summary TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS approval_events (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      comment TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
      role TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'Document AI',
      content TEXT NOT NULL,
      attachment_name TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS analytics_snapshots (
      id SERIAL PRIMARY KEY,
      metric_key TEXT NOT NULL UNIQUE,
      headline_value TEXT NOT NULL,
      delta_direction TEXT NOT NULL,
      series_json TEXT NOT NULL,
      sub_metrics_json TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
}

export function getDb(): NodePgDatabase<typeof schema> | null {
  return dbConnected ? dbInstance : null;
}

export function isDbConnected(): boolean {
  return dbConnected;
}
