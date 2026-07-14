-- Enable Row-Level Security on all 9 application tables
-- Apply method: supabase migration up (NOT db reset)
-- See: context/changes/data-authorization/plan.md

-------------------------------------------------------------------------------
-- 1. ENABLE RLS
-------------------------------------------------------------------------------

ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE background_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE idea_fragment_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE publications ENABLE ROW LEVEL SECURITY;

-------------------------------------------------------------------------------
-- 2. business_profiles (direct ownership)
-------------------------------------------------------------------------------

CREATE POLICY business_profiles_select_own
  ON business_profiles FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY business_profiles_insert_own
  ON business_profiles FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY business_profiles_update_own
  ON business_profiles FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY business_profiles_delete_own
  ON business_profiles FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-------------------------------------------------------------------------------
-- 3. campaigns (direct ownership)
-------------------------------------------------------------------------------

CREATE POLICY campaigns_select_own
  ON campaigns FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY campaigns_insert_own
  ON campaigns FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY campaigns_update_own
  ON campaigns FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY campaigns_delete_own
  ON campaigns FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-------------------------------------------------------------------------------
-- 4. documents (direct ownership)
-------------------------------------------------------------------------------

CREATE POLICY documents_select_own
  ON documents FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY documents_insert_own
  ON documents FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY documents_update_own
  ON documents FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY documents_delete_own
  ON documents FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-------------------------------------------------------------------------------
-- 5. ideas (direct ownership)
-------------------------------------------------------------------------------

CREATE POLICY ideas_select_own
  ON ideas FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY ideas_insert_own
  ON ideas FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY ideas_update_own
  ON ideas FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY ideas_delete_own
  ON ideas FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-------------------------------------------------------------------------------
-- 6. background_operations (direct ownership)
-------------------------------------------------------------------------------

CREATE POLICY background_operations_select_own
  ON background_operations FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY background_operations_insert_own
  ON background_operations FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY background_operations_update_own
  ON background_operations FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY background_operations_delete_own
  ON background_operations FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-------------------------------------------------------------------------------
-- 7. document_versions (derived ownership via document_versions.document_id -> documents.id)
-------------------------------------------------------------------------------

CREATE POLICY document_versions_select_own
  ON document_versions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM documents
      WHERE documents.id = document_versions.document_id
        AND documents.user_id = (select auth.uid())
    )
  );

CREATE POLICY document_versions_insert_own
  ON document_versions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM documents
      WHERE documents.id = document_versions.document_id
        AND documents.user_id = (select auth.uid())
    )
  );

CREATE POLICY document_versions_update_own
  ON document_versions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM documents
      WHERE documents.id = document_versions.document_id
        AND documents.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM documents
      WHERE documents.id = document_versions.document_id
        AND documents.user_id = (select auth.uid())
    )
  );

CREATE POLICY document_versions_delete_own
  ON document_versions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM documents
      WHERE documents.id = document_versions.document_id
        AND documents.user_id = (select auth.uid())
    )
  );

-------------------------------------------------------------------------------
-- 8. document_embeddings (derived ownership via document_version_id -> document_versions -> documents)
-------------------------------------------------------------------------------

CREATE POLICY document_embeddings_select_own
  ON document_embeddings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM document_versions
      JOIN documents ON documents.id = document_versions.document_id
      WHERE document_versions.id = document_embeddings.document_version_id
        AND documents.user_id = (select auth.uid())
    )
  );

CREATE POLICY document_embeddings_insert_own
  ON document_embeddings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM document_versions
      JOIN documents ON documents.id = document_versions.document_id
      WHERE document_versions.id = document_embeddings.document_version_id
        AND documents.user_id = (select auth.uid())
    )
  );

CREATE POLICY document_embeddings_update_own
  ON document_embeddings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM document_versions
      JOIN documents ON documents.id = document_versions.document_id
      WHERE document_versions.id = document_embeddings.document_version_id
        AND documents.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM document_versions
      JOIN documents ON documents.id = document_versions.document_id
      WHERE document_versions.id = document_embeddings.document_version_id
        AND documents.user_id = (select auth.uid())
    )
  );

CREATE POLICY document_embeddings_delete_own
  ON document_embeddings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM document_versions
      JOIN documents ON documents.id = document_versions.document_id
      WHERE document_versions.id = document_embeddings.document_version_id
        AND documents.user_id = (select auth.uid())
    )
  );

-------------------------------------------------------------------------------
-- 9. idea_fragment_references (derived ownership via idea_id -> ideas.id)
-------------------------------------------------------------------------------

CREATE POLICY idea_fragment_references_select_own
  ON idea_fragment_references FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ideas
      WHERE ideas.id = idea_fragment_references.idea_id
        AND ideas.user_id = (select auth.uid())
    )
  );

CREATE POLICY idea_fragment_references_insert_own
  ON idea_fragment_references FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ideas
      WHERE ideas.id = idea_fragment_references.idea_id
        AND ideas.user_id = (select auth.uid())
    )
  );

CREATE POLICY idea_fragment_references_update_own
  ON idea_fragment_references FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ideas
      WHERE ideas.id = idea_fragment_references.idea_id
        AND ideas.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ideas
      WHERE ideas.id = idea_fragment_references.idea_id
        AND ideas.user_id = (select auth.uid())
    )
  );

CREATE POLICY idea_fragment_references_delete_own
  ON idea_fragment_references FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ideas
      WHERE ideas.id = idea_fragment_references.idea_id
        AND ideas.user_id = (select auth.uid())
    )
  );

-------------------------------------------------------------------------------
-- 10. publications (derived ownership via idea_id -> ideas.id)
-------------------------------------------------------------------------------

CREATE POLICY publications_select_own
  ON publications FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ideas
      WHERE ideas.id = publications.idea_id
        AND ideas.user_id = (select auth.uid())
    )
  );

CREATE POLICY publications_insert_own
  ON publications FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ideas
      WHERE ideas.id = publications.idea_id
        AND ideas.user_id = (select auth.uid())
    )
  );

CREATE POLICY publications_update_own
  ON publications FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ideas
      WHERE ideas.id = publications.idea_id
        AND ideas.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ideas
      WHERE ideas.id = publications.idea_id
        AND ideas.user_id = (select auth.uid())
    )
  );

CREATE POLICY publications_delete_own
  ON publications FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ideas
      WHERE ideas.id = publications.idea_id
        AND ideas.user_id = (select auth.uid())
    )
  );
