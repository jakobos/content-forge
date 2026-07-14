export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      background_operations: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          estimated_cost_cents: number | null
          id: string
          input_ref: Json | null
          input_tokens: number | null
          model_name: string | null
          output_ref: Json | null
          output_tokens: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["operation_status"]
          type: Database["public"]["Enums"]["operation_type"]
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          estimated_cost_cents?: number | null
          id?: string
          input_ref?: Json | null
          input_tokens?: number | null
          model_name?: string | null
          output_ref?: Json | null
          output_tokens?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["operation_status"]
          type: Database["public"]["Enums"]["operation_type"]
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          estimated_cost_cents?: number | null
          id?: string
          input_ref?: Json | null
          input_tokens?: number | null
          model_name?: string | null
          output_ref?: Json | null
          output_tokens?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["operation_status"]
          type?: Database["public"]["Enums"]["operation_type"]
          user_id?: string
        }
        Relationships: []
      }
      business_profiles: {
        Row: {
          archetype: string | null
          audience: string | null
          brand_goal: string | null
          created_at: string
          delivered_value: string | null
          id: string
          keywords: string[] | null
          pain_points: string | null
          preferred_formats: string[] | null
          resources: string | null
          tone_of_voice: string | null
          transformation: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archetype?: string | null
          audience?: string | null
          brand_goal?: string | null
          created_at?: string
          delivered_value?: string | null
          id?: string
          keywords?: string[] | null
          pain_points?: string | null
          preferred_formats?: string[] | null
          resources?: string | null
          tone_of_voice?: string | null
          transformation?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archetype?: string | null
          audience?: string | null
          brand_goal?: string | null
          created_at?: string
          delivered_value?: string | null
          id?: string
          keywords?: string[] | null
          pain_points?: string | null
          preferred_formats?: string[] | null
          resources?: string | null
          tone_of_voice?: string | null
          transformation?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          created_at: string
          description: string | null
          goal: string | null
          id: string
          status: Database["public"]["Enums"]["campaign_status"]
          theme: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          goal?: string | null
          id?: string
          status?: Database["public"]["Enums"]["campaign_status"]
          theme?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          goal?: string | null
          id?: string
          status?: Database["public"]["Enums"]["campaign_status"]
          theme?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      document_embeddings: {
        Row: {
          chunk_index: number
          chunk_text: string
          created_at: string
          document_version_id: string
          embedding: string
          fts: unknown
          id: string
          metadata: Json | null
        }
        Insert: {
          chunk_index: number
          chunk_text: string
          created_at?: string
          document_version_id: string
          embedding: string
          fts?: unknown
          id?: string
          metadata?: Json | null
        }
        Update: {
          chunk_index?: number
          chunk_text?: string
          created_at?: string
          document_version_id?: string
          embedding?: string
          fts?: unknown
          id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "document_embeddings_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_versions: {
        Row: {
          content: string
          created_at: string
          document_id: string
          id: string
          version_number: number
        }
        Insert: {
          content: string
          created_at?: string
          document_id: string
          id?: string
          version_number: number
        }
        Update: {
          content?: string
          created_at?: string
          document_id?: string
          id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          campaign_id: string
          content: string
          created_at: string
          current_version: number
          id: string
          source_url: string | null
          status: Database["public"]["Enums"]["document_status"]
          title: string
          type: Database["public"]["Enums"]["document_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          content: string
          created_at?: string
          current_version?: number
          id?: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          title: string
          type: Database["public"]["Enums"]["document_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          content?: string
          created_at?: string
          current_version?: number
          id?: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          title?: string
          type?: Database["public"]["Enums"]["document_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      idea_fragment_references: {
        Row: {
          chunk_index: number | null
          created_at: string
          document_version_id: string | null
          id: string
          idea_id: string
          quote_snippet: string | null
        }
        Insert: {
          chunk_index?: number | null
          created_at?: string
          document_version_id?: string | null
          id?: string
          idea_id: string
          quote_snippet?: string | null
        }
        Update: {
          chunk_index?: number | null
          created_at?: string
          document_version_id?: string | null
          id?: string
          idea_id?: string
          quote_snippet?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "idea_fragment_references_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idea_fragment_references_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      ideas: {
        Row: {
          call_to_action: string | null
          campaign_id: string
          content_format_suggestion: string | null
          created_at: string
          generation_number: number
          hook: string | null
          id: string
          improvement_hint: string | null
          insights_conclusions: string | null
          key_points: string[] | null
          key_quotes: string[]
          original_description: string | null
          proposed_flow: string | null
          source: Database["public"]["Enums"]["idea_source"]
          status: Database["public"]["Enums"]["idea_status"]
          storytelling_angle: string | null
          target_audience_note: string | null
          updated_at: string
          user_id: string
          working_title: string
        }
        Insert: {
          call_to_action?: string | null
          campaign_id: string
          content_format_suggestion?: string | null
          created_at?: string
          generation_number?: number
          hook?: string | null
          id?: string
          improvement_hint?: string | null
          insights_conclusions?: string | null
          key_points?: string[] | null
          key_quotes?: string[]
          original_description?: string | null
          proposed_flow?: string | null
          source?: Database["public"]["Enums"]["idea_source"]
          status?: Database["public"]["Enums"]["idea_status"]
          storytelling_angle?: string | null
          target_audience_note?: string | null
          updated_at?: string
          user_id: string
          working_title: string
        }
        Update: {
          call_to_action?: string | null
          campaign_id?: string
          content_format_suggestion?: string | null
          created_at?: string
          generation_number?: number
          hook?: string | null
          id?: string
          improvement_hint?: string | null
          insights_conclusions?: string | null
          key_points?: string[] | null
          key_quotes?: string[]
          original_description?: string | null
          proposed_flow?: string | null
          source?: Database["public"]["Enums"]["idea_source"]
          status?: Database["public"]["Enums"]["idea_status"]
          storytelling_angle?: string | null
          target_audience_note?: string | null
          updated_at?: string
          user_id?: string
          working_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ideas_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      publications: {
        Row: {
          created_at: string
          id: string
          idea_id: string
          note: string | null
          platform_name: string | null
          published_at: string | null
          url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          idea_id: string
          note?: string | null
          platform_name?: string | null
          published_at?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          idea_id?: string
          note?: string | null
          platform_name?: string | null
          published_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publications_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: true
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_document_chunks: {
        Args: {
          filter_campaign_id?: string
          match_count: number
          match_threshold: number
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          chunk_text: string
          document_version_id: string
          id: string
          similarity: number
        }[]
      }
      search_document_chunks: {
        Args: {
          filter_campaign_id?: string
          result_limit?: number
          search_query: string
        }
        Returns: {
          chunk_index: number
          chunk_text: string
          document_version_id: string
          id: string
          rank: number
        }[]
      }
    }
    Enums: {
      campaign_status: "draft" | "active" | "completed" | "archived"
      document_status: "active" | "archived" | "deleted"
      document_type: "source_document" | "user_insight"
      idea_source: "auto" | "manual"
      idea_status: "draft" | "accepted" | "published" | "archived" | "declined"
      operation_status: "pending" | "in_progress" | "completed" | "failed"
      operation_type:
        | "profile_processing"
        | "document_ingestion"
        | "idea_generation"
        | "idea_regeneration"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      campaign_status: ["draft", "active", "completed", "archived"],
      document_status: ["active", "archived", "deleted"],
      document_type: ["source_document", "user_insight"],
      idea_source: ["auto", "manual"],
      idea_status: ["draft", "accepted", "published", "archived", "declined"],
      operation_status: ["pending", "in_progress", "completed", "failed"],
      operation_type: [
        "profile_processing",
        "document_ingestion",
        "idea_generation",
        "idea_regeneration",
      ],
    },
  },
} as const

