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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          display_name: string
          display_order: number
          key: string
          lower_is_better: boolean
        }
        Insert: {
          display_name: string
          display_order: number
          key: string
          lower_is_better?: boolean
        }
        Update: {
          display_name?: string
          display_order?: number
          key?: string
          lower_is_better?: boolean
        }
        Relationships: []
      }
      game_category_results: {
        Row: {
          category_key: string
          created_at: string
          game_id: string
          id: string
          team_id: string
          value: number
          won_category: boolean
        }
        Insert: {
          category_key: string
          created_at?: string
          game_id: string
          id?: string
          team_id: string
          value: number
          won_category: boolean
        }
        Update: {
          category_key?: string
          created_at?: string
          game_id?: string
          id?: string
          team_id?: string
          value?: number
          won_category?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "game_category_results_category_key_fkey"
            columns: ["category_key"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "game_category_results_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_category_results_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          away_score: number
          away_team_id: string
          created_at: string
          game_code: string | null
          game_number_in_series: number | null
          game_number_in_week: number
          home_score: number
          home_team_id: string
          id: string
          is_playoff: boolean
          played_on: string | null
          playoff_round: string | null
          playoff_series_id: string | null
          season_id: string
          source_post_url: string | null
          source_sheet_tab: string | null
          source_sheet_url: string | null
          tied_categories: number
          updated_at: string
          week_number: number | null
        }
        Insert: {
          away_score?: number
          away_team_id: string
          created_at?: string
          game_code?: string | null
          game_number_in_series?: number | null
          game_number_in_week?: number
          home_score?: number
          home_team_id: string
          id?: string
          is_playoff?: boolean
          played_on?: string | null
          playoff_round?: string | null
          playoff_series_id?: string | null
          season_id: string
          source_post_url?: string | null
          source_sheet_tab?: string | null
          source_sheet_url?: string | null
          tied_categories?: number
          updated_at?: string
          week_number?: number | null
        }
        Update: {
          away_score?: number
          away_team_id?: string
          created_at?: string
          game_code?: string | null
          game_number_in_series?: number | null
          game_number_in_week?: number
          home_score?: number
          home_team_id?: string
          id?: string
          is_playoff?: boolean
          played_on?: string | null
          playoff_round?: string | null
          playoff_series_id?: string | null
          season_id?: string
          source_post_url?: string | null
          source_sheet_tab?: string | null
          source_sheet_url?: string | null
          tied_categories?: number
          updated_at?: string
          week_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "games_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_playoff_series_fk"
            columns: ["playoff_series_id"]
            isOneToOne: false
            referencedRelation: "playoff_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      gms: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          joined_year: number | null
          nickname: string | null
          updated_at: string
          user_id: string | null
          whatsapp: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          joined_year?: number | null
          nickname?: string | null
          updated_at?: string
          user_id?: string | null
          whatsapp?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          joined_year?: number | null
          nickname?: string | null
          updated_at?: string
          user_id?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      player_game_stats: {
        Row: {
          ast: number
          blk: number
          created_at: string
          game_id: string
          id: string
          lineup_order: number | null
          player_id: string
          pts: number
          reb: number
          stl: number
          team_id: string
          three_pm: number
          turnovers: number
        }
        Insert: {
          ast?: number
          blk?: number
          created_at?: string
          game_id: string
          id?: string
          lineup_order?: number | null
          player_id: string
          pts?: number
          reb?: number
          stl?: number
          team_id: string
          three_pm?: number
          turnovers?: number
        }
        Update: {
          ast?: number
          blk?: number
          created_at?: string
          game_id?: string
          id?: string
          lineup_order?: number | null
          player_id?: string
          pts?: number
          reb?: number
          stl?: number
          team_id?: string
          three_pm?: number
          turnovers?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_game_stats_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_game_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_game_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          created_at: string
          full_name: string
          id: string
          nba_team: string | null
          positions: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          nba_team?: string | null
          positions?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          nba_team?: string | null
          positions?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      playoff_series: {
        Row: {
          conference: string | null
          created_at: string
          higher_seed_position: number | null
          higher_seed_team_id: string
          higher_seed_wins: number
          id: string
          lower_seed_position: number | null
          lower_seed_team_id: string
          lower_seed_wins: number
          round: string
          season_id: string
          series_ties: number
          tiebreak_used: boolean
          updated_at: string
          winner_team_id: string | null
        }
        Insert: {
          conference?: string | null
          created_at?: string
          higher_seed_position?: number | null
          higher_seed_team_id: string
          higher_seed_wins?: number
          id?: string
          lower_seed_position?: number | null
          lower_seed_team_id: string
          lower_seed_wins?: number
          round: string
          season_id: string
          series_ties?: number
          tiebreak_used?: boolean
          updated_at?: string
          winner_team_id?: string | null
        }
        Update: {
          conference?: string | null
          created_at?: string
          higher_seed_position?: number | null
          higher_seed_team_id?: string
          higher_seed_wins?: number
          id?: string
          lower_seed_position?: number | null
          lower_seed_team_id?: string
          lower_seed_wins?: number
          round?: string
          season_id?: string
          series_ties?: number
          tiebreak_used?: boolean
          updated_at?: string
          winner_team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playoff_series_higher_seed_team_id_fkey"
            columns: ["higher_seed_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_series_lower_seed_team_id_fkey"
            columns: ["lower_seed_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_series_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_series_winner_team_id_fkey"
            columns: ["winner_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_entries: {
        Row: {
          acquired_via: string | null
          created_at: string
          id: string
          player_id: string
          season: number
          slot: string
          status: string
          team_id: string
          updated_at: string
        }
        Insert: {
          acquired_via?: string | null
          created_at?: string
          id?: string
          player_id: string
          season: number
          slot?: string
          status?: string
          team_id: string
          updated_at?: string
        }
        Update: {
          acquired_via?: string | null
          created_at?: string
          id?: string
          player_id?: string
          season?: number
          slot?: string
          status?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_entries_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_entries_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string
          end_year: number
          id: string
          is_completed: boolean
          is_current: boolean
          label: string
          playoff_start_week: number | null
          start_year: number
          total_weeks: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_year: number
          id?: string
          is_completed?: boolean
          is_current?: boolean
          label: string
          playoff_start_week?: number | null
          start_year: number
          total_weeks?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_year?: number
          id?: string
          is_completed?: boolean
          is_current?: boolean
          label?: string
          playoff_start_week?: number | null
          start_year?: number
          total_weeks?: number
          updated_at?: string
        }
        Relationships: []
      }
      team_name_history: {
        Row: {
          created_at: string
          from_season_id: string | null
          id: string
          name: string
          team_id: string
          to_season_id: string | null
        }
        Insert: {
          created_at?: string
          from_season_id?: string | null
          id?: string
          name: string
          team_id: string
          to_season_id?: string | null
        }
        Update: {
          created_at?: string
          from_season_id?: string | null
          id?: string
          name?: string
          team_id?: string
          to_season_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_name_history_from_season_id_fkey"
            columns: ["from_season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_name_history_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_name_history_to_season_id_fkey"
            columns: ["to_season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          abbreviation: string
          city: string | null
          conference: string | null
          created_at: string
          first_season_id: string | null
          founded_year: number | null
          gm_id: string
          id: string
          is_active: boolean
          last_season_id: string | null
          logo_url: string | null
          name: string
          primary_color: string | null
          secondary_color: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          abbreviation: string
          city?: string | null
          conference?: string | null
          created_at?: string
          first_season_id?: string | null
          founded_year?: number | null
          gm_id: string
          id?: string
          is_active?: boolean
          last_season_id?: string | null
          logo_url?: string | null
          name: string
          primary_color?: string | null
          secondary_color?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          abbreviation?: string
          city?: string | null
          conference?: string | null
          created_at?: string
          first_season_id?: string | null
          founded_year?: number | null
          gm_id?: string
          id?: string
          is_active?: boolean
          last_season_id?: string | null
          logo_url?: string | null
          name?: string
          primary_color?: string | null
          secondary_color?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_first_season_id_fkey"
            columns: ["first_season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_gm_id_fkey"
            columns: ["gm_id"]
            isOneToOne: false
            referencedRelation: "gms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_last_season_id_fkey"
            columns: ["last_season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "editor" | "viewer"
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
    Enums: {
      app_role: ["admin", "editor", "viewer"],
    },
  },
} as const
