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
      notification_reads: {
        Row: {
          notification_id: number
          read_at: string
          user_id: string
        }
        Insert: {
          notification_id: number
          read_at?: string
          user_id: string
        }
        Update: {
          notification_id?: number
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: number
          message: string
          payload: Json | null
          sender_id: string | null
          targets: string[] | null
          title: string
        }
        Insert: {
          created_at?: string
          id?: never
          message: string
          payload?: Json | null
          sender_id?: string | null
          targets?: string[] | null
          title: string
        }
        Update: {
          created_at?: string
          id?: never
          message?: string
          payload?: Json | null
          sender_id?: string | null
          targets?: string[] | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_sessions: {
        Row: {
          created_at: string
          current_elapsed_ms: number
          current_problem_id: number | null
          ended_at: string | null
          id: number
          last_submission_at: string | null
          name: string | null
          settings: Json
          started_at: string
          status: string
          times_correct: number
          times_reviewed: number
          times_seen: number
          times_skipped: number
          total_time_ms: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_elapsed_ms?: number
          current_problem_id?: number | null
          ended_at?: string | null
          id?: never
          last_submission_at?: string | null
          name?: string | null
          settings?: Json
          started_at?: string
          status?: string
          times_correct?: number
          times_reviewed?: number
          times_seen?: number
          times_skipped?: number
          total_time_ms?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_elapsed_ms?: number
          current_problem_id?: number | null
          ended_at?: string | null
          id?: never
          last_submission_at?: string | null
          name?: string | null
          settings?: Json
          started_at?: string
          status?: string
          times_correct?: number
          times_reviewed?: number
          times_seen?: number
          times_skipped?: number
          total_time_ms?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_sessions_current_problem_id_fkey"
            columns: ["current_problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_progress: {
        Row: {
          created_at: string
          ease_factor: number
          interval_days: number
          last_correct: boolean | null
          last_reviewed_at: string | null
          last_submission_at: string | null
          next_review_at: string | null
          problem_id: number
          repetitions: number
          solved: boolean | null
          times_correct: number
          times_reviewed: number
          times_seen: number
          times_skipped: number
          total_time_ms: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ease_factor?: number
          interval_days?: number
          last_correct?: boolean | null
          last_reviewed_at?: string | null
          last_submission_at?: string | null
          next_review_at?: string | null
          problem_id: number
          repetitions?: number
          solved?: boolean | null
          times_correct?: number
          times_reviewed?: number
          times_seen?: number
          times_skipped?: number
          total_time_ms?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ease_factor?: number
          interval_days?: number
          last_correct?: boolean | null
          last_reviewed_at?: string | null
          last_submission_at?: string | null
          next_review_at?: string | null
          problem_id?: number
          repetitions?: number
          solved?: boolean | null
          times_correct?: number
          times_reviewed?: number
          times_seen?: number
          times_skipped?: number
          total_time_ms?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_progress_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      problems: {
        Row: {
          answer_index: number | null
          aops_id: number | null
          built_at: string
          choices: string[] | null
          difficulty: number | null
          id: number
          is_computational: boolean
          n: number
          notes: string | null
          official_solutions: string[] | null
          quality: number | null
          statement: string | null
          tags: string[] | null
          test_id: number | null
          topic: string | null
          verified: boolean
        }
        Insert: {
          answer_index?: number | null
          aops_id?: number | null
          built_at?: string
          choices?: string[] | null
          difficulty?: number | null
          id?: number
          is_computational?: boolean
          n: number
          notes?: string | null
          official_solutions?: string[] | null
          quality?: number | null
          statement?: string | null
          tags?: string[] | null
          test_id?: number | null
          topic?: string | null
          verified?: boolean
        }
        Update: {
          answer_index?: number | null
          aops_id?: number | null
          built_at?: string
          choices?: string[] | null
          difficulty?: number | null
          id?: number
          is_computational?: boolean
          n?: number
          notes?: string | null
          official_solutions?: string[] | null
          quality?: number | null
          statement?: string | null
          tags?: string[] | null
          test_id?: number | null
          topic?: string | null
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "problems_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          admin_rank: number
          created_at: string
          id: string
          status: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          admin_rank?: number
          created_at?: string
          id: string
          status?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          admin_rank?: number
          created_at?: string
          id?: string
          status?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      series: {
        Row: {
          aops_id: number | null
          id: number
          is_official: boolean
          name: string
        }
        Insert: {
          aops_id?: number | null
          id?: number
          is_official?: boolean
          name: string
        }
        Update: {
          aops_id?: number | null
          id?: number
          is_official?: boolean
          name?: string
        }
        Relationships: []
      }
      submissions: {
        Row: {
          created_at: string
          elapsed_ms: number | null
          flagged: boolean
          id: number
          is_correct: boolean | null
          problem_id: number
          selected_choice: number | null
          session_id: number | null
          skipped: boolean
          source: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          elapsed_ms?: number | null
          flagged?: boolean
          id?: never
          is_correct?: boolean | null
          problem_id: number
          selected_choice?: number | null
          session_id?: number | null
          skipped?: boolean
          source?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          elapsed_ms?: number | null
          flagged?: boolean
          id?: never
          is_correct?: boolean | null
          problem_id?: number
          selected_choice?: number | null
          session_id?: number | null
          skipped?: boolean
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "practice_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tests: {
        Row: {
          aops_category_id: string | null
          difficulty: number | null
          has_all_answers: boolean
          id: number
          is_computational: boolean
          missing_answers_count: number
          name: string
          quality: number | null
          series_id: number | null
          time_limit_seconds: number | null
          type: string | null
          year: number | null
        }
        Insert: {
          aops_category_id?: string | null
          difficulty?: number | null
          has_all_answers?: boolean
          id?: number
          is_computational?: boolean
          missing_answers_count?: number
          name: string
          quality?: number | null
          series_id?: number | null
          time_limit_seconds?: number | null
          type?: string | null
          year?: number | null
        }
        Update: {
          aops_category_id?: string | null
          difficulty?: number | null
          has_all_answers?: boolean
          id?: number
          is_computational?: boolean
          missing_answers_count?: number
          name?: string
          quality?: number | null
          series_id?: number | null
          time_limit_seconds?: number | null
          type?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tests_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
      }
      user_submitted_feedback: {
        Row: {
          answer_index: number | null
          created_at: string
          id: number
          problem_id: number
          steps: string | null
          type: string
          user_id: string
        }
        Insert: {
          answer_index?: number | null
          created_at?: string
          id?: never
          problem_id: number
          steps?: string | null
          type: string
          user_id: string
        }
        Update: {
          answer_index?: number | null
          created_at?: string
          id?: never
          problem_id?: number
          steps?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_submitted_feedback_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_submitted_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      recalculate_test_answers: { Args: { t_id: number }; Returns: undefined }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

