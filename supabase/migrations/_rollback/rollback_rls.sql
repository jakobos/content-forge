-- Rollback script: disable RLS and drop all policies added by
-- 20260714000000_enable_rls_all_tables.sql
--
-- This is NOT a Supabase migration. Run manually via psql or the Supabase
-- SQL editor if the RLS policies need to be reverted.
--
-- Usage (local):
--   psql "$(supabase status | grep 'DB URL' | awk '{print $3}')" -f supabase/migrations/_rollback/rollback_rls.sql
--
-- Order: drop policies first, then disable RLS.

-------------------------------------------------------------------------------
-- business_profiles
-------------------------------------------------------------------------------

DROP POLICY IF EXISTS business_profiles_select_own ON business_profiles;
DROP POLICY IF EXISTS business_profiles_insert_own ON business_profiles;
DROP POLICY IF EXISTS business_profiles_update_own ON business_profiles;
DROP POLICY IF EXISTS business_profiles_delete_own ON business_profiles;
ALTER TABLE business_profiles DISABLE ROW LEVEL SECURITY;

-------------------------------------------------------------------------------
-- campaigns
-------------------------------------------------------------------------------

DROP POLICY IF EXISTS campaigns_select_own ON campaigns;
DROP POLICY IF EXISTS campaigns_insert_own ON campaigns;
DROP POLICY IF EXISTS campaigns_update_own ON campaigns;
DROP POLICY IF EXISTS campaigns_delete_own ON campaigns;
ALTER TABLE campaigns DISABLE ROW LEVEL SECURITY;

-------------------------------------------------------------------------------
-- documents
-------------------------------------------------------------------------------

DROP POLICY IF EXISTS documents_select_own ON documents;
DROP POLICY IF EXISTS documents_insert_own ON documents;
DROP POLICY IF EXISTS documents_update_own ON documents;
DROP POLICY IF EXISTS documents_delete_own ON documents;
ALTER TABLE documents DISABLE ROW LEVEL SECURITY;

-------------------------------------------------------------------------------
-- ideas
-------------------------------------------------------------------------------

DROP POLICY IF EXISTS ideas_select_own ON ideas;
DROP POLICY IF EXISTS ideas_insert_own ON ideas;
DROP POLICY IF EXISTS ideas_update_own ON ideas;
DROP POLICY IF EXISTS ideas_delete_own ON ideas;
ALTER TABLE ideas DISABLE ROW LEVEL SECURITY;

-------------------------------------------------------------------------------
-- background_operations
-------------------------------------------------------------------------------

DROP POLICY IF EXISTS background_operations_select_own ON background_operations;
DROP POLICY IF EXISTS background_operations_insert_own ON background_operations;
DROP POLICY IF EXISTS background_operations_update_own ON background_operations;
DROP POLICY IF EXISTS background_operations_delete_own ON background_operations;
ALTER TABLE background_operations DISABLE ROW LEVEL SECURITY;

-------------------------------------------------------------------------------
-- document_versions
-------------------------------------------------------------------------------

DROP POLICY IF EXISTS document_versions_select_own ON document_versions;
DROP POLICY IF EXISTS document_versions_insert_own ON document_versions;
DROP POLICY IF EXISTS document_versions_update_own ON document_versions;
DROP POLICY IF EXISTS document_versions_delete_own ON document_versions;
ALTER TABLE document_versions DISABLE ROW LEVEL SECURITY;

-------------------------------------------------------------------------------
-- document_embeddings
-------------------------------------------------------------------------------

DROP POLICY IF EXISTS document_embeddings_select_own ON document_embeddings;
DROP POLICY IF EXISTS document_embeddings_insert_own ON document_embeddings;
DROP POLICY IF EXISTS document_embeddings_update_own ON document_embeddings;
DROP POLICY IF EXISTS document_embeddings_delete_own ON document_embeddings;
ALTER TABLE document_embeddings DISABLE ROW LEVEL SECURITY;

-------------------------------------------------------------------------------
-- idea_fragment_references
-------------------------------------------------------------------------------

DROP POLICY IF EXISTS idea_fragment_references_select_own ON idea_fragment_references;
DROP POLICY IF EXISTS idea_fragment_references_insert_own ON idea_fragment_references;
DROP POLICY IF EXISTS idea_fragment_references_update_own ON idea_fragment_references;
DROP POLICY IF EXISTS idea_fragment_references_delete_own ON idea_fragment_references;
ALTER TABLE idea_fragment_references DISABLE ROW LEVEL SECURITY;

-------------------------------------------------------------------------------
-- publications
-------------------------------------------------------------------------------

DROP POLICY IF EXISTS publications_select_own ON publications;
DROP POLICY IF EXISTS publications_insert_own ON publications;
DROP POLICY IF EXISTS publications_update_own ON publications;
DROP POLICY IF EXISTS publications_delete_own ON publications;
ALTER TABLE publications DISABLE ROW LEVEL SECURITY;
