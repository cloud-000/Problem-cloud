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
      _import_problems: {
        Row: {
          answer_index: number | null
          answer_status: string | null
          aops_id: number | null
          canonical_sync_key: string | null
          choices: string[] | null
          difficulty: number | null
          is_computational: boolean
          n: number
          notes: string | null
          official_solutions: string[] | null
          quality: number | null
          response_kind: string | null
          statement: string | null
          sync_key: string
          tags: string[] | null
          test_sync_key: string
          topic: string | null
          verified: boolean
        }
        Insert: {
          answer_index?: number | null
          answer_status?: string | null
          aops_id?: number | null
          canonical_sync_key?: string | null
          choices?: string[] | null
          difficulty?: number | null
          is_computational?: boolean
          n: number
          notes?: string | null
          official_solutions?: string[] | null
          quality?: number | null
          response_kind?: string | null
          statement?: string | null
          sync_key: string
          tags?: string[] | null
          test_sync_key: string
          topic?: string | null
          verified?: boolean
        }
        Update: {
          answer_index?: number | null
          answer_status?: string | null
          aops_id?: number | null
          canonical_sync_key?: string | null
          choices?: string[] | null
          difficulty?: number | null
          is_computational?: boolean
          n?: number
          notes?: string | null
          official_solutions?: string[] | null
          quality?: number | null
          response_kind?: string | null
          statement?: string | null
          sync_key?: string
          tags?: string[] | null
          test_sync_key?: string
          topic?: string | null
          verified?: boolean
        }
        Relationships: []
      }
      _import_series: {
        Row: {
          aops_id: number | null
          is_official: boolean
          name: string
        }
        Insert: {
          aops_id?: number | null
          is_official?: boolean
          name: string
        }
        Update: {
          aops_id?: number | null
          is_official?: boolean
          name?: string
        }
        Relationships: []
      }
      _import_tests: {
        Row: {
          answer_status: string | null
          aops_category_id: string | null
          difficulty: number | null
          division: string | null
          division_order: number | null
          format: string | null
          format_order: number | null
          is_computational: boolean
          name: string
          quality: number | null
          response_kind: string | null
          section: number
          series_name: string
          sync_key: string
          type: string | null
          year: number | null
        }
        Insert: {
          answer_status?: string | null
          aops_category_id?: string | null
          difficulty?: number | null
          division?: string | null
          division_order?: number | null
          format?: string | null
          format_order?: number | null
          is_computational?: boolean
          name: string
          quality?: number | null
          response_kind?: string | null
          section?: number
          series_name: string
          sync_key: string
          type?: string | null
          year?: number | null
        }
        Update: {
          answer_status?: string | null
          aops_category_id?: string | null
          difficulty?: number | null
          division?: string | null
          division_order?: number | null
          format?: string | null
          format_order?: number | null
          is_computational?: boolean
          name?: string
          quality?: number | null
          response_kind?: string | null
          section?: number
          series_name?: string
          sync_key?: string
          type?: string | null
          year?: number | null
        }
        Relationships: []
      }
      ai_conversations: {
        Row: {
          archived_at: string | null
          concluded_submission_id: number | null
          created_at: string
          id: string
          kind: string
          last_active_at: string
          practice_session_id: number | null
          problem_id: number | null
          retired_at: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          concluded_submission_id?: number | null
          created_at?: string
          id?: string
          kind?: string
          last_active_at?: string
          practice_session_id?: number | null
          problem_id?: number | null
          retired_at?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          concluded_submission_id?: number | null
          created_at?: string
          id?: string
          kind?: string
          last_active_at?: string
          practice_session_id?: number | null
          problem_id?: number | null
          retired_at?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_concluded_submission_id_fkey"
            columns: ["concluded_submission_id"]
            isOneToOne: false
            referencedRelation: "submission_facts"
            referencedColumns: ["submission_id"]
          },
          {
            foreignKeyName: "ai_conversations_concluded_submission_id_fkey"
            columns: ["concluded_submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_conversations_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "canonical_placements"
            referencedColumns: ["placement_id"]
          },
          {
            foreignKeyName: "ai_conversations_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_conversations_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "user_problem_index"
            referencedColumns: ["problem_id"]
          },
          {
            foreignKeyName: "ai_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_messages: {
        Row: {
          content_parts: Json
          context_snapshot: Json
          conversation_id: string
          created_at: string
          id: string
          resolved_model: string | null
          resolved_provider: string | null
          role: string
          status: string
          usage_summary: Json | null
        }
        Insert: {
          content_parts?: Json
          context_snapshot?: Json
          conversation_id: string
          created_at?: string
          id?: string
          resolved_model?: string | null
          resolved_provider?: string | null
          role: string
          status: string
          usage_summary?: Json | null
        }
        Update: {
          content_parts?: Json
          context_snapshot?: Json
          conversation_id?: string
          created_at?: string
          id?: string
          resolved_model?: string | null
          resolved_provider?: string | null
          role?: string
          status?: string
          usage_summary?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_preferences: {
        Row: {
          created_at: string
          default_model: string
          history_enabled: boolean
          retention_days: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_model?: string
          history_enabled?: boolean
          retention_days?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_model?: string
          history_enabled?: boolean
          retention_days?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          achieved_at: string | null
          archived_at: string | null
          created_at: string
          deadline: string | null
          id: number
          scope: Json
          target: Json
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          achieved_at?: string | null
          archived_at?: string | null
          created_at?: string
          deadline?: string | null
          id?: number
          scope?: Json
          target: Json
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          achieved_at?: string | null
          archived_at?: string | null
          created_at?: string
          deadline?: string | null
          id?: number
          scope?: Json
          target?: Json
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
      player_rating_history: {
        Row: {
          at: string
          created_at: string
          id: number
          rating: number
          rd: number
          scope: string
          submission_id: number | null
          user_id: string
        }
        Insert: {
          at: string
          created_at?: string
          id?: never
          rating: number
          rd: number
          scope?: string
          submission_id?: number | null
          user_id: string
        }
        Update: {
          at?: string
          created_at?: string
          id?: never
          rating?: number
          rd?: number
          scope?: string
          submission_id?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_rating_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_ratings: {
        Row: {
          created_at: string
          last_match_at: string | null
          matches: number
          rating: number
          rd: number
          scope: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_match_at?: string | null
          matches?: number
          rating?: number
          rd?: number
          scope?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_match_at?: string | null
          matches?: number
          rating?: number
          rd?: number
          scope?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_ratings_user_id_fkey"
            columns: ["user_id"]
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
          is_root: boolean
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
          is_root?: boolean
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
          is_root?: boolean
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
            referencedRelation: "canonical_placements"
            referencedColumns: ["placement_id"]
          },
          {
            foreignKeyName: "practice_sessions_current_problem_id_fkey"
            columns: ["current_problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_sessions_current_problem_id_fkey"
            columns: ["current_problem_id"]
            isOneToOne: false
            referencedRelation: "user_problem_index"
            referencedColumns: ["problem_id"]
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
          engagement: string | null
          interval_days: number
          last_correct: boolean | null
          last_reviewed_at: string | null
          last_submission_at: string | null
          mastery: string | null
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
          engagement?: string | null
          interval_days?: number
          last_correct?: boolean | null
          last_reviewed_at?: string | null
          last_submission_at?: string | null
          mastery?: string | null
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
          engagement?: string | null
          interval_days?: number
          last_correct?: boolean | null
          last_reviewed_at?: string | null
          last_submission_at?: string | null
          mastery?: string | null
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
            referencedRelation: "canonical_placements"
            referencedColumns: ["placement_id"]
          },
          {
            foreignKeyName: "problem_progress_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_progress_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "user_problem_index"
            referencedColumns: ["problem_id"]
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
      problem_rating_history: {
        Row: {
          at: string
          created_at: string
          id: number
          problem_id: number
          rating: number
          rd: number
          scope: string
          submission_id: number | null
        }
        Insert: {
          at: string
          created_at?: string
          id?: never
          problem_id: number
          rating: number
          rd: number
          scope?: string
          submission_id?: number | null
        }
        Update: {
          at?: string
          created_at?: string
          id?: never
          problem_id?: number
          rating?: number
          rd?: number
          scope?: string
          submission_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "problem_rating_history_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "canonical_placements"
            referencedColumns: ["placement_id"]
          },
          {
            foreignKeyName: "problem_rating_history_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_rating_history_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "user_problem_index"
            referencedColumns: ["problem_id"]
          },
        ]
      }
      problem_rating_stats: {
        Row: {
          ln_time_ewma: number | null
          problem_id: number
          solve_count: number
          updated_at: string
        }
        Insert: {
          ln_time_ewma?: number | null
          problem_id: number
          solve_count?: number
          updated_at?: string
        }
        Update: {
          ln_time_ewma?: number | null
          problem_id?: number
          solve_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_rating_stats_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: true
            referencedRelation: "canonical_placements"
            referencedColumns: ["placement_id"]
          },
          {
            foreignKeyName: "problem_rating_stats_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: true
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_rating_stats_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: true
            referencedRelation: "user_problem_index"
            referencedColumns: ["problem_id"]
          },
        ]
      }
      problem_ratings: {
        Row: {
          attempts: number
          created_at: string
          last_match_at: string | null
          problem_id: number
          rating: number
          rd: number
          scope: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          last_match_at?: string | null
          problem_id: number
          rating?: number
          rd?: number
          scope?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          last_match_at?: string | null
          problem_id?: number
          rating?: number
          rd?: number
          scope?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_ratings_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "canonical_placements"
            referencedColumns: ["placement_id"]
          },
          {
            foreignKeyName: "problem_ratings_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_ratings_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "user_problem_index"
            referencedColumns: ["problem_id"]
          },
        ]
      }
      problems: {
        Row: {
          answer_index: number | null
          answer_status: string | null
          aops_id: number | null
          built_at: string
          canonical_id: number | null
          choices: string[] | null
          difficulty: number | null
          id: number
          is_computational: boolean
          n: number
          notes: string | null
          official_solutions: string[] | null
          quality: number | null
          response_kind: string | null
          statement: string | null
          sync_key: string | null
          tags: string[] | null
          test_id: number | null
          topic: string | null
          verified: boolean
        }
        Insert: {
          answer_index?: number | null
          answer_status?: string | null
          aops_id?: number | null
          built_at?: string
          canonical_id?: number | null
          choices?: string[] | null
          difficulty?: number | null
          id?: number
          is_computational?: boolean
          n: number
          notes?: string | null
          official_solutions?: string[] | null
          quality?: number | null
          response_kind?: string | null
          statement?: string | null
          sync_key?: string | null
          tags?: string[] | null
          test_id?: number | null
          topic?: string | null
          verified?: boolean
        }
        Update: {
          answer_index?: number | null
          answer_status?: string | null
          aops_id?: number | null
          built_at?: string
          canonical_id?: number | null
          choices?: string[] | null
          difficulty?: number | null
          id?: number
          is_computational?: boolean
          n?: number
          notes?: string | null
          official_solutions?: string[] | null
          quality?: number | null
          response_kind?: string | null
          statement?: string | null
          sync_key?: string | null
          tags?: string[] | null
          test_id?: number | null
          topic?: string | null
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "problems_canonical_id_fkey"
            columns: ["canonical_id"]
            isOneToOne: false
            referencedRelation: "canonical_placements"
            referencedColumns: ["placement_id"]
          },
          {
            foreignKeyName: "problems_canonical_id_fkey"
            columns: ["canonical_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problems_canonical_id_fkey"
            columns: ["canonical_id"]
            isOneToOne: false
            referencedRelation: "user_problem_index"
            referencedColumns: ["problem_id"]
          },
          {
            foreignKeyName: "problems_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "submission_facts"
            referencedColumns: ["test_id"]
          },
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
          focused_series: number[]
          id: string
          last_active_at: string
          status: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          admin_rank?: number
          created_at?: string
          focused_series?: number[]
          id: string
          last_active_at?: string
          status?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          admin_rank?: number
          created_at?: string
          focused_series?: number[]
          id?: string
          last_active_at?: string
          status?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      rating_params: {
        Row: {
          attempt_decay: number
          c: number
          effort_cap: number
          encounter_gap: number
          guess_floor_ms: number
          id: boolean
          min_solves: number
          period_seconds: number
          rd_floor: number
          repeat_decay: number
          retry_weight: number
          score_swing: number
          seed_rating: number
          seed_rd: number
          time_alpha: number
          updated_at: string
        }
        Insert: {
          attempt_decay?: number
          c?: number
          effort_cap?: number
          encounter_gap?: number
          guess_floor_ms?: number
          id?: boolean
          min_solves?: number
          period_seconds?: number
          rd_floor?: number
          repeat_decay?: number
          retry_weight?: number
          score_swing?: number
          seed_rating?: number
          seed_rd?: number
          time_alpha?: number
          updated_at?: string
        }
        Update: {
          attempt_decay?: number
          c?: number
          effort_cap?: number
          encounter_gap?: number
          guess_floor_ms?: number
          id?: boolean
          min_solves?: number
          period_seconds?: number
          rd_floor?: number
          repeat_decay?: number
          retry_weight?: number
          score_swing?: number
          seed_rating?: number
          seed_rd?: number
          time_alpha?: number
          updated_at?: string
        }
        Relationships: []
      }
      roadmap_goals: {
        Row: {
          created_at: string
          description: string
          id: number
          planned_date: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: never
          planned_date?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: never
          planned_date?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      roadmap_votes: {
        Row: {
          goal_id: number
          profile_id: string
          vote_value: number
        }
        Insert: {
          goal_id: number
          profile_id: string
          vote_value: number
        }
        Update: {
          goal_id?: number
          profile_id?: string
          vote_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_votes_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "roadmap_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_votes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          answer: string | null
          attempt: number | null
          created_at: string
          elapsed_ms: number | null
          encounter: number | null
          encounter_ms: number | null
          flagged: boolean
          id: number
          is_correct: boolean | null
          problem_id: number
          selected_choice: number | null
          session_id: number | null
          skipped: boolean
          source: string | null
          tries_used: number
          user_id: string
        }
        Insert: {
          answer?: string | null
          attempt?: number | null
          created_at?: string
          elapsed_ms?: number | null
          encounter?: number | null
          encounter_ms?: number | null
          flagged?: boolean
          id?: never
          is_correct?: boolean | null
          problem_id: number
          selected_choice?: number | null
          session_id?: number | null
          skipped?: boolean
          source?: string | null
          tries_used?: number
          user_id: string
        }
        Update: {
          answer?: string | null
          attempt?: number | null
          created_at?: string
          elapsed_ms?: number | null
          encounter?: number | null
          encounter_ms?: number | null
          flagged?: boolean
          id?: never
          is_correct?: boolean | null
          problem_id?: number
          selected_choice?: number | null
          session_id?: number | null
          skipped?: boolean
          source?: string | null
          tries_used?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "canonical_placements"
            referencedColumns: ["placement_id"]
          },
          {
            foreignKeyName: "submissions_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "user_problem_index"
            referencedColumns: ["problem_id"]
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
          answer_status: string | null
          aops_category_id: string | null
          difficulty: number | null
          division: string | null
          division_order: number | null
          format: string | null
          format_order: number | null
          has_all_answers: boolean
          id: number
          is_computational: boolean
          missing_answers_count: number
          name: string
          quality: number | null
          response_kind: string | null
          section: number
          series_id: number | null
          sync_key: string | null
          time_limit_seconds: number | null
          type: string | null
          year: number | null
        }
        Insert: {
          answer_status?: string | null
          aops_category_id?: string | null
          difficulty?: number | null
          division?: string | null
          division_order?: number | null
          format?: string | null
          format_order?: number | null
          has_all_answers?: boolean
          id?: number
          is_computational?: boolean
          missing_answers_count?: number
          name: string
          quality?: number | null
          response_kind?: string | null
          section?: number
          series_id?: number | null
          sync_key?: string | null
          time_limit_seconds?: number | null
          type?: string | null
          year?: number | null
        }
        Update: {
          answer_status?: string | null
          aops_category_id?: string | null
          difficulty?: number | null
          division?: string | null
          division_order?: number | null
          format?: string | null
          format_order?: number | null
          has_all_answers?: boolean
          id?: number
          is_computational?: boolean
          missing_answers_count?: number
          name?: string
          quality?: number | null
          response_kind?: string | null
          section?: number
          series_id?: number | null
          sync_key?: string | null
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
          {
            foreignKeyName: "tests_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "submission_facts"
            referencedColumns: ["series_id"]
          },
        ]
      }
      user_submitted_feedback: {
        Row: {
          answer_index: number | null
          answer_text: string | null
          created_at: string
          id: number
          message: string | null
          problem_id: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          type: string
          user_id: string
        }
        Insert: {
          answer_index?: number | null
          answer_text?: string | null
          created_at?: string
          id?: never
          message?: string | null
          problem_id?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          type: string
          user_id: string
        }
        Update: {
          answer_index?: number | null
          answer_text?: string | null
          created_at?: string
          id?: never
          message?: string | null
          problem_id?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_submitted_feedback_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "canonical_placements"
            referencedColumns: ["placement_id"]
          },
          {
            foreignKeyName: "user_submitted_feedback_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_submitted_feedback_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "user_problem_index"
            referencedColumns: ["problem_id"]
          },
          {
            foreignKeyName: "user_submitted_feedback_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      canonical_placements: {
        Row: {
          canonical_id: number | null
          division: string | null
          format: string | null
          gradeable: boolean | null
          placement_id: number | null
          series_id: number | null
          test_id: number | null
          topic: string | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "problems_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "submission_facts"
            referencedColumns: ["test_id"]
          },
          {
            foreignKeyName: "problems_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tests_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tests_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "submission_facts"
            referencedColumns: ["series_id"]
          },
        ]
      }
      submission_facts: {
        Row: {
          attempt_seq: number | null
          created_at: string | null
          difficulty: number | null
          elapsed_ms: number | null
          flagged: boolean | null
          graded_seq: number | null
          is_computational: boolean | null
          is_correct: boolean | null
          problem_id: number | null
          series_id: number | null
          series_name: string | null
          session_id: number | null
          skipped: boolean | null
          source: string | null
          submission_id: number | null
          test_id: number | null
          test_name: string | null
          topic: string | null
          tries_used: number | null
          user_id: string | null
          verified: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "canonical_placements"
            referencedColumns: ["placement_id"]
          },
          {
            foreignKeyName: "submissions_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "user_problem_index"
            referencedColumns: ["problem_id"]
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
      user_problem_index: {
        Row: {
          answer_index: number | null
          answer_status: string | null
          canonical_id: number | null
          difficulty: number | null
          division: string | null
          engagement: string | null
          format: string | null
          has_choices: boolean | null
          has_solution: boolean | null
          has_statement: boolean | null
          is_computational: boolean | null
          is_ignored: boolean | null
          last_correct: boolean | null
          last_reviewed_at: string | null
          last_submission_at: string | null
          mastery: string | null
          n: number | null
          next_review_at: string | null
          problem_id: number | null
          quality: number | null
          rating: number | null
          response_kind: string | null
          series_id: number | null
          solved: boolean | null
          tags: string[] | null
          test_id: number | null
          times_correct: number | null
          times_reviewed: number | null
          times_seen: number | null
          times_skipped: number | null
          topic: string | null
          total_time_ms: number | null
          verified: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "problems_canonical_id_fkey"
            columns: ["canonical_id"]
            isOneToOne: false
            referencedRelation: "canonical_placements"
            referencedColumns: ["placement_id"]
          },
          {
            foreignKeyName: "problems_canonical_id_fkey"
            columns: ["canonical_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problems_canonical_id_fkey"
            columns: ["canonical_id"]
            isOneToOne: false
            referencedRelation: "user_problem_index"
            referencedColumns: ["problem_id"]
          },
          {
            foreignKeyName: "problems_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "submission_facts"
            referencedColumns: ["test_id"]
          },
          {
            foreignKeyName: "problems_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tests_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tests_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "submission_facts"
            referencedColumns: ["series_id"]
          },
        ]
      }
    }
    Functions: {
      admin_recompute_ratings: { Args: never; Returns: Json }
      backfill_content_sync_keys: { Args: never; Returns: undefined }
      canonicalize_existing_user_data: {
        Args: never
        Returns: {
          alias_progress_dropped: number
          alias_ratings_dropped: number
          progress_rebuilt: number
          submissions_moved: number
        }[]
      }
      glicko_e: {
        Args: { r: number; r_j: number; rd_j: number }
        Returns: number
      }
      glicko_g: { Args: { rd: number }; Returns: number }
      glicko_inflate: {
        Args: {
          idle_seconds: number
          par: Database["public"]["Tables"]["rating_params"]["Row"]
          rd: number
        }
        Returns: number
      }
      glicko_rate: {
        Args: {
          opp_r: number
          opp_rd: number
          par: Database["public"]["Tables"]["rating_params"]["Row"]
          r: number
          rd: number
          s: number
          w: number
        }
        Returns: Record<string, unknown>
      }
      goal_scope_canonicals: {
        Args: { p_scope: Json }
        Returns: {
          canonical_id: number
          gradeable: boolean
        }[]
      }
      goal_set_progress: {
        Args: { p_requests: Json }
        Returns: {
          attempted: number
          eligible_total: number
          idx: number
          solved: number
        }[]
      }
      goal_streak_progress: {
        Args: { p_requests: Json }
        Returns: {
          idx: number
          streak_days: number
          today_count: number
        }[]
      }
      goal_volume_progress: {
        Args: { p_requests: Json }
        Returns: {
          graded_submissions: number
          idx: number
        }[]
      }
      goal_window_progress: {
        Args: { p_requests: Json }
        Returns: {
          fresh_correct: number
          fresh_sample: number
          graded_correct: number
          graded_sample: number
          idx: number
          timed_sample: number
          timed_total_ms: number
        }[]
      }
      is_gradeable: {
        Args: {
          p_answer_index: number
          p_answer_status: string
          p_choices: string[]
          p_statement: string
        }
        Returns: boolean
      }
      problem_state_summary: {
        Args: { p_series_id?: number }
        Returns: {
          attempted: number
          confident: number
          ignored: number
          later: number
          learning: number
          needs_work: number
          no_plan: number
          review_due: number
          revisit: number
          seen: number
          skipped_only: number
          total: number
          unassessed: number
          unseen: number
          working: number
        }[]
      }
      progress_breakdown: {
        Args: {
          p_computational?: boolean
          p_difficulty_max?: number
          p_difficulty_min?: number
          p_dimension: string
          p_from?: string
          p_series?: number[]
          p_source?: string
          p_to?: string
          p_topics?: string[]
          p_tz?: string
        }
        Returns: {
          bucket_key: string
          bucket_label: string
          correct: number
          distinct_problems: number
          first_correct: number
          first_graded: number
          graded: number
          graded_time_ms: number
          graded_timed: number
          last_activity: string
          seen: number
          skipped: number
        }[]
      }
      rating_grade: {
        Args: {
          a: number
          correct: boolean
          elapsed_ms: number
          enc_ms: number
          is_mcq: boolean
          k: number
          ln_ewma: number
          par: Database["public"]["Tables"]["rating_params"]["Row"]
          solve_count: number
        }
        Returns: Record<string, unknown>
      }
      rating_params: {
        Args: never
        Returns: {
          attempt_decay: number
          c: number
          effort_cap: number
          encounter_gap: number
          guess_floor_ms: number
          id: boolean
          min_solves: number
          period_seconds: number
          rd_floor: number
          repeat_decay: number
          retry_weight: number
          score_swing: number
          seed_rating: number
          seed_rd: number
          time_alpha: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "rating_params"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recalculate_test_answers: { Args: { t_id: number }; Returns: undefined }
      recompute_problem_progress: {
        Args: { p_problem_id: number; p_user_id: string }
        Returns: undefined
      }
      recompute_ratings: { Args: never; Returns: Json }
      resolve_content_answer_status: {
        Args: {
          answer_index: number
          choices: string[]
          problem_status: string
          response_kind: string
          test_status: string
        }
        Returns: string
      }
      resolve_content_response_kind: {
        Args: { choices: string[]; problem_kind: string; test_kind: string }
        Returns: string
      }
      review_problem_report: {
        Args: {
          p_answer_index?: number
          p_apply_answer?: boolean
          p_feedback_id: number
          p_status: string
        }
        Returns: undefined
      }
      set_feedback_status: {
        Args: { p_feedback_id: number; p_status: string }
        Returns: undefined
      }
      set_problem_engagement: {
        Args: { p_engagement: string; p_problem_id: number }
        Returns: {
          engagement: string
          mastery: string
          problem_id: number
        }[]
      }
      set_problem_mastery: {
        Args: { p_mastery: string; p_problem_id: number }
        Returns: {
          engagement: string
          mastery: string
          problem_id: number
        }[]
      }
      sync_scraped_content: {
        Args: { dry_run?: boolean }
        Returns: {
          applied: boolean
          problems_inserted: number
          problems_unmatched: number
          problems_updated: number
          series_inserted: number
          series_updated: number
          tests_inserted: number
          tests_updated: number
        }[]
      }
      sync_unmatched_problems: {
        Args: never
        Returns: {
          n: number
          problem_id: number
          sync_key: string
          test_id: number
          test_name: string
        }[]
      }
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

