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
          /** One of src/lib/profile/animals.ts — validated in the action, not by a constraint. */
          favorite_animal: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          first_name?: string;
          last_name?: string;
          avatar_url?: string | null;
          favorite_animal?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          first_name?: string;
          last_name?: string;
          avatar_url?: string | null;
          favorite_animal?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      /**
       * Private per-user fields, split out of world-readable `profiles` in 0008.
       * RLS: readable by the owner and by admins of leagues the owner belongs to
       * (via is_admin_for_member); writable only by the owner. Queries against it
       * come back filtered, not erroring — select .in(...) a list of ids and you
       * receive only the rows you're entitled to.
       */
      profile_private: {
        Row: {
          id: string;
          /** Optional; free text, never parsed or dialled. */
          phone: string | null;
        };
        Insert: {
          id: string;
          phone?: string | null;
        };
        Update: {
          id?: string;
          phone?: string | null;
        };
        Relationships: [];
      };
      /**
       * One row per player who has closed their own account (0010). Written
       * only by close_own_account(): RLS is on and there is deliberately no
       * insert, update or delete policy, because 0001's "profiles update own"
       * shows why a `profiles.deleted_at` column would not have worked — RLS
       * cannot restrict which columns an update writes, so the locked-out
       * account could clear its own lockout with the anon key.
       *
       * Closing is not deleting. The profile, membership, picks and strikes all
       * survive so the standings board keeps its record of the season.
       */
      account_closures: {
        Row: {
          id: string;
          closed_at: string;
        };
        Insert: {
          id: string;
          closed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["account_closures"]["Insert"]>;
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
          /**
           * What the pot costs, in cents, added in 0010. Writable only through
           * the set_group_buy_in RPC: `groups` DOES have an admin UPDATE policy,
           * but RLS cannot restrict which columns it writes, so a direct
           * .update() would be the first client write path to invite_code and
           * the rules columns as well.
           */
          buy_in_cents: number;
          site_fee_cents: number;
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
          buy_in_cents?: number;
          site_fee_cents?: number;
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
          /**
           * Whether the admin has marked this member's league buy-in as paid.
           * Writable only through the set_member_buy_in RPC — group_members has
           * no UPDATE policy, so a direct .update() is silently a no-op.
           */
          buy_in_paid: boolean;
          buy_in_paid_at: string | null;
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
          buy_in_paid?: boolean;
          buy_in_paid_at?: string | null;
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
      /**
       * 0009: the published league's public board, for the signed-out landing
       * page. Zero-arg by design — an argument would make it a universal
       * standings reader for every league in the project. Returns SQL NULL
       * (→ `null` here) when no league is published.
       *
       * Typed loosely because the shape is nested JSON that the mapper in
       * `src/lib/league/public.ts` validates structurally anyway; a hand-written
       * row type here would be a second source of truth that can drift.
       */
      public_league_snapshot: { Args: Record<string, never>; Returns: unknown };
      is_group_member: { Args: { gid: string }; Returns: boolean };
      is_group_admin: { Args: { gid: string }; Returns: boolean };
      /** 0008: is the caller an admin of any league p_user_id belongs to? */
      is_admin_for_member: { Args: { p_user_id: string }; Returns: boolean };
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
      /**
       * Admin-only buy-in write, added in 0007. SECURITY DEFINER because
       * group_members has no UPDATE policy at all; the function re-checks
       * is_group_admin() itself and raises `not_admin` otherwise.
       *
       * 0010 redefined the body so buy_in_paid_at is stamped on every change
       * rather than only when p_paid is true — the account page prints
       * "UNPAID · Updated 10/21", which the old `else null` made unrenderable.
       * The signature is unchanged.
       */
      set_member_buy_in: {
        Args: { p_group_id: string; p_user_id: string; p_paid: boolean };
        Returns: Database["public"]["Tables"]["group_members"]["Row"];
      };
      /**
       * Admin-only write of what the pot costs (0010). Raises `not_admin`,
       * `bad_amount` on a negative, `group_not_found` on an unknown id.
       */
      set_group_buy_in: {
        Args: { p_group_id: string; p_buy_in_cents: number; p_site_fee_cents: number };
        Returns: Database["public"]["Tables"]["groups"]["Row"];
      };
      /**
       * Close the caller's own account (0010). Takes no argument by design —
       * it writes auth.uid(), so there is no id for a caller to substitute —
       * and is idempotent, so a retry after a dropped response is a no-op.
       */
      close_own_account: {
        Args: Record<string, never>;
        Returns: Database["public"]["Tables"]["account_closures"]["Row"];
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
