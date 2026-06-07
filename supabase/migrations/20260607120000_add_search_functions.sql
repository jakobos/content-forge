-- ============================================================
-- F-02: Hybrid RAG Search — FTS column, indexes, RPC functions
-- ============================================================

-- 1. Add generated tsvector column for full-text search
ALTER TABLE document_embeddings
  ADD COLUMN fts tsvector GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED;

-- 2. GIN index for full-text search
CREATE INDEX document_embeddings_fts_idx
  ON document_embeddings USING gin (fts);

-- 3. HNSW index for vector cosine similarity search
CREATE INDEX document_embeddings_embedding_idx
  ON document_embeddings USING hnsw (embedding vector_cosine_ops);

-- ============================================================
-- RPC: Vector similarity search
-- ============================================================
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(1536),
  match_threshold float,
  match_count      int,
  filter_campaign_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id                  uuid,
  document_version_id uuid,
  chunk_index         integer,
  chunk_text          text,
  similarity          float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    de.id,
    de.document_version_id,
    de.chunk_index,
    de.chunk_text,
    1 - (de.embedding <=> query_embedding) AS similarity
  FROM document_embeddings de
  JOIN document_versions dv ON dv.id = de.document_version_id
  JOIN documents        d  ON d.id  = dv.document_id
  WHERE
    (1 - (de.embedding <=> query_embedding)) >= match_threshold
    AND (filter_campaign_id IS NULL OR d.campaign_id = filter_campaign_id)
  ORDER BY de.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ============================================================
-- RPC: Full-text search
-- ============================================================
CREATE OR REPLACE FUNCTION search_document_chunks(
  search_query       text,
  result_limit       int  DEFAULT 20,
  filter_campaign_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id                  uuid,
  document_version_id uuid,
  chunk_index         integer,
  chunk_text          text,
  rank                float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    de.id,
    de.document_version_id,
    de.chunk_index,
    de.chunk_text,
    ts_rank(de.fts, websearch_to_tsquery('english', search_query)) AS rank
  FROM document_embeddings de
  JOIN document_versions dv ON dv.id = de.document_version_id
  JOIN documents        d  ON d.id  = dv.document_id
  WHERE
    de.fts @@ websearch_to_tsquery('english', search_query)
    AND (filter_campaign_id IS NULL OR d.campaign_id = filter_campaign_id)
  ORDER BY rank DESC
  LIMIT result_limit;
$$;
