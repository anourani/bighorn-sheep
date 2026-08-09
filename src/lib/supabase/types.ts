/**
 * Hand-written database types mirroring supabase/migrations/0001_init.sql.
 * (In a real project you'd generate these with `supabase gen types typescript`.)
 */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          first_name: string;
          last_name: string;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          first_name?: string;
          last_name?: string;
          avatar_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          first_name?: string;
          last_name?: string;
          avatar_url?: string | null;
          created_at?: string;
        };
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
          season_type: "pre" | "regular" | "post";
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
          /** Defaults to 'regular' in the database (0006). */
          season_type?: "pre" | "regular" | "post";
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
      account_exists: { Args: { p_email: string }; Returns: boolean };
      is_group_member: { Args: { gid: string }; Returns: boolean };
      is_group_admin: { Args: { gid: string }; Returns: boolean };
      join_by_invite: {
        Args: { p_code: string };
        Returns: Database["public"]["Tables"]["groups"]["Row"];
      };
      create_group: {
        Args: {
          p_name: string;
          p_elimination_type?: "single" | "two_time";
          p_tie_rule?: "push" | "loss";
          p_season?: number;
          p_entry_closes_at?: string | null;
        };
        Returns: Database["public"]["Tables"]["groups"]["Row"];
      };
      hidden_pick_user_ids: {
        Args: { p_group_id: string; p_week: number };
        Returns: string[];
      };
      /**
       * Season-type-aware sibling of hidden_pick_user_ids, added in 0006. The
       * original is left in place because it has already run against real
       * databases; a distinct name also keeps supabase.rpc() unambiguous.
       */
      hidden_picks_for_week: {
        Args: { p_group_id: string; p_season_type: "pre" | "regular" | "post"; p_week: number };
        Returns: string[];
      };
      invite_preview: {
        Args: { p_code: string };
        Returns: {
          name: string;
          season: number;
          entry_open: boolean;
          member_count: number;
          elimination_type: "single" | "two_time";
          tie_rule: "push" | "loss";
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
