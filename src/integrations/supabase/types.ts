export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action_payload: Json
          action_type: string
          created_at: string
          id: string
          organization_id: string
          profile_id: string | null
          tender_id: string | null
        }
        Insert: {
          action_payload?: Json
          action_type: string
          created_at?: string
          id?: string
          organization_id: string
          profile_id?: string | null
          tender_id?: string | null
        }
        Update: {
          action_payload?: Json
          action_type?: string
          created_at?: string
          id?: string
          organization_id?: string
          profile_id?: string | null
          tender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          created_at: string
          due_at: string | null
          id: string
          organization_id: string
          owner_profile_id: string | null
          status: string
          tender_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          due_at?: string | null
          id?: string
          organization_id: string
          owner_profile_id?: string | null
          status?: string
          tender_id: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          due_at?: string | null
          id?: string
          organization_id?: string
          owner_profile_id?: string | null
          status?: string
          tender_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_owner_org_fk"
            columns: ["owner_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "checklist_items_tender_org_fk"
            columns: ["tender_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      clarification_questions: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          question_text: string
          rationale: string | null
          status: string
          tender_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          question_text: string
          rationale?: string | null
          status?: string
          tender_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          question_text?: string
          rationale?: string | null
          status?: string
          tender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clarification_questions_tender_org_fk"
            columns: ["tender_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      deadlines: {
        Row: {
          created_at: string
          deadline_type: string
          description: string | null
          due_at: string
          id: string
          organization_id: string
          tender_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deadline_type: string
          description?: string | null
          due_at: string
          id?: string
          organization_id: string
          tender_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deadline_type?: string
          description?: string | null
          due_at?: string
          id?: string
          organization_id?: string
          tender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deadlines_tender_org_fk"
            columns: ["tender_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      knowledge_assets: {
        Row: {
          asset_type: string
          created_at: string
          extracted_text: string | null
          id: string
          organization_id: string
          parse_error: string | null
          parse_status: string
          processed_at: string | null
          storage_path: string | null
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          asset_type: string
          created_at?: string
          extracted_text?: string | null
          id?: string
          organization_id: string
          parse_error?: string | null
          parse_status?: string
          processed_at?: string | null
          storage_path?: string | null
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          asset_type?: string
          created_at?: string
          extracted_text?: string | null
          id?: string
          organization_id?: string
          parse_error?: string | null
          parse_status?: string
          processed_at?: string | null
          storage_path?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          default_language: string
          id: string
          industry: string | null
          name: string
          size_label: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_language?: string
          id?: string
          industry?: string | null
          name: string
          size_label?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_language?: string
          id?: string
          industry?: string | null
          name?: string
          size_label?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          is_admin: boolean
          organization_id: string | null
          role_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          is_admin?: boolean
          organization_id?: string | null
          role_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          is_admin?: boolean
          organization_id?: string | null
          role_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      requirement_matches: {
        Row: {
          confidence_score: number
          created_at: string
          id: string
          knowledge_asset_id: string
          match_reason: string | null
          organization_id: string
          requirement_id: string
          status: string
          tender_id: string
          updated_at: string
        }
        Insert: {
          confidence_score?: number
          created_at?: string
          id?: string
          knowledge_asset_id: string
          match_reason?: string | null
          organization_id: string
          requirement_id: string
          status?: string
          tender_id: string
          updated_at?: string
        }
        Update: {
          confidence_score?: number
          created_at?: string
          id?: string
          knowledge_asset_id?: string
          match_reason?: string | null
          organization_id?: string
          requirement_id?: string
          status?: string
          tender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "requirement_matches_knowledge_asset_id_fkey"
            columns: ["knowledge_asset_id"]
            isOneToOne: false
            referencedRelation: "knowledge_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirement_matches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirement_matches_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirement_matches_tender_org_fk"
            columns: ["tender_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      requirements: {
        Row: {
          category: string | null
          created_at: string
          id: string
          mandatory: boolean
          organization_id: string
          source_document_id: string | null
          tender_id: string
          text: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          mandatory?: boolean
          organization_id: string
          source_document_id?: string | null
          tender_id: string
          text: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          mandatory?: boolean
          organization_id?: string
          source_document_id?: string | null
          tender_id?: string
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "requirements_source_document_org_fk"
            columns: ["source_document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tender_documents"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "requirements_tender_org_fk"
            columns: ["tender_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      response_sections: {
        Row: {
          created_at: string
          draft_text: string | null
          id: string
          organization_id: string
          review_status: string
          section_title: string
          tender_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          draft_text?: string | null
          id?: string
          organization_id: string
          review_status?: string
          section_title: string
          tender_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          draft_text?: string | null
          id?: string
          organization_id?: string
          review_status?: string
          section_title?: string
          tender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "response_sections_tender_org_fk"
            columns: ["tender_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      risks: {
        Row: {
          created_at: string
          description: string | null
          id: string
          organization_id: string
          risk_type: string
          severity: string | null
          source_document_id: string | null
          tender_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          organization_id: string
          risk_type: string
          severity?: string | null
          source_document_id?: string | null
          tender_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          organization_id?: string
          risk_type?: string
          severity?: string | null
          source_document_id?: string | null
          tender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "risks_source_document_org_fk"
            columns: ["source_document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tender_documents"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "risks_tender_org_fk"
            columns: ["tender_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      tender_documents: {
        Row: {
          created_at: string
          file_name: string
          file_type: string | null
          id: string
          organization_id: string
          parse_status: string
          parsed_text: string | null
          storage_path: string
          tender_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_type?: string | null
          id?: string
          organization_id: string
          parse_status?: string
          parsed_text?: string | null
          storage_path: string
          tender_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_type?: string | null
          id?: string
          organization_id?: string
          parse_status?: string
          parsed_text?: string | null
          storage_path?: string
          tender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tender_documents_tender_org_fk"
            columns: ["tender_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      tenders: {
        Row: {
          bid_decision: string | null
          created_at: string
          deadline: string | null
          fit_score: number | null
          id: string
          issuer: string | null
          language: string | null
          organization_id: string
          source_type: string
          status: string
          tender_type: string
          title: string
          updated_at: string
        }
        Insert: {
          bid_decision?: string | null
          created_at?: string
          deadline?: string | null
          fit_score?: number | null
          id?: string
          issuer?: string | null
          language?: string | null
          organization_id: string
          source_type: string
          status?: string
          tender_type: string
          title: string
          updated_at?: string
        }
        Update: {
          bid_decision?: string | null
          created_at?: string
          deadline?: string | null
          fit_score?: number | null
          id?: string
          issuer?: string | null
          language?: string | null
          organization_id?: string
          source_type?: string
          status?: string
          tender_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_organization_for_current_user: {
        Args: {
          _default_language?: string
          _industry?: string
          _name: string
          _size_label?: string
        }
        Returns: string
      }
      current_organization_id: { Args: never; Returns: string }
      current_profile_is_admin: { Args: never; Returns: boolean }
      seed_tender_defaults_for_tender: {
        Args: { _tender_id: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
