/**
 * Hand-written database types mirroring supabase/migrations/0001_init.sql.
 * (In a real project you'd generate these with `supabase gen types typescript`.)
 */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; display_name: string; created_at: string };
        Insert: { id: string; display_name?: string; created_at?: string };
        Update: { id?: string; display_name?: string; created_at?: string };
        Relationships: [];
      };
      groups: {
        Row: {
          id: string;
          name: string;
          season: number;
          elimination_type: "single" | "two_time";
          tie_rule: "push" | "loss";
          invite_code: string;
          entry_closes_at: string;
          settings_locked_at: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          season: number;
          elimination_type?: "single" | "two_time";
          tie_rule?: "push" | "loss";
          invite_code: string;
          entry_closes_at: string;
          settings_locked_at?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["groups"]["Insert"]>;
        Relationships: [];
      };
      group_members: {
        Row: {
          id: string;
          group_id: string;
          user_id: string;
          role: "admin" | "player";
          status: "alive" | "eliminated";
          strikes: number;
          eliminated_week: number | null;
          joined_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          user_id: string;
          role?: "admin" | "player";
          status?: "alive" | "eliminated";
          strikes?: number;
          eliminated_week?: number | null;
          joined_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["group_members"]["Insert"]>;
        Relationships: [];
      };
      games: {
        Row: {
          id: string;
          season: number;
          season_type: "pre" | "regular" | "post";
          week: number;
          kickoff: string;
          status: "scheduled" | "in_progress" | "delayed" | "final" | "postponed";
          home: string;
          away: string;
          home_score: number | null;
          away_score: number | null;
          status_detail: string | null;
          updated_at: string;
        };
        Insert: {
          id: string;
          season: number;
          season_type?: "pre" | "regular" | "post";
          week: number;
          kickoff: string;
          status?: "scheduled" | "in_progress" | "delayed" | "final" | "postponed";
          home: string;
          away: string;
          home_score?: number | null;
          away_score?: number | null;
          status_detail?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["games"]["Insert"]>;
        Relationships: [];
      };
      picks: {
        Row: {
          id: string;
          group_id: string;
          user_id: string;
          week: number;
          team_id: string;
          game_id: string;
          result: "win" | "loss" | "push" | "pending" | null;
          created_at: string;
          updated_at: string;
          locked_at: string | null;
        };
        Insert: {
          id?: string;
          group_id: string;
          user_id: string;
          week: number;
          team_id: string;
          game_id: string;
          result?: "win" | "loss" | "push" | "pending" | null;
          created_at?: string;
          updated_at?: string;
          locked_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["picks"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_group_member: { Args: { gid: string }; Returns: boolean };
      is_group_admin: { Args: { gid: string }; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
