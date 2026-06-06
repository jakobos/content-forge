-- ============================================================
-- ContentForge Application Data Schema
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- Enum types
-- ============================================================

CREATE TYPE document_type AS ENUM ('source_document', 'user_insight');

CREATE TYPE campaign_status AS ENUM ('draft', 'active', 'completed', 'archived');

CREATE TYPE document_status AS ENUM ('active', 'archived', 'deleted');

CREATE TYPE idea_status AS ENUM ('draft', 'accepted', 'published', 'archived', 'declined');

CREATE TYPE idea_source AS ENUM ('auto', 'manual');

CREATE TYPE operation_type AS ENUM (
  'profile_processing',
  'document_ingestion',
  'idea_generation',
  'idea_regeneration'
);

CREATE TYPE operation_status AS ENUM ('pending', 'in_progress', 'completed', 'failed');

-- ============================================================
-- updated_at trigger function (shared by all tables that need it)
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- Tables
-- ============================================================

-- 1. business_profiles (1:1 with auth.users)
CREATE TABLE business_profiles (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_goal           text,
  audience             text,
  tone_of_voice        text,
  archetype            text,
  keywords             text[],
  preferred_formats    text[],
  resources            text,
  pain_points          text,
  transformation       text,
  delivered_value      text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_business_profiles_updated_at
  BEFORE UPDATE ON business_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. campaigns
CREATE TABLE campaigns (
  id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid             NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text             NOT NULL,
  description text,
  goal        text,
  theme       text,
  status      campaign_status  NOT NULL DEFAULT 'draft',
  created_at  timestamptz      NOT NULL DEFAULT now(),
  updated_at  timestamptz      NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_user_status ON campaigns (user_id, status);

CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. documents
CREATE TABLE documents (
  id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid             NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id         uuid             NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type            document_type    NOT NULL,
  title           text             NOT NULL,
  content         text             NOT NULL,
  source_url      text,
  current_version integer          NOT NULL DEFAULT 1,
  status          document_status  NOT NULL DEFAULT 'active',
  created_at      timestamptz      NOT NULL DEFAULT now(),
  updated_at      timestamptz      NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_campaign_status ON documents (campaign_id, status);

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. document_versions (immutable snapshots)
CREATE TABLE document_versions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    uuid        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_number integer     NOT NULL,
  content        text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number)
);

CREATE INDEX idx_document_versions_doc_version ON document_versions (document_id, version_number);

-- 5. document_embeddings (pgvector -- for F-02)
CREATE TABLE document_embeddings (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_version_id uuid        NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  chunk_index         integer     NOT NULL,
  chunk_text          text        NOT NULL,
  embedding           vector(1536) NOT NULL,
  metadata            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_version_id, chunk_index)
);

CREATE INDEX idx_document_embeddings_metadata ON document_embeddings USING GIN (metadata);

-- 6. ideas
CREATE TABLE ideas (
  id                        uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id               uuid         NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id                   uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  generation_number         integer      NOT NULL DEFAULT 1,
  source                    idea_source  NOT NULL DEFAULT 'auto',
  original_description      text,
  improvement_hint          text,
  -- Core fixed fields
  working_title             text         NOT NULL,
  hook                      text,
  key_points                text[],
  key_quotes                text[]       NOT NULL DEFAULT '{}',
  -- Dynamic optional fields
  proposed_flow             text,
  insights_conclusions      text,
  call_to_action            text,
  storytelling_angle        text,
  target_audience_note      text,
  content_format_suggestion text,
  status                    idea_status  NOT NULL DEFAULT 'draft',
  created_at                timestamptz  NOT NULL DEFAULT now(),
  updated_at                timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_ideas_campaign_status ON ideas (campaign_id, status);
CREATE INDEX idx_ideas_campaign_generation ON ideas (campaign_id, generation_number);

CREATE TRIGGER trg_ideas_updated_at
  BEFORE UPDATE ON ideas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 7. idea_fragment_references (join between ideas and document chunks)
CREATE TABLE idea_fragment_references (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id             uuid        NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  document_version_id uuid        REFERENCES document_versions(id) ON DELETE SET NULL,
  chunk_index         integer,
  quote_snippet       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_idea_fragment_refs_idea ON idea_fragment_references (idea_id);

-- 8. publications (1:1 optional with ideas in "published" status)
CREATE TABLE publications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id       uuid        NOT NULL UNIQUE REFERENCES ideas(id) ON DELETE CASCADE,
  url           text,
  platform_name text,
  published_at  timestamptz,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 9. background_operations (async job tracking)
CREATE TABLE background_operations (
  id                    uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid             NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type                  operation_type   NOT NULL,
  status                operation_status NOT NULL DEFAULT 'pending',
  input_ref             jsonb,
  output_ref            jsonb,
  error_message         text,
  model_name            text,
  input_tokens          integer,
  output_tokens         integer,
  estimated_cost_cents  integer,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz      NOT NULL DEFAULT now()
);

CREATE INDEX idx_bg_ops_user_status ON background_operations (user_id, status);
CREATE INDEX idx_bg_ops_user_type_status ON background_operations (user_id, type, status);
