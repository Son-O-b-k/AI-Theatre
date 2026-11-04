// Append-only: each entry upgrades the schema by one version. Never edit a shipped migration.
// Written once for both databases; `sql` fills in the few places their syntax differs.
// Timestamps are ISO-8601 text in both, so they compare the same way everywhere.

import type { Dialect } from '.'

const SYNTAX = {
  sqlite: { autoId: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
  postgres: { autoId: 'BIGSERIAL PRIMARY KEY' },
}

type Migration = (dialect: Dialect) => string

const sql =
  (build: (syntax: (typeof SYNTAX)['sqlite']) => string): Migration =>
  (dialect) =>
    build(SYNTAX[dialect])

export const MIGRATIONS: Migration[] = [
  sql(
    ({ autoId }) => `
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE members (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL
    );
    CREATE TABLE subscriptions (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
      provider TEXT NOT NULL,
      provider_subscription_id TEXT NOT NULL,
      customer_id TEXT,
      plan TEXT NOT NULL,
      interval TEXT NOT NULL,
      status TEXT NOT NULL,
      current_period_end TEXT,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      previous_plan TEXT,
      previous_plan_until TEXT,
      discount_code TEXT,
      portal_url TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE (provider, provider_subscription_id)
    );
    CREATE TABLE checkouts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      plan TEXT NOT NULL,
      interval TEXT NOT NULL,
      discount_code TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE billing_events (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      type TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
    CREATE TABLE usage (
      id ${autoId},
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      kind TEXT NOT NULL,
      tokens INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX usage_by_workspace ON usage (workspace_id, created_at);`,
  ),
  // Email verification, password reset and teams.
  sql(
    () => `
    ALTER TABLE users ADD COLUMN email_verified_at TEXT;
    ALTER TABLE sessions ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
    ALTER TABLE subscriptions ADD COLUMN seats INTEGER;
    CREATE TABLE tokens (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
    CREATE TABLE invitations (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      invited_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      revoked_at TEXT
    );
    CREATE INDEX invitations_by_workspace ON invitations (workspace_id);`,
  ),
  // Lesson generation on the server: jobs, and the chapters they finish until the app collects them.
  sql(
    () => `
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      project_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE TABLE job_outputs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id),
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      project_id TEXT NOT NULL,
      output TEXT NOT NULL,
      created_at TEXT NOT NULL,
      claimed_at TEXT
    );
    CREATE INDEX job_outputs_unclaimed ON job_outputs (workspace_id, project_id, claimed_at);`,
  ),
]
