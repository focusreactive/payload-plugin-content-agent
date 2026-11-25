export const PG_SCHEMA = "content_agent";

/** The size the embedding columns get before an embedding model is known. */
export const EMBEDDING_VECTOR_DIM = 1536;

export const MIGRATION_LOCK_KEY = 212534855;

// Append only: a released migration is never edited,
// renamed or removed (tests/migrationLock.test.ts).
// The first migration creates the whole schema; a later change is a new migration at the end.
// Unqualified names are safe only because runMigrations sets a transaction-local search_path.
export const MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: "001-init",
    sql: `
-- pgvector, when the database can have it. A host (e.g. Supabase) that ships it in another
-- schema keeps it there: runMigrations puts that schema on the transaction-local search_path.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension not available - vector features will be disabled';
END $$;

CREATE TABLE IF NOT EXISTS ca_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ca_conversations_user ON ca_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ca_conversations_updated ON ca_conversations(user_id, updated_at DESC);

-- parts: the visual tool parts of an assistant turn, so a reopened conversation shows them.
CREATE TABLE IF NOT EXISTS ca_temporal_messages (
  id TEXT PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES ca_conversations ON DELETE CASCADE,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  token_estimate INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  parts JSONB
);
CREATE INDEX IF NOT EXISTS idx_ca_temporal_msgs_conv ON ca_temporal_messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_ca_temporal_msgs_fts ON ca_temporal_messages USING gin(tsv);
CREATE INDEX IF NOT EXISTS idx_ca_temporal_msgs_type ON ca_temporal_messages(conversation_id, type, created_at);

CREATE TABLE IF NOT EXISTS ca_temporal_summaries (
  id TEXT PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES ca_conversations ON DELETE CASCADE,
  order_num INT NOT NULL,
  start_id TEXT NOT NULL,
  end_id TEXT NOT NULL,
  narrative TEXT NOT NULL,
  key_observations TEXT NOT NULL,
  tags TEXT DEFAULT '[]',
  token_estimate INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', narrative)) STORED
);
CREATE INDEX IF NOT EXISTS idx_ca_temporal_sum_conv ON ca_temporal_summaries(conversation_id, order_num, id);
CREATE INDEX IF NOT EXISTS idx_ca_temporal_sum_fts ON ca_temporal_summaries USING gin(tsv);

CREATE TABLE IF NOT EXISTS ca_present_state (
  conversation_id UUID PRIMARY KEY REFERENCES ca_conversations ON DELETE CASCADE,
  mission TEXT,
  status TEXT,
  tasks JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS ca_ltm_entries (
  slug TEXT NOT NULL,
  user_id TEXT NOT NULL,
  parent_slug TEXT,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  links JSONB DEFAULT '[]',
  version INT DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || body)) STORED,
  PRIMARY KEY (user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_ca_ltm_path ON ca_ltm_entries(user_id, path);
CREATE INDEX IF NOT EXISTS idx_ca_ltm_parent ON ca_ltm_entries(user_id, parent_slug);
CREATE INDEX IF NOT EXISTS idx_ca_ltm_fts ON ca_ltm_entries USING gin(tsv);
CREATE INDEX IF NOT EXISTS idx_ca_ltm_active ON ca_ltm_entries(user_id, path)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS ca_background_reports (
  id TEXT PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES ca_conversations ON DELETE CASCADE,
  subsystem TEXT NOT NULL,
  report JSONB NOT NULL,
  surfaced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ca_bg_reports_unsurfaced ON ca_background_reports(conversation_id)
  WHERE surfaced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ca_bg_reports_conv ON ca_background_reports(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ca_workers (
  id TEXT PRIMARY KEY,
  conversation_id UUID REFERENCES ca_conversations,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_ca_workers_conv ON ca_workers(conversation_id, status);
-- One running worker per type and conversation. INSERT..WHERE NOT EXISTS alone is not atomic
-- across instances under READ COMMITTED; with these partial unique indexes one insert wins.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ca_workers_running_conv
  ON ca_workers(type, conversation_id) WHERE status = 'running' AND conversation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ca_workers_running_global
  ON ca_workers(type) WHERE status = 'running' AND conversation_id IS NULL;

CREATE TABLE IF NOT EXISTS ca_agent_telemetry (
  id TEXT PRIMARY KEY,
  conversation_id UUID REFERENCES ca_conversations ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  step_number INT,
  event_type TEXT NOT NULL,
  tool_name TEXT,
  duration_ms INT,
  input_tokens INT,
  output_tokens INT,
  success BOOLEAN DEFAULT true,
  error TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  cache_read_tokens INT,
  cache_write_tokens INT
);
CREATE INDEX IF NOT EXISTS idx_ca_telemetry_conv ON ca_agent_telemetry(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ca_telemetry_agent ON ca_agent_telemetry(agent_id, event_type, created_at);

-- The documents the agent changed in a conversation: the source of the review panel.
-- before_snapshot and after_snapshot are frozen at edit time, so the diff shows exactly the
-- agent's change. One row per locale ('' = no or default locale), so an edit and a translation
-- of one document keep separate snapshots. restore_snapshot is the state a discard brings back
-- when before_snapshot is not that state; report is what the editor reported with the change.
CREATE TABLE IF NOT EXISTS ca_changesets (
  conversation_id UUID NOT NULL REFERENCES ca_conversations ON DELETE CASCADE,
  collection TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  op TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  before_snapshot JSONB,
  after_snapshot JSONB,
  locale TEXT NOT NULL DEFAULT '',
  report JSONB,
  restore_snapshot JSONB,
  PRIMARY KEY (conversation_id, collection, doc_id, locale)
);
CREATE INDEX IF NOT EXISTS idx_ca_changesets_conv ON ca_changesets(conversation_id, updated_at);

-- One rating per conversation: the primary key and an INSERT .. ON CONFLICT DO NOTHING in the
-- code (never an UPDATE) make a rating final once it is sent.
CREATE TABLE IF NOT EXISTS ca_chat_ratings (
  conversation_id UUID PRIMARY KEY REFERENCES ca_conversations ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Resume state of a many-document run that stopped for time. In the database, not in process
-- memory: the "continue" turn often runs on another serverless instance.
CREATE TABLE IF NOT EXISTS ca_pending_bulk (
  conversation_id UUID NOT NULL REFERENCES ca_conversations ON DELETE CASCADE,
  tool TEXT NOT NULL,
  collection TEXT NOT NULL,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (conversation_id, tool, collection)
);
`,
  },
];
